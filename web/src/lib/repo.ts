// Module-level singletons so every component that imports from here sees the
// same in-memory store. When the real Firestore adapter ships, this is the
// only file that needs to change — everything else codes against the
// `ProjectsRepo` / `SignTypesRepo` interfaces.
//
// We also bootstrap a single demo project on first load so the list view has
// something to show before any CRUD happens. Real auth will replace the
// hard-coded demo owner.

import {
  createInMemoryRepos,
  blankSosisuProject,
  blankSignType,
  type InMemoryRepos,
  type SosisuProject,
} from '../platform/index.ts';

const repos: InMemoryRepos = createInMemoryRepos();

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
      // Seed a single sign type so the list view (and the Signal → Surface
      // handoff) has something to demo on first load. The in-memory repo
      // resets on page reload, so without this the user sees an empty list
      // every time and has to manually create a sign before anything is
      // testable.
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
