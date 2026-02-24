'use client';

import Badge from '@/components/ui/Badge';
import { useT } from '@/components/i18n/I18nContext';

interface GuardrailStatusBadgeProps {
  warningsCount: number;
}

export default function GuardrailStatusBadge({ warningsCount }: GuardrailStatusBadgeProps) {
  const t = useT();

  if (warningsCount > 0) {
    return (
      <Badge variant="danger" data-testid="inbox-guardrail-status">
        {t('dashboard.inbox.guardrailWarning')}
      </Badge>
    );
  }

  return (
    <Badge variant="success" data-testid="inbox-guardrail-status">
      {t('dashboard.inbox.guardrailOk')}
    </Badge>
  );
}
