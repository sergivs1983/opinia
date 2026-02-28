'use client';

export const LITO_COPY_UPDATED_EVENT = 'opinia:lito-copy-updated';

export type LitoCopyUpdatedDetail = {
  bizId: string;
  recommendationId: string;
  source: 'chat' | 'workbench';
};

export function emitLitoCopyUpdated(detail: LitoCopyUpdatedDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(LITO_COPY_UPDATED_EVENT, { detail }));
}

export function isLitoCopyUpdatedEvent(event: Event): event is CustomEvent<LitoCopyUpdatedDetail> {
  return event instanceof CustomEvent;
}
