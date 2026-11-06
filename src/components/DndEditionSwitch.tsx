import type { DndEdition } from '../../shared/dnd-edition';

export function DndEditionSwitch({
  value,
  onChange,
  compact = false,
  disabled = false,
}: {
  value: DndEdition;
  onChange: (value: DndEdition) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      className={`dnd-edition-switch${compact ? ' compact' : ''}`}
      role="group"
      aria-label="D&D 规则版本"
    >
      {(['2014', '2024'] as const).map((edition) => (
        <button
          type="button"
          key={edition}
          disabled={disabled}
          aria-pressed={value === edition}
          onClick={() => onChange(edition)}
        >
          {edition}
          <span>版</span>
        </button>
      ))}
    </div>
  );
}
