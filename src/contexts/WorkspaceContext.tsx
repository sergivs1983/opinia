'use client';

import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { saveWorkspace, loadWorkspace } from '@/lib/utils';
import type { Organization, Business, Membership, WorkspaceState } from '@/types/database';
import {
  dedupeMembershipRowsByOrg,
  getStoredActiveOrgId,
  resolveActiveMembership,
  setStoredActiveOrgId,
} from '@/lib/workspace/active-org';
import { normalizeMemberRole } from '@/lib/roles';

interface WorkspaceContextValue extends WorkspaceState {
  switchOrg: (orgId: string) => Promise<void>;
  switchBiz: (bizId: string) => void;
  reload: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkspaceState>({
    org: null, biz: null, membership: null, orgs: [], memberships: [], businesses: [], loading: true,
  });
  const supabase = useMemo(() => createClient(), []);
  const membershipsByOrgRef = useRef<Map<string, Membership>>(new Map());

  const loadBusinessesForOrg = useCallback(async (
    orgId: string,
    userId: string,
    orgRole: string | null | undefined,
  ): Promise<Business[]> => {
    let businessesQuery = supabase
      .from('businesses')
      .select('*')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    let businessesResult = await businessesQuery;
    if (businessesResult.error) {
      businessesResult = await supabase
        .from('businesses')
        .select('*')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('name', { ascending: true });
    }

    const allBusinesses: Business[] = Array.from(
      new Map(((businessesResult.data || []) as Business[]).map((row) => [row.id, row])).values(),
    );

    const normalizedRole = normalizeMemberRole(orgRole);
    if (normalizedRole === 'owner' || normalizedRole === 'admin') {
      return allBusinesses;
    }

    const { data: assignments, error: assignmentsError } = await supabase
      .from('business_memberships')
      .select('business_id')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .eq('is_active', true);

    if (assignmentsError) {
      return allBusinesses;
    }

    const allowedBizIds = new Set(
      (assignments || [])
        .map((row) => (row as { business_id?: string }).business_id)
        .filter((id): id is string => typeof id === 'string'),
    );

    if (allowedBizIds.size === 0) return [];
    return allBusinesses.filter((item) => allowedBizIds.has(item.id));
  }, [supabase]);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setState(s => ({ ...s, loading: false })); return; }

    // Get memberships with orgs
    let { data: memberships } = await supabase
      .from('memberships')
      .select('*, organization:organizations(*)')
      .eq('user_id', user.id)
      .not('accepted_at', 'is', null)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    if (!memberships || memberships.length === 0) {
      // No membership — trigger bootstrap then retry once
      try {
        const res = await fetch('/api/bootstrap', { method: 'POST' });
        if (res.ok) {
          const { data: retryMemberships } = await supabase
            .from('memberships')
            .select('*, organization:organizations(*)')
            .eq('user_id', user.id)
            .not('accepted_at', 'is', null)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true });

          if (retryMemberships && retryMemberships.length > 0) {
            memberships = retryMemberships;
          } else {
            setState(s => ({ ...s, loading: false }));
            return;
          }
        } else {
          setState(s => ({ ...s, loading: false }));
          return;
        }
      } catch {
        setState(s => ({ ...s, loading: false }));
        return;
      }
    }

    type MembershipWithOrganization = Membership & { organization?: Organization | null };
    const membershipRows = dedupeMembershipRowsByOrg(
      ((memberships || []) as MembershipWithOrganization[])
        .filter((row) => row.accepted_at !== null),
    );

    const orgs: Organization[] = membershipRows
      .map((row) => row.organization || null)
      .filter((row): row is Organization => row !== null);
    const saved = loadWorkspace();
    const storedOrgId = getStoredActiveOrgId();
    membershipsByOrgRef.current = new Map(
      membershipRows.map((row) => [row.org_id, row as Membership]),
    );

    // Deterministic org resolution:
    // 1) stored active org (cookie/localStorage) 2) is_default=true 3) oldest membership by created_at.
    const targetMembership = resolveActiveMembership(membershipRows, storedOrgId);
    if (!targetMembership) {
      setState(s => ({ ...s, loading: false }));
      return;
    }

    const targetOrg = orgs.find(o => o.id === targetMembership.org_id) || orgs[0];
    if (!targetOrg) {
      setState(s => ({ ...s, loading: false }));
      return;
    }
    setStoredActiveOrgId(targetOrg.id);

    const bizList = await loadBusinessesForOrg(
      targetOrg.id,
      user.id,
      (targetMembership as Membership).role,
    );
    const targetBiz = bizList.find(
      (b) => saved?.orgId === targetOrg.id && saved?.bizId && b.id === saved.bizId,
    ) || bizList[0] || null;

    if (targetOrg && targetBiz) {
      saveWorkspace(targetOrg.id, targetBiz.id);
    }

    setState({
      org: targetOrg,
      biz: targetBiz,
      membership: targetMembership as Membership,
      orgs,
      memberships: membershipRows as Membership[],
      businesses: bizList,
      loading: false,
    });
  }, [loadBusinessesForOrg, supabase]);

  useEffect(() => { load(); }, [load]);

  const switchOrg = async (orgId: string) => {
    const org = state.orgs.find(o => o.id === orgId);
    if (!org) return;

    setState(s => ({ ...s, loading: true }));

    // Persist deterministic default workspace server-side (best effort).
    try {
      await fetch('/api/workspace/active-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      });
    } catch {
      // Keep client-side switching resilient even if persistence fails.
    }

    const currentMembership = membershipsByOrgRef.current.get(orgId) || null;
    const actingUserId = currentMembership?.user_id || state.membership?.user_id || '';
    const bizList = actingUserId
      ? await loadBusinessesForOrg(orgId, actingUserId, currentMembership?.role)
      : [];
    const biz = bizList[0] || null;
    setStoredActiveOrgId(orgId);
    if (biz) saveWorkspace(orgId, biz.id);

    setState(s => ({
      ...s,
      org,
      membership: membershipsByOrgRef.current.get(orgId) || s.membership,
      businesses: bizList,
      biz,
      loading: false,
    }));
  };

  const switchBiz = (bizId: string) => {
    const biz = state.businesses.find(b => b.id === bizId) || null;
    if (biz && state.org) {
      saveWorkspace(state.org.id, biz.id);
      setState(s => ({ ...s, biz }));
    }
  };

  return (
    <WorkspaceContext.Provider value={{ ...state, switchOrg, switchBiz, reload: load }}>
      {children}
    </WorkspaceContext.Provider>
  );
}
