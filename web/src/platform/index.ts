/**
 * Signal-local re-export barrel for the shared @sosisu/platform package.
 *
 * Signal has no pre-existing `SignType` / `SignInstance` names, so we re-export
 * straight through (unlike Solid, which aliases to `ProgramSignType` to avoid
 * colliding with its internal parametric types).
 */
export type {
  SignCategory,
  MountType,
  LineSpec,
  FacingDirection,
  Destination,
  SignSide,
  ReviewStatus,
  DimensionsMM,
  MaterialSpec,
  SurfaceArtworkRef,
  SignType,
  SignInstance,
  ProjectRole,
  ProjectMember,
  SosisuProject,
  ParseOk,
  ParseErr,
  Building,
  ParseResult,
  DestinationPlace,
  DestinationTier,
  BlankDestinationPlaceInput,
  ScoringConfig,
} from '@sosisu/platform/models';

export {
  buildingSchema,
  signTypeSchema,
  signInstanceSchema,
  projectMemberSchema,
  sosisuProjectSchema,
  parseSignType,
  parseSignInstance,
  parseSosisuProject,
  blankSosisuProject,
  blankSignType,
  nextSignCode,
  syncMemberDenorm,
  destinationPlaceSchema,
  destinationTierSchema,
  parseDestinationPlace,
  blankDestinationPlace,
  memberDisplayName,
  scoringConfigSchema,
  DEFAULT_SCORING_CONFIG,
} from '@sosisu/platform/models';

export type {
  Unsubscribe,
  ProjectsRepo,
  SignTypesRepo,
  DestinationPlacesRepo,
  ListDestinationPlacesOptions,
  InMemoryRepos,
  FirestoreRepos,
} from '@sosisu/platform/firebase';

export {
  RepoError,
  createInMemoryRepos,
  createLocalStorageRepos,
  createFirestoreRepos,
  initSosisuFirebase,
  connectEmulator,
} from '@sosisu/platform/firebase';

export type {
  AuthUser,
  AuthState,
  AuthClient,
  AuthErrorCode,
  Capability,
} from '@sosisu/platform/auth';

export {
  AuthError,
  createMemoryAuthClient,
  createFirebaseAuthClient,
  findRole,
  roleCan,
  userCan,
  canAssignRole,
  PROJECT_ROLES,
} from '@sosisu/platform/auth';

// Phase 5: scoring policies (per-sign-type cap + anchors-only filter).
// Surfaces `policyForSignType` to UI (SignCard's diagnostic counter) and
// the dashboard's read-only per-type capacity readout.
export type { SignTypePolicy } from '@sosisu/platform/scoring';

export {
  DEFAULTS_BY_CODE,
  WALK_PACE_M_PER_MIN,
  DEFAULT_POLICY,
  policyForSignType,
  listPolicies,
  haversineDistance,
} from '@sosisu/platform/scoring';

export type { HandoffPayload } from '@sosisu/platform/handoff';

export {
  HANDOFF_QUERY_PARAM,
  HANDOFF_FROM_SOLID_QUERY_PARAM,
  HandoffDecodeError,
  encodeSignTypeForHandoff,
  decodeSignTypeFromHandoff,
  buildHandoffUrl,
  readHandoffFromLocation,
  readSolidHandoffFromLocation,
} from '@sosisu/platform/handoff';

// ─── Stage 0.3 — canonical governance infrastructure ─────────────────────
//
// Re-exported from `@sosisu/platform/canonical` so Signal's reducer-side
// code can adopt the approval state machine helpers without learning a
// new import path. Stage 0.3 wires `isValidTransition` into the
// `updateInstance` chokepoint as additive enforcement — no current UI
// flow dispatches a transition that canonical rejects, so the wrap
// catches future regressions rather than changing today's behavior.

export type { ApprovalState } from '@sosisu/platform/canonical';

export {
  ApprovalStateSchema,
  ALL_APPROVAL_STATES,
  ApprovalTransitions,
  isValidTransition,
} from '@sosisu/platform/canonical';
