export function ToggleSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return <div className={`toggle${on ? " on" : ""}`} onClick={onToggle} />;
}
