// Module-level singletons so every component that imports from here sees the
// same store. When the real Firestore adapter ships, this is the only file
// that needs to change — everything else codes against the `ProjectsRepo` /
// `SignTypesRepo` interfaces.
//
// Persistence: we use `createLocalStorageRepos` so projects and sign types
// survive page reloads in dev/demo. It wraps the same validated in-memory
// core but writes a JSON snapshot to localStorage after every mutation.
// On construction it hydrates from that snapshot (Zod-revalidated, so a
// schema-drifted blob fails loudly and drops bad records rather than
// poisoning the app). Firestore is a drop-in swap behind the same
// interface once auth lands — see `@sosisu/platform/firebase`'s
// `createFirestoreRepos`.
//
// We also bootstrap a single demo project on first load so the list view has
// something to show before any CRUD happens. The bootstrap is idempotent: if
// a project for DEMO_OWNER is already persisted, we reuse it instead of
// re-seeding and blowing away the user's edits on reload.

import {
  createLocalStorageRepos,
  blankSosisuProject,
  blankSignType,
  type InMemoryRepos,
  type SosisuProject,
} from '../platform/index.ts';

const repos: InMemoryRepos = createLocalStorageRepos({
  storageKey: 'sosisu:signal:v1',
});

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

export function getRepos(): InMemoryRepos {
  return repos;
}
