// Module-level singletons so every component that imports from here sees the
// same store. When a Firebase config is available (VITE_FIREBASE_CONFIG env
// var), we use the real Firestore-backed repos. Otherwise we fall back to the
// localStorage adapter for dev/demo — same interface either way, so consumer
// code is unaware of which backend is active.
//
// To connect to the Firestore emulator during local dev, also set
// VITE_FIREBASE_EMULATOR=true.
//
// We also bootstrap a single demo project on first load so the list view has
// something to show before any CRUD happens. The bootstrap is idempotent: if
// a project for DEMO_OWNER is already persisted, we reuse it instead of
// re-seeding and blowing away the user's edits on reload.

import {
  createLocalStorageRepos,
  createFirestoreRepos,
  initSosisuFirebase,
  connectEmulator,
  type ProjectsRepo,
  type SignTypesRepo,
  type SosisuProject,
} from '../platform/index.ts';
import {
  seedProject,
  seedSignTypes,
} from '@sosisu/platform/seed';

/** The repos interface exposed to the rest of the app. Consumers only need
 *  `projects` and `signTypes` — the `reset()` method on InMemoryRepos and
 *  Firestore-specific internals are not surfaced. */
export interface AppRepos {
  projects: ProjectsRepo;
  signTypes: SignTypesRepo;
}

function buildRepos(): AppRepos {
  const firebaseConfigRaw = import.meta.env.VITE_FIREBASE_CONFIG as
    | string
    | undefined;
  if (firebaseConfigRaw) {
    try {
      const config = JSON.parse(firebaseConfigRaw) as Record<string, unknown>;
      const { db } = initSosisuFirebase(config);
      if (import.meta.env.VITE_FIREBASE_EMULATOR === 'true') {
        connectEmulator(db);
      }
      // eslint-disable-next-line no-console
      console.log('[repo] using Firestore-backed repos');
      return createFirestoreRepos(db);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        '[repo] VITE_FIREBASE_CONFIG set but failed to initialise Firestore, falling back to localStorage:',
        err,
      );
    }
  }
  // eslint-disable-next-line no-console
  console.log('[repo] using localStorage-backed repos');
  return createLocalStorageRepos({ storageKey: 'sosisu:signal:v1' });
}

const repos: AppRepos = buildRepos();

export const DEMO_OWNER = {
  uid: 'demo-user',
  email: 'demo@sosisu.app',
  displayName: 'Demo User',
} as const;

let bootstrapped: Promise<SosisuProject> | null = null;

/** Idempotent: returns (and lazily creates) the CU Boulder demo project.
 *  On first boot, seeds the shared project + 4 sign types so all three
 *  apps show the same data and cross-app handoff links resolve. After
 *  that, the persisted snapshot takes over and the seed never runs again. */
export function ensureDemoProject(): Promise<SosisuProject> {
  if (!bootstrapped) {
    bootstrapped = (async () => {
      const existing = await repos.projects.list(DEMO_OWNER.uid);
      if (existing.length > 0) return existing[0]!;
      const project = await repos.projects.save(seedProject);
      for (const st of seedSignTypes) {
        await repos.signTypes.save(project.id, st);
      }
      return project;
    })();
  }
  return bootstrapped;
}

export function getRepos(): AppRepos {
  return repos;
}
