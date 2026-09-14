import { useState } from "react";
import { useConnection } from "../connection.js";
import { useT } from "../i18n/index.js";

export function Setup() {
  const t = useT();
  const { connect } = useConnection();
  const [apiUrl, setApiUrl] = useState("http://127.0.0.1:4310");
  const [token, setToken] = useState("");
  const [projectId, setProjectId] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
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
      <div className="home-title">{t.setup.title}</div>
      <form className="home-composer" style={{ maxWidth: 380, width: "100%" }} onSubmit={(event) => void submit(event)}>
        <p className="form-hint" style={{ marginBottom: 12 }}>{t.setup.hint}</p>
        <div className="form-field" style={{ marginBottom: 12 }}>
          <label className="form-label" htmlFor="setup-api-url">{t.setup.apiUrl}</label>
          <input id="setup-api-url" className="input" value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} required />
        </div>
        <div className="form-field" style={{ marginBottom: 12 }}>
          <label className="form-label" htmlFor="setup-token">{t.setup.token}</label>
          <input id="setup-token" className="input" type="password" value={token} onChange={(event) => setToken(event.target.value)} required />
        </div>
        <div className="form-field" style={{ marginBottom: 12 }}>
          <label className="form-label" htmlFor="setup-project-id">{t.setup.projectId}</label>
          <input id="setup-project-id" className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)} required />
        </div>
        {error !== undefined && <div className="alert alert-warning" style={{ marginBottom: 12 }}>{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={connecting} style={{ width: "100%", justifyContent: "center" }}>
          {connecting ? t.setup.connecting : t.setup.connect}
        </button>
      </form>
    </div>
  );
}
