// Phase 6 — pure helper for detecting leftover CU Boulder seed metadata
// on a persisted Signal project. The CU Boulder demo is opt-in (Sidebar
// button), but pre-Phase-6 reset left project.name + project.client
// in place even after the user wiped types/instances/destinations.
// Result: a project that read as "still on CU Boulder" indefinitely.
//
// Extracted as a pure function so the bootstrap effect's logic stays
// testable independent of `useEffect` + Firestore mocking.

import type { SosisuProject } from '../platform/index.ts';

/** True when the project metadata still carries CU Boulder seed
 *  markers (name and/or client). False otherwise. */
export function hasLeftoverCuBoulderMetadata(
  project: Pick<SosisuProject, 'name' | 'client'> | null | undefined,
): boolean {
  if (!project) return false;
  if (project.name === 'CU Boulder Campus Wayfinding') return true;
  if (project.client === 'University of Colorado Boulder') return true;
  return false;
}
