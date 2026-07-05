export const ROOM_ICONS = [
  '🛋️', '🛏️', '🍳', '🍽️', '🛁', '🚪', '🖥️', '📺',
  '🎮', '🌳', '🚗', '🧺', '📚', '🎄', '⭐', '💡'
] as const;

export function IconPicker({
  value,
  onChange
}: {
  value: string | null;
  onChange: (icon: string | null) => void;
}) {
  return (
    <div className="icon-picker" role="radiogroup" aria-label="room icon">
      {ROOM_ICONS.map((icon) => (
        <button
          key={icon}
          type="button"
          role="radio"
          aria-checked={value === icon}
          aria-label={`icon ${icon}`}
          className={`icon-picker-item${value === icon ? ' icon-picker-selected' : ''}`}
          onClick={() => onChange(value === icon ? null : icon)}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}
