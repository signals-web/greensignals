// ─── Destination links — Phase 5c follow-up ───────────────────────────────
//
// Draws dashed lines from sign markers to destination buildings on the
// MapLibre map, plus the destination dots at the line endpoints.
//
// Two display modes:
//   1. Global "show all" — thin, transparent lines for every sign
//   2. Selected sign highlight — bolder lines for the focused sign only
//
// ─── Architectural invariant (Phase 5c) ────────────────────────────────────
// Lines and markers on the map use canonical lat/lng from DestinationPlace
// records. NO 45° snapping or other arrow-direction-derived positioning
// happens here. The 45° snap lives only on the Destination.arrow value
// rendered in the messaging-list table column — that constraint exists
// because physical signs have 8 arrow positions, not because the map's
// geometry is constrained. The two representations never share state:
//   - map.dashedLine.endpoint = destinationPlace.lat/lng  (real)
//   - row.arrow = snapTo45(bearingFromSignToDestination)  (constrained)
// If you find yourself reaching for a snapped arrow value to place
// something on the map, stop — you're conflating the two.
//
// Source-of-truth note (Phase 5c): this module previously looked up
// destination positions via fuzzy name match against `seedBuildings`,
// an old hand-curated array separate from the project's destinations
// CSV. That created stale-coord and "lines don't reach the markers"
// bugs because the lookup operated on different data than the
// algorithm. The lookup now takes a `destinations: DestinationPlace[]`
// argument — the canonical source — and resolves rows by
// `destinationPlaceId` first, falling back to name match only for
// legacy ad-hoc rows that aren't linked yet.

import { expandAbbreviations } from '@sosisu/platform/utils';
import type {
  DestinationPlace,
  SignInstance,
} from '../platform/index.ts';

// ─── DestinationPlace lookup ──────────────────────────────────────────────

/** Resolution helpers built once from the destinations array. Re-used
 *  across `collectLinks` invocations and exposed for SignCard's
 *  inset-map marker placement so both paths agree on which
 *  DestinationPlace a row points at. */
export interface DestinationLookup {
  /** Find a DestinationPlace by id (canonical primary path). */
  byId: (id: string) => DestinationPlace | undefined;
  /** Find a DestinationPlace by name (fuzzy, exact → expanded →
   *  substring). Legacy fallback for rows without
   *  `destinationPlaceId`. */
  byName: (name: string) => DestinationPlace | undefined;
  /** Convenience: resolve a row by id first, then name. Returns
   *  `undefined` when neither path matches. */
  resolve: (row: {
    name?: string;
    destinationPlaceId?: string;
  }) => DestinationPlace | undefined;
}

/** Normalise a name for fuzzy matching: lowercase, collapse whitespace. */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Build a `DestinationLookup` over a destinations array. Skips
 *  archived records — they shouldn't appear on the map.
 *
 *  Cheap to call per render; no caching strategy needed at the
 *  scales we work at (152 destinations max in the CU Boulder seed).
 *  If a project balloons past ~10k destinations, switch the byName
 *  paths from linear scans to a normalised-name index. */
