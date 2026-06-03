// ─── CU Boulder demo seed — CSV loader ────────────────────────────────────
//
// Parses the two CSV files that ship next to this module and returns
// row-shaped local types. The transform from rows → platform model
// records (SignType / SignInstance / DestinationPlace) lives separately
// in `./buildSeedProject.ts` so it can be tested without parsing.
//
// CSVs are baked into the bundle via Vite's `?raw` import. No runtime
// `fetch`, no `/public` path — keeps the seed offline-safe and removes
// any chance of the loader hitting a 404 when the dev server's asset
// serving path differs from production.

import Papa from 'papaparse';
// eslint-disable-next-line import/no-unresolved
import signsCsv from './signs.csv?raw';
// eslint-disable-next-line import/no-unresolved
import destinationsCsv from './destinations.csv?raw';

/** Sign row shape from `signs.csv`. The R1.* through R8.* columns are
 *  intentionally dropped — they're empty in the source data and even
 *  if filled, the Phase 3 scoring engine generates suggestions at
 *  runtime. Pre-populating them defeats the demo's purpose. */
export interface SignRow {
  Type: string;
  Number: string;
  Lat: string;
  Lng: string;
  /** District-name-shaped value, NOT a compass bearing. We ignore it —
   *  see `buildSeedProject.ts` for the explanation. */
  Facing: string;
  Neighborhood: string;
}

/** Destination row shape from `destinations.csv`. */
export interface DestinationRow {
  'Dest ID': string;
  Name: string;
  Category: string;
  Lat: string;
  Lng: string;
  District: string;
  Tier: string;
  Notes: string;
  'Include Always?': string;
  'Exclude From Types': string;
}

function parseCsv<T>(text: string): T[] {
  // `dynamicTyping: false` keeps everything as strings; the transform
  // step does its own coercion + validation. `skipEmptyLines: true`
  // ignores trailing blank rows in the CSV.
  const result = Papa.parse<T>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  return result.data;
}

export function loadCuBoulderSigns(): SignRow[] {
  return parseCsv<SignRow>(signsCsv);
}

export function loadCuBoulderDestinations(): DestinationRow[] {
  return parseCsv<DestinationRow>(destinationsCsv);
}
