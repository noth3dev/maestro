import { useEffect, useRef, useState } from "react";
import { useConnection } from "../connection.js";
import { bootstrapProgressText } from "../bootstrap-status.js";
import { useT } from "../i18n/index.js";
import { redactSensitiveText } from "../lib/command-id.js";

export function Setup() {
  const t = useT();
  const { connect, setupError, bootstrap, retryBootstrap, retryingBootstrap } = useConnection();
  const [apiUrl, setApiUrl] = useState("http://127.0.0.1:4310");
  const [token, setToken] = useState("");
  const [projectId, setProjectId] = useState("");
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [connecting, setConnecting] = useState(false);
  const retryStarted = useRef(false);
  const [retryFailed, setRetryFailed] = useState(false);
  const canRetryLocal = retryingBootstrap || (bootstrap.phase === "setup-required" && bootstrap.canRetryLocal === true);
  const error = formError ?? setupError;
  const setupErrorText = setupError?.toLowerCase() ?? "";
  const recoveryHint = setupErrorText.includes("maestro_local_db_engine")
    ? t.setup.databaseEngineRecoveryHint
    : setupErrorText.includes("maestro_embedded_database_port")
      ? t.setup.databasePortRecoveryHint
      : setupErrorText.includes("docker is required for local automatic setup but is not available")
        ? t.setup.dockerUnavailableRecoveryHint
        : setupErrorText.includes("docker logs maestro-local-postgres") || setupErrorText.includes("docker ps -a")
          ? t.setup.dockerDiagnosticsRecoveryHint
          : t.setup.retryHint;
  const showRecoveryHint = setupError !== undefined && (formError === undefined || formError === setupError);
  const retryProgressText = retryingBootstrap
    ? bootstrapProgressText(
        bootstrap,
        t.setup.retryingLocal,
        t.setup.progressSteps,
        t.setup.completedProgressSteps,
        t.setup.retryFailed,
      )
    : t.setup.retryFailed;

  useEffect(() => {
    if (retryingBootstrap) {
      retryStarted.current = true;
      setRetryFailed(false);
    } else if (retryStarted.current) {
      retryStarted.current = false;
      setRetryFailed(bootstrap.phase === "setup-required");
    }
  }, [bootstrap.phase, retryingBootstrap]);

  const retryLocalSetup = async () => {
    if (retryingBootstrap || connecting) return;
    setFormError(undefined);
    try {
      await retryBootstrap();
    } catch (cause) {
      setFormError(redactSensitiveText(cause instanceof Error ? cause.message : "Could not retry local setup"));
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (retryingBootstrap || connecting) return;
    setFormError(undefined);
    setConnecting(true);
    try {
      await connect({ apiUrl, token, projectId });
    } catch (cause) {
      setFormError(redactSensitiveText(cause instanceof Error ? cause.message : "Could not save the connection"));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <main className="home-main" aria-label={t.setup.title}>
      <h1 id="setup-title" className="home-title setup-title" tabIndex={-1}>{t.setup.title}</h1>
      <form className="home-composer setup-card" onSubmit={(event) => void submit(event)}>
        <p className="form-hint setup-hint">{t.setup.hint}</p>
        {error !== undefined && (
          <div className="alert alert-warning setup-error" role="alert">
            {error}
          </div>
        )}
        {showRecoveryHint && <p className="form-hint setup-recovery-hint">{recoveryHint}</p>}
        {canRetryLocal && (
          <div className="setup-retry">
            {(retryingBootstrap || retryFailed) && (
              <p className="form-hint setup-progress" role="status" aria-live="polite" aria-atomic="true">
                {retryProgressText}
              </p>
            )}
            <button
              id="setup-retry-button"
              className="btn btn-primary setup-retry-button"
              type="button"
              aria-disabled={retryingBootstrap || connecting}
              onClick={() => void retryLocalSetup()}
            >
              {t.setup.retryLocal}
            </button>
          </div>
        )}
        <h2 className="setup-manual-title">{t.setup.manualTitle}</h2>
        <p className="form-hint setup-manual-hint">{t.setup.manualHint}</p>
        <div className="form-field">
          <label className="form-label" htmlFor="setup-api-url">
            {t.setup.apiUrl}
          </label>
          <input id="setup-api-url" className="input" value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} required disabled={retryingBootstrap} />
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor="setup-token">
            {t.setup.token}
          </label>
          <input
            id="setup-token"
            className="input"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            required
            disabled={retryingBootstrap}
          />
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor="setup-project-id">
            {t.setup.projectId}
          </label>
          <input
            id="setup-project-id"
            className="input"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            required
            disabled={retryingBootstrap}
          />
        </div>
        <button className={canRetryLocal ? "btn setup-submit" : "btn btn-primary setup-submit"} type="submit" disabled={connecting || retryingBootstrap}>
          {connecting ? t.setup.connecting : t.setup.connect}
        </button>
      </form>
    </main>
  );
}
