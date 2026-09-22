import React, { useState } from "react";
import type { Certification, CertifyWorkerInput, DepartmentAcceptance, EvidenceBundleRead, IntegrationCommit } from "@maestro/contracts";
import { Icon } from "../icons.js";
import {
  acceptWorkerAfterIntegration,
  certifyConditionalWorkerAfterAcceptance,
  certifyWorkerAfterAcceptance,
  type IntegrationApi,
} from "../lib/integration-data.js";
import { newCommandId } from "../lib/command-id.js";

export interface WorkerReviewProps {
  api: Pick<IntegrationApi, "acceptWorker" | "certifyWorker" | "certifyConditionalWorker">;
  projectId: string;
  workerId: string;
  certifyingDepartmentId: string;
  integrationCommit: IntegrationCommit | undefined;
  acceptance: DepartmentAcceptance | undefined;
  evidenceBundle: EvidenceBundleRead | undefined;
  certifications: readonly Certification[];
  onAccepted?: (acceptance: DepartmentAcceptance) => void;
  onCertified?: (certification: Certification) => void;
}

/**
 * Renders the real integration commit, evidence bundle, and certification history for one Worker,
 * and only enables acceptance/certification once the server has already produced that real state.
 * There is no fake or synthesized evidence path here; every gate reads server-issued data.
 */
