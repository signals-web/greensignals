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
  ParseResult,
} from '@sosisu/platform/models';

export {
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
} from '@sosisu/platform/models';

export type {
  Unsubscribe,
  ProjectsRepo,
  SignTypesRepo,
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
} from '@sosisu/platform/auth';

export {
  AuthError,
  createMemoryAuthClient,
  createFirebaseAuthClient,
} from '@sosisu/platform/auth';

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
