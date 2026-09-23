import React, { type CSSProperties } from "react";
import type { ModelCatalogEntry } from "@maestro/contracts";

export function reasoningEffortOptions(model: ModelCatalogEntry | undefined): readonly string[] {
  return model?.reasoningEfforts?.supported ?? [];
}

export function defaultReasoningEffort(model: ModelCatalogEntry | undefined): string | undefined {
  const options = reasoningEffortOptions(model);
  if (options.length === 0) return undefined;
  const preferred = model?.reasoningEfforts?.default;
  return preferred !== null && preferred !== undefined && options.includes(preferred) ? preferred : options[0];
}

function readableEffort(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function ReasoningDial({
  model,
  value,
  onChange,
  disabled = false,
  id = "reasoning-effort",
}: {
  readonly model: ModelCatalogEntry | undefined;
  readonly value: string | undefined;
  readonly onChange: (value: string | undefined) => void;
  readonly disabled?: boolean;
  readonly id?: string;
}) {
  const options = reasoningEffortOptions(model);
  const active = value !== undefined && options.includes(value) ? value : defaultReasoningEffort(model);
  const index = active === undefined ? 0 : Math.max(0, options.indexOf(active));
  const angle = options.length <= 1 ? 0 : -135 + (270 * index) / (options.length - 1);
  const supported = options.length > 0;
  const dialStyle = { "--dial-angle": `${angle}deg` } as CSSProperties;
  return (
    <div className="reasoning-control" data-supported={supported ? "true" : "false"}>
      <div className="reasoning-control-head">
        <label htmlFor={id}>Thinking strength</label>
        <output htmlFor={id}>{active === undefined ? "provider default" : readableEffort(active)}</output>
      </div>
      <div className="reasoning-dial" style={dialStyle}>
        <span className="reasoning-dial-face" aria-hidden="true">
          <span className="reasoning-dial-notch" />
        </span>
        <input
          id={id}
          className="reasoning-dial-input"
          type="range"
          min={0}
          max={Math.max(0, options.length - 1)}
          step={1}
          value={index}
          disabled={disabled || !supported}
          aria-label="Thinking strength"
          aria-valuetext={active === undefined ? "provider default" : readableEffort(active)}
          onChange={(event) => onChange(options[Number(event.target.value)])}
        />
      </div>
      <div className="reasoning-dial-scale" aria-hidden="true">
        {options.map((option) => (
          <span key={option}>{readableEffort(option)}</span>
        ))}
      </div>
      <span className="form-hint">{supported ? "Turn the dial for this model." : "This model uses the provider default."}</span>
    </div>
  );
}