export function buildDestinationLookup(
  destinations: ReadonlyArray<DestinationPlace>,
): DestinationLookup {
  const live = destinations.filter((d) => !d.archivedAt);
  const idMap = new Map<string, DestinationPlace>(
    live.map((d) => [d.id, d]),
  );

  const byId = (id: string): DestinationPlace | undefined => idMap.get(id);

  const byName = (name: string): DestinationPlace | undefined => {
    const target = norm(name);
    if (!target) return undefined;

    // 1. Exact match (case-insensitive).
    for (const d of live) {
      if (norm(d.name) === target) return d;
    }
    // 2. Abbreviation-expanded match: expand both sides and compare.
    const expanded = norm(expandAbbreviations(name));
    for (const d of live) {
      if (norm(expandAbbreviations(d.name)) === expanded) return d;
    }
    // 3. Substring: candidate name contains the destination name or
    //    vice versa.
    for (const d of live) {
      const dn = norm(d.name);
      if (dn.includes(target) || target.includes(dn)) return d;
    }
    return undefined;
  };

  const resolve = (row: {
    name?: string;
    destinationPlaceId?: string;
  }): DestinationPlace | undefined => {
    if (row.destinationPlaceId) {
      const hit = byId(row.destinationPlaceId);
      if (hit) return hit;
      // destinationPlaceId set but record missing (archived /
      // deleted / out-of-sync). Don't fall through to name match —
      // that would silently swap to a different destination if the
      // names happen to collide. Better to render nothing and let
      // the diagnostic counter / regen flow surface the staleness.
      return undefined;
    }
    if (row.name) return byName(row.name);
    return undefined;
  };

  return { byId, byName, resolve };
}

// ─── GeoJSON helpers ──────────────────────────────────────────────────────

interface LinkLine {
  signLng: number;
  signLat: number;
  destLng: number;
  destLat: number;
}

function linesToGeoJSON(lines: LinkLine[]): Record<string, unknown> {
  return {
    type: 'FeatureCollection',
    features: lines.map((l) => ({
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [l.signLng, l.signLat],
          [l.destLng, l.destLat],
        ],
      },
    })),
  };
}

function destDotsGeoJSON(
  dots: Array<{ lng: number; lat: number }>,
): Record<string, unknown> {
  return {
    type: 'FeatureCollection',
    features: dots.map((d) => ({
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'Point' as const,
        coordinates: [d.lng, d.lat],
      },
    })),
  };
}

/** Collect all unique sign → DestinationPlace link lines for a set of
 *  instances. Exported so unit tests can pin the no-snap / canonical-
 *  coords invariant without spinning up a maplibre Map. */
export function collectLinks(
  instances: ReadonlyArray<SignInstance>,
  destinations: ReadonlyArray<DestinationPlace>,
): { lines: LinkLine[]; dots: Array<{ lng: number; lat: number }> } {
  const lookup = buildDestinationLookup(destinations);
  const lines: LinkLine[] = [];
  const dotKey = new Set<string>();
  const dots: Array<{ lng: number; lat: number }> = [];

  for (const inst of instances) {
    if (inst.lat == null || inst.lng == null) continue;
    const seen = new Set<string>(); // dedupe per-sign by DestinationPlace id
    for (const side of inst.sides) {
      for (const row of side.destinations) {
        const dp = lookup.resolve(row);
        if (!dp) continue;
        if (seen.has(dp.id)) continue;
        seen.add(dp.id);

        // Endpoints are the canonical DestinationPlace lat/lng — full
        // precision, no 45° snap. The row's `arrow` value is unused
        // here on purpose (see invariant at the top of this file).
        lines.push({
          signLng: inst.lng,
          signLat: inst.lat,
          destLng: dp.lng,
          destLat: dp.lat,
        });

        const key = `${dp.lat},${dp.lng}`;
        if (!dotKey.has(key)) {
          dotKey.add(key);
          dots.push({ lng: dp.lng, lat: dp.lat });
        }
      }
    }
  }
  return { lines, dots };
}

// ─── Source / layer IDs ───────────────────────────────────────────────────

const ALL_LINES_SRC = 'dest-links-all-src';
const ALL_LINES_LYR = 'dest-links-all-lyr';
const ALL_DOTS_SRC = 'dest-dots-all-src';
const ALL_DOTS_LYR = 'dest-dots-all-lyr';

const SEL_LINES_SRC = 'dest-links-sel-src';
const SEL_LINES_LYR = 'dest-links-sel-lyr';
const SEL_DOTS_SRC = 'dest-dots-sel-src';
const SEL_DOTS_LYR = 'dest-dots-sel-lyr';

const INSET_LINES_SRC = 'dest-links-inset-src';
const INSET_LINES_LYR = 'dest-links-inset-lyr';

