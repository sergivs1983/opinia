import type {
  ActionCardCtaAction,
  ActionCardRole,
  ActionCardType,
} from '@/types/lito-cards';

type CardRoleCtaMatrix = Record<ActionCardType, Record<ActionCardRole, ActionCardCtaAction[]>>;

const CARD_ROLE_CTA_MATRIX: CardRoleCtaMatrix = {
  due_post: {
    owner: ['copy_open', 'snooze', 'mark_done'],
    manager: ['copy_open', 'snooze', 'mark_done'],
    staff: ['copy_open', 'mark_done'],
  },
  draft_approval: {
    owner: ['approve', 'regenerate', 'edit'],
    manager: ['approve', 'regenerate', 'edit'],
    staff: ['view_only'],
  },
  week_unplanned: {
    owner: ['open_weekly_wizard'],
    manager: ['open_weekly_wizard'],
    staff: ['view_only'],
  },
  signal: {
    owner: ['view_recommendation', 'ack'],
    manager: ['view_recommendation', 'ack'],
    staff: ['ack'],
  },
  follow_up: {
    owner: ['open_pending', 'copy_open', 'mark_done', 'snooze'],
    manager: ['open_pending', 'copy_open', 'mark_done', 'snooze'],
    staff: ['open_pending', 'copy_open', 'mark_done'],
  },
};

export function getAllowedCardActions(type: ActionCardType, role: ActionCardRole): ActionCardCtaAction[] {
  return CARD_ROLE_CTA_MATRIX[type][role];
}
