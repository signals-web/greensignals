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
  blankSosisuProject,
  blankSignType,
  type ProjectsRepo,
  type SignTypesRepo,
  type SosisuProject,
} from '../platform/index.ts';

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

/** Idempotent: returns (and lazily creates) the single in-memory demo project
 *  Signal's CRUD hangs off. Every caller awaits the same promise. */
export function ensureDemoProject(): Promise<SosisuProject> {
  if (!bootstrapped) {
    bootstrapped = (async () => {
      const existing = await repos.projects.list(DEMO_OWNER.uid);
      if (existing.length > 0) return existing[0]!;
      const draft = blankSosisuProject(DEMO_OWNER);
      draft.name = 'Demo Project';
      draft.client = 'SOSISU Internal';
      const project = await repos.projects.save(draft);
      // Seed a single sign type on the very first boot so the list view
      // (and the Signal → Surface / → Solid handoffs) have something to
      // demo out of the box. After that, the persisted snapshot takes over
      // and the seed never runs again — `existing.length > 0` short-circuits
      // above on subsequent reloads.
      const seed = blankSignType('D-01');
      seed.name = 'Main entry — visitor directional';
      seed.copy = [
        { text: 'Visitor Parking', style: 'primary', alignment: 'center' },
        { text: '← Lot A', style: 'secondary', alignment: 'center' },
        { text: 'Lot B →', style: 'secondary', alignment: 'center' },
      ];
      await repos.signTypes.save(project.id, seed);
      return project;
    })();
  }
  return bootstrapped;
}

export function getRepos(): AppRepos {
  return repos;
}
