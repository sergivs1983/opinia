export type IntegrationEvent =
  | 'planner.ready'
  | 'planner.published'
  | 'reply.approved'
  | 'asset.created'
  | 'export.created';

export interface IntegrationEventPayload {
  event: IntegrationEvent;
  occurred_at: string;
  request_id: string;
  business: {
    id: string;
    name?: string;
  };
  data: Record<string, unknown>;
}

