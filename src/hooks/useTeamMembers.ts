'use client';

import { useCallback, useEffect, useState } from 'react';

export interface TeamMember {
  id: string;
  user_id: string;
  org_id: string;
  role: string;
  invited_email: string | null;
  accepted_at: string | null;
  created_at: string;
  full_name: string | null;
  avatar_url: string | null;
}

export interface TeamSeats {
  plan_code: 'starter_49' | 'pro_149';
  seats_limit: number;
  seats_used: number;
  seats_remaining: number;
  business_limit: number;
  businesses_used: number;
  businesses_remaining: number;
  is_full: boolean;
  is_business_limit_reached: boolean;
}

interface UseTeamMembersResult {
  members: TeamMember[];
  seats: TeamSeats | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useTeamMembers(orgId?: string | null): UseTeamMembersResult {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [seats, setSeats] = useState<TeamSeats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!orgId) {
      setMembers([]);
      setSeats(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/team?org_id=${orgId}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.message || data.error || 'Failed to load team members');
      }
      setMembers(data.members || []);
      setSeats(data.seats || null);
      setLoading(false);
    } catch (e: unknown) {
      setMembers([]);
      setSeats(null);
      setError(e instanceof Error ? e.message : 'Failed to load team members');
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { members, seats, loading, error, refetch };
}
