import type { LitoMemberRole } from '@/lib/ai/lito-rbac';

type BuildGlobalPropsInput = {
  userId: string;
  bizId?: string | null;
  orgId?: string | null;
  role?: LitoMemberRole | null;
  mode?: 'basic' | 'advanced';
  platform?: 'web' | 'mobile_web' | 'pwa';
  timezone?: string | null;
  sessionId?: string | null;
};

function resolveAppVersion(): string {
  return (
    process.env.NEXT_PUBLIC_APP_VERSION
    || process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.npm_package_version
    || 'dev'
  );
}

export function buildGlobalProps(input: BuildGlobalPropsInput): Record<string, unknown> {
  const fallbackTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return {
    user_id: input.userId,
    biz_id: input.bizId || null,
    org_id: input.orgId || null,
    role: input.role || null,
    mode: input.mode || 'basic',
    platform: input.platform || 'web',
    app_version: resolveAppVersion(),
    timezone: input.timezone || fallbackTimezone,
    session_id: input.sessionId || null,
  };
}
