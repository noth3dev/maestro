import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "../icons.js";

export function WindowChrome({ children }: { children: ReactNode }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const active = true;
    void window.maestro.windowControls.isMaximized().then((value) => {
      if (active) setMaximized(value);
    });
    return window.maestro.windowControls.onStateChange(setMaximized);
  }, []);

  const toggleMaximize = () => {
    void window.maestro.windowControls.toggleMaximize().then(setMaximized);
  };

  return (
    <div className="window-shell">
      <header
        className="window-titlebar"
        onDoubleClick={toggleMaximize}
        aria-label="Carnegie window title bar"
      >
        <div className="window-brand">
          <span className="window-brand-mark" aria-hidden="true" />
          <span className="window-brand-name">Carnegie</span>
          <span className="window-brand-context">operator console</span>
        </div>
        <div className="window-controls" onDoubleClick={(event) => event.stopPropagation()} role="group" aria-label="Window controls">
          <button type="button" className="window-control" aria-label="Minimize window" title="Minimize" onClick={() => window.maestro.windowControls.minimize()}>
            <Icon name="minus" />
          </button>
          <button type="button" className="window-control" aria-label={maximized ? "Restore window" : "Maximize window"} title={maximized ? "Restore" : "Maximize"} onClick={toggleMaximize}>
            <Icon name={maximized ? "copy" : "square"} />
          </button>
          <button type="button" className="window-control window-control-close" aria-label="Close window" title="Close" onClick={() => window.maestro.windowControls.close()}>
            <Icon name="x" />
          </button>
        </div>
      </header>
      <div className="window-content">{children}</div>
    </div>
  );
}
