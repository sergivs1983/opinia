'use client';

type LitoTheme = 'day' | 'night';

type ThemeToggleProps = {
  theme: LitoTheme;
  dayLabel: string;
  nightLabel: string;
  onChange: (theme: LitoTheme) => void;
};

export default function ThemeToggle({ theme, dayLabel, nightLabel, onChange }: ThemeToggleProps) {
  return (
    <div className="lito-home-theme-toggle" role="tablist" aria-label="LITO theme">
      <button
        type="button"
        role="tab"
        aria-selected={theme === 'day'}
        className={theme === 'day' ? 'active' : undefined}
        onClick={() => onChange('day')}
      >
        {dayLabel}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={theme === 'night'}
        className={theme === 'night' ? 'active' : undefined}
        onClick={() => onChange('night')}
      >
        {nightLabel}
      </button>
    </div>
  );
}
