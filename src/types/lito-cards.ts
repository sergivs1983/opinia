export type ActionCardMode = 'basic' | 'advanced';

export type ActionCardRole = 'owner' | 'manager' | 'staff';

export type ActionCardType =
  | 'due_post'
  | 'draft_approval'
  | 'week_unplanned'
  | 'signal'
  | 'follow_up';

export type ActionCardSeverity = 'high' | 'medium' | 'low';

export type ActionCardCtaAction =
  | 'copy_open'
  | 'snooze'
  | 'mark_done'
  | 'approve'
  | 'regenerate'
  | 'edit'
  | 'view_only'
  | 'open_weekly_wizard'
  | 'view_recommendation'
  | 'ack'
  | 'open_pending';

export type ActionCardCta = {
  label: string;
  action: ActionCardCtaAction;
  payload: Record<string, unknown>;
};

export type ActionCardRef = {
  kind: string;
  id: string;
};

export interface ActionCard {
  id: string;
  type: ActionCardType;
  priority: number;
  severity: ActionCardSeverity;
  title: string;
  subtitle: string;
  primary_cta: ActionCardCta;
  secondary_cta?: ActionCardCta;
  expandable?: boolean;
  refs: ActionCardRef[];
}
