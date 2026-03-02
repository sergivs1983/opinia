'use client';

type BusinessOption = {
  id: string;
  name: string;
};

type BusinessSwitcherProps = {
  businesses: BusinessOption[];
  activeBizId: string | null;
  label: string;
  onChange: (nextBizId: string) => void;
};

export default function BusinessSwitcher({
  businesses,
  activeBizId,
  label,
  onChange,
}: BusinessSwitcherProps) {
  if (!businesses.length) {
    return (
      <div className="lito-home-switcher is-disabled">
        <span className="lito-home-switcher-label">{label}</span>
        <span className="lito-home-switcher-value">-</span>
      </div>
    );
  }

  return (
    <label className="lito-home-switcher" htmlFor="lito-business-switcher">
      <span className="lito-home-switcher-label">{label}</span>
      <select
        id="lito-business-switcher"
        className="lito-home-switcher-select"
        value={activeBizId || businesses[0]?.id}
        onChange={(event) => onChange(event.target.value)}
      >
        {businesses.map((business) => (
          <option key={business.id} value={business.id}>
            {business.name}
          </option>
        ))}
      </select>
    </label>
  );
}
