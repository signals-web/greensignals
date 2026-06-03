// CSV header normalization — shared by ImportModal + tests.
//
// Extracted from ImportModal.tsx (B1 Bug #4) so the buildings /
// destinations / schedule import pipeline can be tested end-to-end
// against real CSVs (e.g. the Tufts buildings sheet) without standing
// up the React modal. No behavior change — these are the exact helpers
// ImportModal used inline.
//
// The importer accepts loosely-shaped CSVs by mapping a range of
// real-world header spellings onto canonical keys. Unknown headers pass
// through normalized (lowercased, trimmed) but unmapped, so downstream
// parsers can ignore them.

/** Canonical key → accepted header spellings (all compared lowercased,
 *  trimmed, punctuation-stripped). */
export const HEADER_ALIASES: Record<string, string[]> = {
  building_code: ['building_code', 'bldg_code', 'code', 'building code', 'bldg code', 'bldg'],
  building_name: ['building_name', 'name', 'building name', 'bldg_name', 'bldg name'],
  lat: ['lat', 'latitude', 'y'],
  lng: ['lng', 'lon', 'longitude', 'long', 'x'],
  floor_count: ['floor_count', 'floors', 'floor count', 'num_floors', 'stories'],
  abbreviation: ['abbreviation', 'abbr', 'abbrev', 'short_name', 'short name'],
  sign_code: ['sign_code', 'sign code', 'sign_id', 'sign id', 'signcode', 'signid', 'id'],
  destination_name: ['destination_name', 'destination name', 'destination', 'dest_name', 'dest name', 'dest'],
  arrow_direction: ['arrow_direction', 'arrow direction', 'arrow', 'direction', 'dir', 'arrow_deg'],
  walk_time: ['walk_time', 'walk time', 'walktime', 'time', 'walk_minutes', 'walk minutes'],
  type_code: ['type_code', 'type code', 'typecode', 'type', 'sign_type', 'sign type'],
  location_description: ['location_description', 'location description', 'location', 'loc', 'description'],
  facing_direction: ['facing_direction', 'facing direction', 'facing', 'face_dir', 'face dir'],
};

/** Normalize a raw header to its canonical key, or to a cleaned
 *  lowercase form when unmapped. Note: an unmapped header that happens
 *  to already match a downstream-read key (e.g. "Category" → "category")
 *  passes through usable. */
export function normalizeHeader(raw: string): string {
  const lower = raw.trim().toLowerCase().replace(/[^a-z0-9_ ]/g, '');
  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(lower)) return canonical;
  }
  return lower;
}

/** Map each raw header in a CSV to its canonical key. */
export function mapHeaders(rawHeaders: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const h of rawHeaders) {
    map[h] = normalizeHeader(h);
  }
  return map;
}

/** Rewrite a parsed row's keys from raw headers to canonical keys. */
export function remapRow(
  row: Record<string, string>,
  headerMap: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawKey, val] of Object.entries(row)) {
    const canonical = headerMap[rawKey] ?? rawKey;
    out[canonical] = val;
  }
  return out;
}
