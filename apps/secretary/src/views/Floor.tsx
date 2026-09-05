import { Icon } from "../icons.js";

export function Floor({ onBack }: { onBack: () => void }) {
  return (
    <div className="floor-wrap">
      <div className="floor-head">
        <div className="gitbar-back" onClick={onBack} style={{ marginRight: 10 }}><Icon name="arrow-left" /> back</div>
        floor
        <span className="sub">launch page · movement 2 of 4</span>
      </div>
      <div className="floor-stage">
        <svg viewBox="0 0 480 420" width="100%" height="100%">
          <path d="M 40 380 A 240 240 0 0 1 440 380" fill="none" stroke="var(--border)" strokeDasharray="2 5" />
          <path d="M 90 380 A 190 190 0 0 1 390 380" fill="none" stroke="var(--border)" strokeDasharray="2 5" />
          <path d="M 150 380 A 130 130 0 0 1 330 380" fill="none" stroke="var(--border)" strokeDasharray="2 5" />

          <rect x={215} y={365} width={50} height={14} rx={2} fill="var(--terracotta)" />
          <circle cx={240} cy={352} r={18} fill="var(--terracotta)" />
          <text x={240} y={355} textAnchor="middle" fontSize={8} fill="#fff">concertmaster</text>

          <line x1={240} y1={334} x2={240} y2={255} stroke="var(--terracotta)" strokeWidth={1.5} strokeDasharray="4 4">
            <animate attributeName="stroke-dashoffset" from="16" to="0" dur="0.8s" repeatCount="indefinite" />
          </line>

          <circle cx={240} cy={255} r={17} fill="var(--p-teal)"><animate attributeName="opacity" values="1;0.55;1" dur="2.2s" repeatCount="indefinite" /></circle>
          <text x={240} y={258} textAnchor="middle" fontSize={7} fill="#fff">tech head</text>
          <circle cx={330} cy={270} r={17} fill="var(--p-teal)" /><text x={330} y={273} textAnchor="middle" fontSize={7} fill="#fff">product head</text>
          <circle cx={150} cy={270} r={17} fill="var(--p-teal)" /><text x={150} y={273} textAnchor="middle" fontSize={7} fill="#fff">ops head</text>
          <circle cx={395} cy={310} r={17} fill="var(--p-teal)" /><text x={395} y={313} textAnchor="middle" fontSize={7} fill="#fff">quality head</text>
          <circle cx={85} cy={310} r={17} fill="var(--p-teal)" /><text x={85} y={313} textAnchor="middle" fontSize={7} fill="#fff">security head</text>

          <circle cx={240} cy={150} r={12} fill="var(--terracotta)"><animate attributeName="opacity" values="1;0.5;1" dur="1.6s" repeatCount="indefinite" /></circle>
          <text x={240} y={128} textAnchor="middle" fontSize={7} fill="var(--text-secondary)">scout-1</text>
          <circle cx={310} cy={160} r={12} fill="var(--terracotta)" /><text x={310} y={138} textAnchor="middle" fontSize={7} fill="var(--text-secondary)">scout-2</text>
          <circle cx={170} cy={160} r={12} fill="var(--terracotta)"><animate attributeName="opacity" values="1;0.5;1" dur="1.9s" repeatCount="indefinite" /></circle>
          <text x={170} y={138} textAnchor="middle" fontSize={7} fill="var(--text-secondary)">scout-7</text>
          <circle cx={375} cy={185} r={12} fill="var(--terracotta)" /><text x={375} y={163} textAnchor="middle" fontSize={7} fill="var(--text-secondary)">worker-3</text>
          <circle cx={105} cy={185} r={12} fill="var(--text-muted)" /><text x={105} y={163} textAnchor="middle" fontSize={7} fill="var(--text-secondary)">idle</text>
          <circle cx={430} cy={225} r={12} fill="var(--terracotta)" /><text x={430} y={203} textAnchor="middle" fontSize={7} fill="var(--text-secondary)">worker-4</text>
          <circle cx={50} cy={225} r={12} fill="var(--text-muted)" /><text x={50} y={203} textAnchor="middle" fontSize={7} fill="var(--text-secondary)">idle</text>
          <circle cx={450} cy={280} r={12} fill="var(--terracotta)" /><text x={450} y={258} textAnchor="middle" fontSize={7} fill="var(--text-secondary)">worker-5</text>
          <circle cx={30} cy={280} r={12} fill="var(--text-muted)" /><text x={30} y={258} textAnchor="middle" fontSize={7} fill="var(--text-secondary)">idle</text>

          <circle cx={450} cy={30} r={4} fill="var(--olive)"><animate attributeName="opacity" values="0.3;1;0.3" dur="1s" repeatCount="indefinite" /></circle>
          <text x={440} y={34} textAnchor="end" fontSize={7} fill="var(--text-muted)">metronome</text>

          <g transform="translate(60,40)">
            <path d="M -10 0 A 10 10 0 0 1 10 0" fill="none" stroke="var(--ochre)" strokeWidth={1.5} />
            <circle cx={0} cy={-4} r={1.6} fill="var(--ochre)" />
            <text x={14} y={4} textAnchor="start" fontSize={7} fill="var(--ochre-text)">1 approval pending</text>
          </g>
        </svg>
      </div>
      <div className="floor-legend">
        <span><span className="legend-dot" style={{ background: "var(--terracotta)" }} /> concertmaster</span>
        <span><span className="legend-dot" style={{ background: "var(--p-teal)" }} /> head</span>
        <span><span className="legend-dot" style={{ background: "var(--terracotta)" }} /> active worker</span>
        <span><span className="legend-dot" style={{ background: "var(--text-muted)" }} /> idle</span>
      </div>
    </div>
  );
}
