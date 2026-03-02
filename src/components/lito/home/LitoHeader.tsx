'use client';

import BusinessSwitcher from '@/components/lito/home/BusinessSwitcher';

type BusinessOption = {
  id: string;
  name: string;
};

type LitoHeaderProps = {
  greeting: string;
  priorityLine: string;
  advancedLabel: string;
  businessLabel: string;
  businesses: BusinessOption[];
  activeBizId: string | null;
  onBizChange: (bizId: string) => void;
  onOpenAdvanced: () => void;
};

export default function LitoHeader({
  greeting,
  priorityLine,
  advancedLabel,
  businessLabel,
  businesses,
  activeBizId,
  onBizChange,
  onOpenAdvanced,
}: LitoHeaderProps) {
  return (
    <header className="lito-home-header">
      <div>
        <h1 className="lito-home-greeting">{greeting}</h1>
        <p className="lito-home-priority">{priorityLine}</p>
      </div>

      <div className="lito-home-header-actions">
        <BusinessSwitcher
          businesses={businesses}
          activeBizId={activeBizId}
          label={businessLabel}
          onChange={onBizChange}
        />
        <button type="button" className="lito-home-advanced-button" onClick={onOpenAdvanced}>
          {advancedLabel}
        </button>
      </div>
    </header>
  );
}
