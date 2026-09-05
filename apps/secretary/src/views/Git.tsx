import { Icon } from "../icons.js";

export function Git({ onBack }: { onBack: () => void }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <div className="gitbar">
        <div className="gitbar-back" onClick={onBack}><Icon name="arrow-left" /> back</div>
        <div className="gitbar-path"><Icon name="folder" /> .worktrees/hero-section</div>
        <div className="gitbar-branch"><Icon name="git-branch" /> scout-1/hero-section</div>
        <div className="gitbar-tabs">
          <button className="on">changes</button>
          <button>history</button>
          <button>compare</button>
        </div>
      </div>
      <div className="git-body">
        <div className="git-files">
          <div className="git-files-label">changed files · 3</div>
          <div className="git-file-item on"><Icon name="file" style={{ width: 14, height: 14, color: "var(--text-muted)" }} /><span className="name">hero.tsx</span><span className="stat stat-M">M</span></div>
          <div className="git-file-item"><Icon name="file" style={{ width: 14, height: 14, color: "var(--text-muted)" }} /><span className="name">hero.module.css</span><span className="stat stat-M">M</span></div>
          <div className="git-file-item"><Icon name="file-plus" style={{ width: 14, height: 14, color: "var(--text-muted)" }} /><span className="name">hero.test.tsx</span><span className="stat stat-A">A</span></div>
          <div className="git-files-label" style={{ marginTop: 10 }}>evidence bundle</div>
          <div className="git-file-item"><Icon name="clipboard-check" style={{ width: 14, height: 14, color: "var(--text-muted)" }} /><span className="name">test logs</span></div>
          <div className="git-file-item"><Icon name="hash" style={{ width: 14, height: 14, color: "var(--text-muted)" }} /><span className="name">sha256 4f2a…</span></div>
        </div>
        <div className="diff-pane">
          <div className="diff-head">hero.tsx
            <div className="diff-cert"><Icon name="check" /> certified</div>
          </div>
          <div className="diff-code">
            <div className="diff-line ctx">{"12   export function Hero() {"}</div>
            <div className="diff-line rm">{'13 -   return <div className="old">'}</div>
            <div className="diff-line add">{"13 +   return <section className={styles.hero}>"}</div>
            <div className="diff-line add">{"14 +     <h1>{title}</h1>"}</div>
            <div className="diff-line ctx">{"15     <p>{subtitle}</p>"}</div>
            <div className="diff-line rm">{"16 -   </div>"}</div>
            <div className="diff-line add">{"16 +   </section>"}</div>
            <div className="diff-line ctx">{"17 }"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
