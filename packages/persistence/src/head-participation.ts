export {
  type ActivateHeadRequest,
  HeadActivationCycleError,
  HeadActivationRequesterInactiveError,
  HeadActivationRuntimeConflictError,
  HeadActivationBindingConflictError,
  HeadActivationBindingError,
  type HeadActivationCommandStatus,
  type HeadActivationCommandRecoveryRow,
} from "./head-participation/types.js";
export { activateHeadParticipation } from "./head-participation/activation.js";
export {
  markHeadActivationSpawnStarted,
  bindHeadActivationInvocation,
  resetHeadActivationAfterSpawnFailure,
  resetHeadActivationAfterCancellation,
  markHeadActivationOrphaned,
  listHeadActivationCommandsForRecovery,
  markHeadParticipationActive,
  sleepHeadParticipation,
} from "./head-participation/lifecycle.js";
