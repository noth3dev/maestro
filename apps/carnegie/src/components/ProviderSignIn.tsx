import React, { useEffect, useRef, useState } from "react";
import { Icon } from "../icons.js";
import {
  createAccountLoginController,
  initialAccountLoginPanelState,
  type AccountLoginPanelState,
  type AccountLoginProviderId,
} from "../lib/account-login.js";

const providers = [
  { providerId: "openai-codex", title: "ChatGPT / Codex", connectLabel: "sign in with ChatGPT" },
  { providerId: "anthropic-claude", title: "Claude Pro/Max", connectLabel: "sign in with Claude" },
] as const satisfies readonly { providerId: AccountLoginProviderId; title: string; connectLabel: string }[];

/**
 * Shown on Home only while no live model is available. Signing in is the one
 * step Maestro cannot do on the operator's behalf; everything else starts
 * automatically.
 */
export function ProviderSignIn({ onConnected }: { onConnected: () => void }) {
  const [busy, setBusy] = useState<string | undefined>();
  const [panels, setPanels] = useState<Record<AccountLoginProviderId, AccountLoginPanelState>>({
    "openai-codex": initialAccountLoginPanelState,
    "anthropic-claude": initialAccountLoginPanelState,
  });
  const refs = useRef<Record<AccountLoginProviderId, { loginId?: string; abort?: AbortController }>>({
    "openai-codex": {},
    "anthropic-claude": {},
  });
  useEffect(() => () => {
    refs.current["openai-codex"].abort?.abort();
    refs.current["anthropic-claude"].abort?.abort();
  }, []);

  const setPanel = (providerId: AccountLoginProviderId, patch: Partial<AccountLoginPanelState>) =>
    setPanels((current) => ({ ...current, [providerId]: { ...current[providerId], ...patch } }));

  return (
    <section className="provider-signin" aria-labelledby="provider-signin-title">
      <h2 id="provider-signin-title" className="provider-signin-title">Connect a model account to start</h2>
      <p className="form-hint">Maestro set up everything else automatically. Sign in once in your browser; credentials stay in the local Model Gateway.</p>
      <div className="provider-signin-list">
        {providers.map(({ providerId, title, connectLabel }) => {
          const panel = panels[providerId];
          const controller = createAccountLoginController({
            providerId,
            label: title,
            ref: refs.current[providerId],
            api: window.maestro.api,
            openExternal: window.maestro.external.openProviderAuth,
            refreshProviderSettings: async () => onConnected(),
            getBusy: () => busy,
            setBusy,
            setPanelState: (patch) => setPanel(providerId, patch),
            setConnected: () => undefined,
          });
          const waiting = panel.loginState === "waiting" || panel.loginState === "opening";
          return (
            <div className="provider-account-card" key={providerId}>
              <div className="provider-account-head">
                <div className="provider-account-icon"><Icon name="message-circle" /></div>
                <div className="provider-account-copy"><h3>{title}</h3></div>
                {waiting ? (
                  <button type="button" className="btn btn-sm" onClick={() => void controller.cancel()}>cancel sign-in</button>
                ) : (
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy !== undefined} onClick={() => void controller.start()}>
                    {panel.loginState === "error" ? "try again" : connectLabel}
                  </button>
                )}
              </div>
              {panel.message !== undefined && (
                <p className={`provider-account-message${panel.loginState === "error" ? " is-error" : ""}`} role={panel.loginState === "error" ? "alert" : "status"}>
                  {panel.message}
                </p>
              )}
              {panel.url !== undefined && waiting && (
                <div className="provider-account-link-row">
                  <a href={panel.url} target="_blank" rel="noreferrer">{panel.url}</a>
                  <button type="button" className="btn btn-sm" onClick={() => void controller.copyLink(panel.url)}>
                    {panel.linkCopied ? "copied" : "copy link"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