// ─── Public API ───────────────────────────────────────────────────────────

/** Find the first symbol layer so lines render below labels. */
function firstSymbolLayer(map: any): string | undefined {
  const layers = map.getStyle()?.layers;
  if (!layers) return undefined;
  for (const layer of layers) {
    if (layer.type === 'symbol') return layer.id;
  }
  return undefined;
}

function safeRemove(map: any, layerId: string, sourceId: string): void {
  try {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  } catch {
    /* layer not registered — ignore */
  }
  try {
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  } catch {
    /* source not registered — ignore */
  }
}

/** Draw global destination links for all instances (thin, transparent). */
export function drawAllLinks(
  map: any,
  instances: ReadonlyArray<SignInstance>,
  destinations: ReadonlyArray<DestinationPlace>,
): void {
  clearAllLinks(map);

  const { lines, dots } = collectLinks(instances, destinations);
  if (lines.length === 0) return;

  const beforeId = firstSymbolLayer(map);

  // Lines — thin Sky dashes. The literal hex below is the SOSISU
  // brand value `--signal-bright` / `--product-bright` resolves to.
  // MapLibre's paint configs are JSON expressions evaluated against
  // the map's data, NOT CSS — `var(--…)` strings don't work here.
  // If the brand swatch ever moves, update this hex AND
  // `platform/styles/tokens.css`'s `--signal-bright` together.
  map.addSource(ALL_LINES_SRC, { type: 'geojson', data: linesToGeoJSON(lines) });
  map.addLayer(
    {
      id: ALL_LINES_LYR,
      type: 'line',
      source: ALL_LINES_SRC,
      paint: {
        'line-color': '#ADDFF7', // SOSISU Sky (= --signal-bright)
        'line-opacity': 0.25,
        'line-width': 1,
        'line-dasharray': [4, 4],
      },
    },
    beforeId,
  );

  // Destination dots at canonical lat/lng.
  map.addSource(ALL_DOTS_SRC, { type: 'geojson', data: destDotsGeoJSON(dots) });
  map.addLayer(
    {
      id: ALL_DOTS_LYR,
      type: 'circle',
      source: ALL_DOTS_SRC,
      paint: {
        'circle-radius': 3,
        'circle-color': '#ADDFF7', // SOSISU Sky
        'circle-opacity': 0.35,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#ADDFF7',
        'circle-stroke-opacity': 0.2,
      },
    },
    beforeId,
  );
}

/** Clear the global link layers. */
export function clearAllLinks(map: any): void {
  safeRemove(map, ALL_LINES_LYR, ALL_LINES_SRC);
  safeRemove(map, ALL_DOTS_LYR, ALL_DOTS_SRC);
}

/** Draw highlighted links for a single selected sign (bolder style). */
export function drawSelectedLinks(
  map: any,
  instance: SignInstance,
  destinations: ReadonlyArray<DestinationPlace>,
): void {
  clearSelectedLinks(map);

  const { lines, dots } = collectLinks([instance], destinations);
  if (lines.length === 0) return;

  const beforeId = firstSymbolLayer(map);

  // Lines — bolder. Same SOSISU Sky as drawAllLinks; the difference
  // is opacity + dash + width. (CSS vars don't apply in maplibre
  // paint — see drawAllLinks comment.)
  map.addSource(SEL_LINES_SRC, { type: 'geojson', data: linesToGeoJSON(lines) });
  map.addLayer(
    {
      id: SEL_LINES_LYR,
      type: 'line',
      source: SEL_LINES_SRC,
      paint: {
        'line-color': '#ADDFF7', // SOSISU Sky
        'line-opacity': 0.6,
        'line-width': 2,
        'line-dasharray': [6, 4],
      },
    },
    beforeId,
  );

  // Dots — bolder.
  map.addSource(SEL_DOTS_SRC, { type: 'geojson', data: destDotsGeoJSON(dots) });
  map.addLayer(
    {
      id: SEL_DOTS_LYR,
      type: 'circle',
      source: SEL_DOTS_SRC,
      paint: {
        'circle-radius': 5,
        'circle-color': '#ADDFF7', // SOSISU Sky
        'circle-opacity': 0.6,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#ADDFF7',
        'circle-stroke-opacity': 0.4,
      },
    },
    beforeId,
  );
}

