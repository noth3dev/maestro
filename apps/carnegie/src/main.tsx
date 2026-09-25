import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { installMaestroBridge } from "./bridge.js";
import { WindowChrome } from "./components/WindowChrome.js";
import "./styles/theme.css";
import "./styles/components.css";

installMaestroBridge(window);

const container = document.getElementById("root");
if (container === null) throw new Error("Missing #root element");

createRoot(container).render(
  <StrictMode>
    <WindowChrome>
      <App />
    </WindowChrome>
  </StrictMode>,
);
