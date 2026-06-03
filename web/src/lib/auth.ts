// Module-level auth singleton, paralleling the repo.ts pattern.
//
// When VITE_FIREBASE_CONFIG is set, uses the real Firebase Auth client
// (email+password and Google sign-in). Otherwise falls back to the in-memory
// stub for dev/demo. Consumer code uses the AuthClient interface and is
// unaware of which backend is active.

import { getAuth, connectAuthEmulator } from 'firebase/auth';
import {
  createMemoryAuthClient,
  createFirebaseAuthClient,
  initSosisuFirebase,
  findRole,
  roleCan,
  type AuthClient,
  type AuthState,
  type Capability,
  type ProjectRole,
  type SosisuProject,
} from '../platform/index.ts';
import { useSyncExternalStore, useMemo } from 'react';

function buildAuthClient(): AuthClient {
  const firebaseConfigRaw = import.meta.env.VITE_FIREBASE_CONFIG as
    | string
    | undefined;
  if (firebaseConfigRaw) {
    try {
      const config = JSON.parse(firebaseConfigRaw) as Record<string, unknown>;
      const { app } = initSosisuFirebase(config);
      const auth = getAuth(app);
      if (import.meta.env.VITE_FIREBASE_EMULATOR === 'true') {
        try {
          connectAuthEmulator(auth, 'http://127.0.0.1:9099', {
            disableWarnings: true,
          });
        } catch {
          // Already connected (HMR).
        }
      }
      // eslint-disable-next-line no-console
      console.log('[auth] using Firebase Auth');
      return createFirebaseAuthClient(auth);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        '[auth] VITE_FIREBASE_CONFIG set but failed to initialise Firebase Auth, falling back to memory:',
        err,
      );
    }
  }
  // eslint-disable-next-line no-console
  console.log('[auth] using in-memory auth (demo mode)');
  return createMemoryAuthClient({
    initialUser: {
      uid: 'demo-user',
      email: 'demo@sosisu.app',
      displayName: 'Demo User',
    },
  });
}

const authClient: AuthClient = buildAuthClient();

export function getAuthClient(): AuthClient {
  return authClient;
}

/** React hook that subscribes to auth state via useSyncExternalStore.
 *  Returns the current AuthState. Components re-render on transitions
 *  (loading → signed-in, signed-in → signed-out, etc.). */
export function useCurrentUser(): AuthState {
  return useSyncExternalStore(
    (cb) => authClient.subscribe(cb),
    () => authClient.getState(),
    // SSR fallback (not used, but required by the signature).
    () => authClient.getState(),
  );
}

/** Derived role + capability check for the current user in a project.
 *  Returns `null` role if signed out or not a member. */
export function useProjectRole(
  project: Pick<SosisuProject, 'members'> | null | undefined,
): {
  role: ProjectRole | null;
  can: (cap: Capability) => boolean;
} {
  const auth = useCurrentUser();
  return useMemo(() => {
    if (!project || auth.status !== 'signed-in') {
      return { role: null, can: () => false };
    }
    const role = findRole(project, auth.user);
    return {
      role,
      can: (cap: Capability) => role !== null && roleCan(role, cap),
    };
  }, [project, auth]);
}
