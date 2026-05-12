// Phase 6 — Buildings CSV parse + validate + normalize.
//
// Extracted as a pure helper so the import flow's row-level decisions
// are testable independent of file I/O, Papa Parse, and the modal's
// React state. ImportModal.tsx feeds the already-Papa-parsed rows
// here; this module handles:
//
//   - Header normalization (case + aliases) — already done upstream
//     before rows reach us; this module assumes canonical header keys
//     (`building_name`, `lat`, `lng`, `building_code`, `floor_count`,
//     `abbreviation`).
//   - Required-column validation: `building_name`, `lat`, `lng`.
//   - Optional `building_code` — when missing, auto-generated as
//     `b001`, `b002`, … in row order (per Phase 6 spec).
//   - Numeric validation on `lat` and `lng` — non-numeric → reject.
//   - Unknown columns ignored without error (Tufts CSVs carry
//     `Dest ID` and `Category` columns that have no Buildings home;
//     they get dropped silently).
//   - Trim whitespace on every string cell.
//   - Return a structured rejection list with reasons so the modal
//     can render `X imported · Y rejected (with reasons)` instead
//     of silently dropping rows.
//
// Pre-Phase-6, ImportModal.tsx filtered rows on
// `r.building_code?.trim()` — a missing building_code dropped the
// entire row silently. Chris's Tufts CSV (Dest ID, Name, Category,
// Lat, Lng) has no building_code column, so every row was filtered
// out and nothing imported. This helper relaxes the contract per
// the brief's locked decision: building_code becomes optional with
// auto-generation.

import type { Building } from '../platform/index.ts';

export interface BuildingsParseResult {
  /** Rows that passed validation. Caller dispatches each `building`
   *  to the project state. `row` is the 1-indexed source row number
   *  (including the header line) for UI display ("row 3 rejected"). */
  buildings: Array<{ row: number; building: Building }>;
  /** Rejection list with reasons. Caller renders this in the import
   *  results UI so designers can fix their CSV without silent data
   *  loss. */
  rejected: Array<{ row: number; reason: string }>;
}

/** Pure helper. Takes normalized rows (canonical header keys) and
 *  returns the structured result. Caller handles the upstream Papa
 *  parse + header aliasing. */
export function parseBuildingsCsv(
  rows: Array<Record<string, string | undefined>>,
): BuildingsParseResult {
  const buildings: BuildingsParseResult['buildings'] = [];
  const rejected: BuildingsParseResult['rejected'] = [];
  // Auto-generated building_codes start at b001 and count up across
  // the FULL row order — they don't restart per-tab or per-import.
  // Each row that gets an auto-code consumes the next index, so the
  // codes are stable across the result list (no gaps).
  let autoCounter = 0;

  rows.forEach((rawRow, i) => {
    // Row numbers are 1-indexed and include the CSV header line, so
    // the first data row reads as "row 2" to designers.
    const rowNum = i + 2;

    // Trim every string cell so cosmetic whitespace doesn't sink a
    // row. Undefined / empty strings stay as such.
    const r: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(rawRow)) {
      r[k] = typeof v === 'string' ? v.trim() : v;
    }

    const name = r.building_name;
    if (!name) {
      rejected.push({ row: rowNum, reason: 'missing building_name' });
      return;
    }
    if (!r.lat) {
      rejected.push({ row: rowNum, reason: 'missing lat' });
      return;
    }
    if (!r.lng) {
      rejected.push({ row: rowNum, reason: 'missing lng' });
      return;
    }
    const lat = parseFloat(r.lat);
    if (!Number.isFinite(lat)) {
      rejected.push({ row: rowNum, reason: `non-numeric lat "${r.lat}"` });
      return;
    }
    const lng = parseFloat(r.lng);
    if (!Number.isFinite(lng)) {
      rejected.push({ row: rowNum, reason: `non-numeric lng "${r.lng}"` });
      return;
    }

    // Building code: explicit when present, else auto-generated.
    // Auto-codes use a 3-digit zero-padded counter so they sort
    // lexicographically in the same order they were imported, even
    // past row 9.
    let code = r.building_code;
    if (!code) {
      autoCounter += 1;
      code = `b${String(autoCounter).padStart(3, '0')}`;
    }
    const id = `bldg-${code.toLowerCase().replace(/\s+/g, '-')}`;

    // Optional fields.
    const floorCount = r.floor_count
      ? Number.parseInt(r.floor_count, 10)
      : undefined;
    const abbreviation = r.abbreviation || undefined;

    const building: Building = {
      id,
      code,
      name,
      lat,
      lng,
      ...(floorCount !== undefined && Number.isFinite(floorCount)
        ? { floorCount }
        : {}),
      ...(abbreviation ? { abbreviation } : {}),
    };
    buildings.push({ row: rowNum, building });
  });

  return { buildings, rejected };
}
