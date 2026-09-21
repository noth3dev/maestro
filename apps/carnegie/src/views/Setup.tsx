import { useState } from "react";
import { useConnection } from "../connection.js";
import { useT } from "../i18n/index.js";

export function Setup() {
  const t = useT();
  const { connect, setupError } = useConnection();
  const [apiUrl, setApiUrl] = useState("http://127.0.0.1:4310");
  const [token, setToken] = useState("");
  const [projectId, setProjectId] = useState("");
  const [error, setError] = useState<string | undefined>(setupError);
  const [connecting, setConnecting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(undefined);
    setConnecting(true);
    try {
      await connect({ apiUrl, token, projectId });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the connection");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="home-main">
      <div className="home-title setup-title">{t.setup.title}</div>
      <form className="home-composer setup-card" onSubmit={(event) => void submit(event)}>
        <p className="form-hint setup-hint">{t.setup.hint}</p>
        <div className="form-field">
          <label className="form-label" htmlFor="setup-api-url">{t.setup.apiUrl}</label>
          <input id="setup-api-url" className="input" value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} required />
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor="setup-token">{t.setup.token}</label>
          <input id="setup-token" className="input" type="password" value={token} onChange={(event) => setToken(event.target.value)} required />
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor="setup-project-id">{t.setup.projectId}</label>
          <input id="setup-project-id" className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)} required />
        </div>
        {error !== undefined && <div className="alert alert-warning setup-error">{error}</div>}
        <button className="btn btn-primary setup-submit" type="submit" disabled={connecting}>
          {connecting ? t.setup.connecting : t.setup.connect}
        </button>
      </form>
    </div>
  );
}