/** Clear the selected-sign link layers. */
export function clearSelectedLinks(map: any): void {
  safeRemove(map, SEL_LINES_LYR, SEL_LINES_SRC);
  safeRemove(map, SEL_DOTS_LYR, SEL_DOTS_SRC);
}

/** Clear all destination link layers (both global and selected). */
export function clearAllDestinationLayers(map: any): void {
  clearAllLinks(map);
  clearSelectedLinks(map);
}

// ─── Inset map leader lines ───────────────────────────────────────────────
//
// Used by SignCard's inset map (single focal sign view). Visual
// treatment is intentionally distinct from `drawAllLinks` /
// `drawSelectedLinks`:
//
//   - drawAllLinks (dashboard "show all"): CU Gold, transparent, shows
//     every sign's links faintly across campus.
//   - drawSelectedLinks (dashboard "highlight"): CU Gold, bolder, makes
//     ONE sign's links pop above the global mesh.
//   - drawInsetLeaderLines (this): muted neutral, fits the inset's
//     focused single-sign context where there's no global mesh
//     fighting for attention. The neutral colour also stays readable
//     on both light and dark MapTiler tiles without adopting a
//     brand-specific colour.
//
// Single GeoJSON source for all of the focal sign's lines so theme
// swaps and instance changes only re-write one feature collection
// rather than per-name sources.

/** Render dashed leader lines from the focal sign's lat/lng to each
 *  of its destinations' canonical lat/lng.
 *
 *  Theme-aware: on dark tiles we paint a light-gray dash so it reads
 *  against the navy background; on light tiles we paint a dark-gray
 *  dash so it reads against the cream/yellow background. MapLibre
 *  paint expressions can't read CSS variables, so the colour gets
 *  selected here from the `isDark` flag the caller already has. */
export function drawInsetLeaderLines(
  map: any,
  focalSign: SignInstance,
  destinations: ReadonlyArray<DestinationPlace>,
  isDark: boolean = true,
): void {
  clearInsetLeaderLines(map);

  if (focalSign.lat == null || focalSign.lng == null) return;

  const { lines } = collectLinks([focalSign], destinations);
  if (lines.length === 0) return;

  const beforeId = firstSymbolLayer(map);

  // Mid-gray reads on dark tiles. On light tiles a mid-gray fades into
  // the cream/yellow palette — switch to a darker gray so the dash
  // stays a clear neutral against the building outlines.
  const lineColor = isDark
    ? 'rgba(180, 180, 180, 0.7)'
    : 'rgba(60, 60, 60, 0.7)';

  map.addSource(INSET_LINES_SRC, {
    type: 'geojson',
    data: linesToGeoJSON(lines),
  });
  map.addLayer(
    {
      id: INSET_LINES_LYR,
      type: 'line',
      source: INSET_LINES_SRC,
      paint: {
        // Muted neutral that reads on both palettes (see `lineColor`
        // selection above). Dasharray was briefly [2,2] for "tighter"
        // rendering but MapLibre's dash texture-atlas fades very
        // small patterns at some zoom/DPR combos, leaving the inset
        // with no visible leader lines. [2,4] renders reliably across
        // the campus zoom range.
        'line-color': lineColor,
        'line-width': 1.5,
        'line-dasharray': [2, 4],
      },
    },
    beforeId,
  );
}

/** Clear the inset map's leader-line layer + source. Idempotent. */
export function clearInsetLeaderLines(map: any): void {
  safeRemove(map, INSET_LINES_LYR, INSET_LINES_SRC);
}
