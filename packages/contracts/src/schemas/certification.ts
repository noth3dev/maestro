import { z } from "zod";
import { UuidSchema } from "./common.js";

export const CertificationSchema = z
  .object({
    certificationId: UuidSchema,
    kind: z.enum(["quality", "security", "safety_compliance"]),
    goalId: UuidSchema,
    contractId: UuidSchema,
    contractVersion: z.number().int(),
    contractContentHash: z.string().min(1),
    integratedCommitSha: z.string().min(1),
    workerId: UuidSchema,
    departmentAcceptanceId: UuidSchema,
    integrationRevisionId: UuidSchema,
    verdict: z.enum(["passed", "failed", "blocked"]),
    certifiedByDepartment: z.string().min(1),
    producingDepartment: z.string().min(1),
  })
  .strict();
export type Certification = z.infer<typeof CertificationSchema>;
export const CertificationListSchema = z.object({ certifications: z.array(CertificationSchema) }).strict();
export type CertificationList = z.infer<typeof CertificationListSchema>;
export const DepartmentAcceptanceSchema = z
  .object({
    acceptanceId: UuidSchema,
    workerId: UuidSchema,
    commitSha: z.string().regex(/^[0-9a-f]{40}$/),
    reason: z.string().min(1),
    acceptedBy: z.string().min(1),
  })
  .strict();
export type DepartmentAcceptance = z.infer<typeof DepartmentAcceptanceSchema>;
const QualityFindingSchema = z
  .object({ findingId: z.string().min(1), severity: z.enum(["critical", "noncritical"]), description: z.string().min(1) })
  .strict();
export const QualityCertificationSubstanceSchema = z
  .object({
    verdict: z.enum(["passed", "failed", "blocked"]),
    findings: z.array(QualityFindingSchema),
    testEvidenceIds: z.array(z.string().min(1)),
  })
  .strict();
export type QualityCertificationSubstance = z.infer<typeof QualityCertificationSubstanceSchema>;
export const AcceptWorkerInputSchema = z.object({ projectId: UuidSchema, reason: z.string().min(1) }).strict();
export type AcceptWorkerInput = z.infer<typeof AcceptWorkerInputSchema>;
export const CertifyWorkerInputSchema = z
  .object({ projectId: UuidSchema, certifyingDepartmentId: z.string().min(1), substance: QualityCertificationSubstanceSchema })
  .strict();
export type CertifyWorkerInput = z.infer<typeof CertifyWorkerInputSchema>;

const ConcertmasterFinalReportSchema = z
  .object({
    reportId: UuidSchema,
    goalId: UuidSchema,
    success: z.boolean(),
    blockers: z.array(z.object({ reason: z.string(), detail: z.string() }).strict()),
    ceoRequest: z.string(),
    whatChanged: z.string(),
    userVisibleBehaviorPassed: z.boolean(),
    participatingDepartments: z.array(z.string()),
    keyDecisions: z.array(z.string()),
    dissent: z.array(z.string()),
    independentValidation: z.array(z.string()),
    costCents: z.number().int(),
    budgetCents: z.number().int(),
    incidents: z.array(z.string()),
    knownLimitations: z.array(z.string()),
    criticalActionAwaitingApproval: z.boolean(),
    evidenceBundleId: UuidSchema,
  })
  .strict();
export { ConcertmasterFinalReportSchema };
export type ConcertmasterFinalReport = z.infer<typeof ConcertmasterFinalReportSchema>;