export function WorkerReview({
  api,
  projectId,
  workerId,
  certifyingDepartmentId,
  integrationCommit,
  acceptance,
  evidenceBundle,
  certifications,
  onAccepted,
  onCertified,
}: WorkerReviewProps) {
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [conditionalKind, setConditionalKind] = useState<"security" | "safety_compliance">("security");
  const [conditionReason, setConditionReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const hasIntegrationCommit = integrationCommit !== undefined && integrationCommit.evidenceReferences.length > 0;
  const hasEvidenceBundle = evidenceBundle !== undefined;
  const hasTestEvidence = integrationCommit !== undefined && integrationCommit.evidenceReferences.length > 0;
  const hasCertifyingDepartment = certifyingDepartmentId.trim() !== "";
  const canAccept = hasIntegrationCommit && hasEvidenceBundle && acceptance === undefined && confirmed && reason.trim() !== "" && !busy;
  const canCertify = acceptance !== undefined && hasEvidenceBundle && hasTestEvidence && hasCertifyingDepartment && confirmed && !busy;
  const canCertifyConditional =
    acceptance !== undefined &&
    hasEvidenceBundle &&
    hasTestEvidence &&
    hasCertifyingDepartment &&
    confirmed &&
    conditionReason.trim() !== "" &&
    !busy;

  const accept = async (): Promise<void> => {
    if (!canAccept || integrationCommit === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await acceptWorkerAfterIntegration(
        api,
        workerId,
        integrationCommit,
        { projectId, reason: reason.trim() },
        newCommandId(),
      );
      onAccepted?.(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not accept Worker");
    } finally {
      setBusy(false);
    }
  };

  const certify = async (): Promise<void> => {
    if (!canCertify) return;
    setBusy(true);
    setError(undefined);
    try {
      const substance: CertifyWorkerInput["substance"] = {
        verdict: "passed",
        findings: [],
        testEvidenceIds: integrationCommit?.evidenceReferences ? [...integrationCommit.evidenceReferences] : [],
      };
      const result = await certifyWorkerAfterAcceptance(
        api,
        workerId,
        acceptance,
        { projectId, certifyingDepartmentId, substance },
        newCommandId(),
      );
      onCertified?.(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not certify Worker");
    } finally {
      setBusy(false);
    }
  };

  const certifyConditional = async (): Promise<void> => {
    if (!canCertifyConditional) return;
    setBusy(true);
    setError(undefined);
    try {
      const substance: CertifyWorkerInput["substance"] = {
        verdict: "blocked",
        findings: [{ findingId: "condition", severity: "noncritical", description: conditionReason.trim() }],
        testEvidenceIds: integrationCommit?.evidenceReferences ? [...integrationCommit.evidenceReferences] : [],
      };
      const result = await certifyConditionalWorkerAfterAcceptance(
        api,
        workerId,
        acceptance,
        conditionalKind,
        { projectId, certifyingDepartmentId, substance },
        newCommandId(),
      );
      onCertified?.(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not conditionally certify Worker");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="worker-review" aria-labelledby="worker-review-heading">
      <h3 id="worker-review-heading">Worker review</h3>
      <p>worker {workerId}</p>

      <div className="worker-review-integration">
        <h4>integration state</h4>
        {integrationCommit === undefined && <p>No real integration commit has been produced for this Worker yet.</p>}
        {integrationCommit !== undefined && (
          <>
            <p>commit {integrationCommit.commitSha.slice(0, 12)}…</p>
            <p>{integrationCommit.message}</p>
            <p>
              test output references:{" "}
              {integrationCommit.evidenceReferences.length === 0 ? "none" : integrationCommit.evidenceReferences.join(", ")}
            </p>
          </>
        )}
      </div>

      <div className="worker-review-evidence">
        <h4>evidence bundle</h4>
        {evidenceBundle === undefined && (
          <>
            <p>No evidence bundle loaded yet.</p>
            <p className="form-hint">Acceptance and certification require a server-issued evidence bundle.</p>
          </>
        )}
        {evidenceBundle !== undefined && (
          <p>
            bundle {evidenceBundle.bundleId} · hash {evidenceBundle.hash.slice(0, 12)}…
          </p>
        )}
      </div>

      <div className="worker-review-certifications">
        <h4>certification history</h4>
        {certifications.length === 0 && <p>No certifications recorded for this Worker yet.</p>}
        {certifications.map((certification) => (
          <p key={certification.certificationId}>
            {certification.kind} · {certification.verdict} · certified by {certification.certifiedByDepartment}
          </p>
        ))}
      </div>

      <div className="worker-review-actions">
        <label className="form-field" htmlFor="worker-review-confirm">
          <input id="worker-review-confirm" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>I have reviewed the real integration commit, test output, and evidence above</span>
        </label>

        {acceptance === undefined && (
          <>
            <p className="form-hint">
              Acceptance input: project {projectId} · reason {reason.trim() === "" ? "not provided" : reason.trim()}
            </p>
            <label className="form-field" htmlFor="worker-review-reason">
              <span className="form-label">Acceptance reason</span>
              <input
                id="worker-review-reason"
                className="input"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={!hasIntegrationCommit}
              />
            </label>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void accept()} disabled={!canAccept}>
              <Icon name="check" /> Accept worker
            </button>
          </>
        )}

        {acceptance !== undefined && (
          <p>
            accepted by {acceptance.acceptedBy} · commit {acceptance.commitSha.slice(0, 12)}…
          </p>
        )}

        <p className="form-hint">
          Quality certification input: project {projectId} · department {certifyingDepartmentId || "not provided"} · verdict passed · test
          evidence {integrationCommit?.evidenceReferences.join(", ") || "none"}
        </p>
        <button type="button" className="btn btn-sm" onClick={() => void certify()} disabled={!canCertify}>
          <Icon name="check" /> Certify worker
        </button>

        <label className="form-field" htmlFor="worker-review-conditional-kind">
          <span className="form-label">Conditional certification kind</span>
          <select
            id="worker-review-conditional-kind"
            className="input"
            value={conditionalKind}
            onChange={(event) => setConditionalKind(event.target.value as "security" | "safety_compliance")}
          >
            <option value="security">security</option>
            <option value="safety_compliance">safety_compliance</option>
          </select>
        </label>
        <label className="form-field" htmlFor="worker-review-condition-reason">
          <span className="form-label">Condition</span>
          <input
            id="worker-review-condition-reason"
            className="input"
            value={conditionReason}
            onChange={(event) => setConditionReason(event.target.value)}
          />
        </label>
        <p className="form-hint">
          Conditional certification input: kind {conditionalKind} · condition{" "}
          {conditionReason.trim() === "" ? "not provided" : conditionReason.trim()} · verdict blocked
        </p>
        <button type="button" className="btn btn-sm" onClick={() => void certifyConditional()} disabled={!canCertifyConditional}>
          <Icon name="shield-alert" /> Certify conditionally
        </button>
        <p className="form-hint">A conditional certification always shows its condition and never renders as a passed certification.</p>
      </div>
      {error !== undefined && (
        <p className="alert alert-warning" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
