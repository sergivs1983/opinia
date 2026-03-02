'use client';

type CommandBarProps = {
  placeholder: string;
  sendLabel: string;
  micLabel: string;
  value: string;
  submitting?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onMic: () => void;
};

export default function CommandBar({
  placeholder,
  sendLabel,
  micLabel,
  value,
  submitting = false,
  onChange,
  onSubmit,
  onMic,
}: CommandBarProps) {
  const canSubmit = value.trim().length > 0 && !submitting;

  return (
    <div className="lito-command-bar-wrap">
      <div className="lito-command-bar" role="search">
        <input
          type="text"
          value={value}
          className="lito-command-input"
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onSubmit();
            }
          }}
        />

        <button type="button" className="lito-command-mic" aria-label={micLabel} onClick={onMic}>
          <span aria-hidden="true">🎙</span>
        </button>

        <button
          type="button"
          className="lito-command-send"
          onClick={onSubmit}
          disabled={!canSubmit}
        >
          {submitting ? '...' : sendLabel}
        </button>
      </div>
    </div>
  );
}
