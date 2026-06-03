// ─── CU Boulder demo seed — barrel ────────────────────────────────────────
//
// Single import surface for App / Sidebar code that just wants the
// "Load CU Boulder sample" button to work. Use `buildCuBoulderSeed()`
// at the call site; the loader pulls from the bundled CSVs by default.

export {
  buildCuBoulderSeed,
  type CuBoulderSeed,
  type BuildSeedOptions,
} from './buildSeedProject.ts';

export {
  loadCuBoulderSigns,
  loadCuBoulderDestinations,
  type SignRow,
  type DestinationRow,
} from './loadSeed.ts';
