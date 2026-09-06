/**
 * Test/bootstrap-only persistence helpers. Production code must use
 * provisionProjectAccess, which requires the configured admin boundary.
 */
export { grantProjectMembership, grantProjectRole } from "./project-membership.js";
