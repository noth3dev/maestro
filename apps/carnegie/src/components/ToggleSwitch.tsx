export function ToggleSwitch({ on, onToggle, label = "Toggle setting" }: { on: boolean; onToggle: () => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`toggle${on ? " on" : ""}`}
      onClick={onToggle}
    />
  );
}
