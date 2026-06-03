// ─── Map label control — Phase 5c follow-up ───────────────────────────────
//
// Two responsibilities:
//
//   1. `hideOsmLabels(map)` — silences MapTiler/OSM proper-noun labels
//      (POI, building, natural, transit) on the rendered tiles. Keeps
//      road and street labels for navigation context. The OSM labels
//      use a different naming convention than the project's CSV ("Limelight
//      Boulder" vs "Limelight Conference Center and Hotel"), which made
//      reviewers think the data was misplaced — it isn't, the labels
//      were just from a different source.
//
//   2. `drawDestinationLabels(map, focalRows, destinations)` — renders
//      HTML markers carrying the project's CSV destination names at
//      their canonical lat/lng. Used on SignCard's inset map (focal
//      sign only); not on the dashboard, where 152 labels at campus
//      zoom would be clutter.
//
// Both functions are idempotent and safe to call on every `style.load`
// — `setStyle` wipes layer visibility flags AND sources/layers, so the
// hides re-apply, and the marker DOM survives (HTML overlays). Markers
// produced by `drawDestinationLabels` are returned so the caller can
// pass them back to `clearDestinationLabels` before re-drawing.

import type { DestinationPlace } from '../platform/index.ts';

// ─── Layer-pattern matcher ────────────────────────────────────────────────

/** Exact layer ids to hide. Sourced from the audited MapTiler
 *  `streets-v2-dark` / `streets-v2-light` style. POI symbols + place
 *  labels + housenumbers + airport / ferry / oneway.
 *
 *  Building POLYGONS stay visible — reviewers need them to read the
 *  campus structure (which sign sits at which building edge). An
 *  earlier pass hid `Building` / `Building 3D` because their fills
 *  competed with sign markers, but the spatial context they provide
 *  is more valuable than the contrast cost.
 *
 *  These names are Title-Case (e.g. `"Park"`) — earlier regex
 *  patterns assumed kebab-case (`^poi`, `^building`) and silently
 *  matched nothing, which is how gas-station + tree icons leaked
 *  through. Keeping the regex fallback below for tile providers that
 *  do use kebab-case ids. */
const HIDE_LAYER_IDS: ReadonlySet<string> = new Set([
  // POI symbol layers (MapTiler streets-v2 — source-layer 'poi')
  'Public',
  'Sport',
  'Education',
  'Tourism',
  'Culture',
  'Shopping',
  'Food',
  'Transport', // gas stations live here
  'Park', // arboretum / park / garden tree icons live here
  'Healthcare',
  'Station',
  // Place labels (city / town / state / country / continent)
  'Place labels',
  'State labels',
  'Town labels',
  'City labels',
  'Capital city labels',
  'Country labels',
  'Continent labels',
  // Misc symbols / one-off icons
  'Housenumber',
  'Oneway',
  'Gondola',
  'Ferry',
  'Airport',
  'Airport gate',
  'Airport zone',
]);

/** Layer-id regex patterns kept as a fallback for tile providers
 *  using kebab-case ids (Mapbox-style `poi-label`, `place-label`,
 *  etc). The Title-Case Set above takes precedence; this still
 *  protects against unknown styles dropping in via theme changes.
 *  Note: `^building.*(label|name|symbol|housenum)/i` only matches
 *  building TEXT layers — the bare `building` polygon stays visible. */
const HIDE_PATTERNS: ReadonlyArray<RegExp> = [
  /^poi/i,
  /-poi/i,
  /poi-label/i,
  /^place-label/i,
  /^place_label/i,
  /^natural-label/i,
  /^building.*(label|name|symbol|housenum)/i,
  /transit-label/i,
  /transit_label/i,
  /housenum-label/i,
];

/** Layer-id patterns that take precedence over hides — these
 *  layers must stay visible so reviewers can navigate the map. */
const KEEP_PATTERNS: ReadonlyArray<RegExp> = [
  /^road/i,
  /road-label/i,
  /road-name/i,
  /road-shield/i,
  /^bridge/i,
  /^tunnel/i,
  /street-label/i,
];

/** Pure helper — returns true when a layer with the given id should
 *  have its visibility flipped to `none`. Exported for unit tests so
 *  the pattern logic stays pinned across MapTiler style updates. */
export function shouldHideLayer(id: string | undefined | null): boolean {
  if (!id) return false;
  if (KEEP_PATTERNS.some((p) => p.test(id))) return false;
  if (HIDE_LAYER_IDS.has(id)) return true;
  return HIDE_PATTERNS.some((p) => p.test(id));
}

/** Hide every label / POI / building layer on the map's current style.
 *  Idempotent — safe to call after every `style.load` (theme swap or
 *  initial load). Best-effort: missing or read-only layers are ignored
 *  rather than thrown. */
export function hideOsmLabels(map: {
  getStyle?: () => { layers?: Array<{ id?: string }> } | undefined | null;
  setLayoutProperty?: (id: string, prop: string, value: unknown) => void;
}): void {
  const style = map.getStyle?.();
  if (!style?.layers) return;
  for (const layer of style.layers) {
    if (!layer.id) continue;
    if (!shouldHideLayer(layer.id)) continue;
    try {
      map.setLayoutProperty?.(layer.id, 'visibility', 'none');
    } catch {
      /* layer may be read-only — skip silently */
    }
  }
}

// ─── Destination-label markers ────────────────────────────────────────────

/** Truncate long destination names so the inline label doesn't push
 *  off the screen. The popup / sidebar still shows the full name. */
function truncate(name: string, max = 30): string {
  if (name.length <= max) return name;
  return name.slice(0, max - 1) + '…';
}

/** Build the DOM element used as the label marker's element.
 *
 *  Two-layer DOM:
 *
 *    <div class="destination-label-wrap">           ← maplibre marker el
 *      <div class="destination-label" data-dest-id> ← our styled label
 *        {name}
 *      </div>
 *    </div>
 *
 *  The wrap exists ONLY so maplibre's per-frame inline-style writes
 *  (`transform`, `opacity: 1`) target it instead of clobbering the
 *  styled inner label. CSS rules on `.destination-label` then control
 *  hover-only visibility without an inline-vs-stylesheet specificity
 *  fight. The data attribute lets the SignCard hover wiring address
 *  each label by destination id. */
function createDestinationLabel(
  name: string,
  destId: string,
): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'destination-label-wrap';
  const inner = document.createElement('div');
  inner.className = 'destination-label';
  inner.dataset.destId = destId;
  inner.textContent = truncate(name);
  wrap.appendChild(inner);
  return wrap;
}

/** A row reference shape that's compatible with both the embedded
 *  `Destination` (sign-face row) and a plain object — the helper only
 *  needs `name` and optionally `destinationPlaceId` to look up the
 *  canonical DestinationPlace. */
export interface FocalDestinationRow {
  name: string;
  destinationPlaceId?: string;
}

/** Render a label marker at each focal-sign destination's canonical
 *  lat/lng. Returns the marker handles so the caller can clear them
 *  before re-rendering on data / style changes.
 *
 *  Lookup precedence: `destinationPlaceId` wins; falls back to
 *  case-insensitive name match. Dedupes by DestinationPlace id so the
 *  same destination appearing on both faces of a sign produces only
 *  one label.
 *
 *  No-ops cleanly when maplibregl isn't available (e.g., the inset
 *  map's effect bailed before adding the global). */
export function drawDestinationLabels(
  map: unknown,
  focalRows: ReadonlyArray<FocalDestinationRow>,
  destinations: ReadonlyArray<DestinationPlace>,
): unknown[] {
  const maplibregl = (globalThis as { maplibregl?: { Marker: new (opts: unknown) => unknown } }).maplibregl;
  if (!maplibregl?.Marker) return [];

  const dpById = new Map<string, DestinationPlace>();
  const dpByName = new Map<string, DestinationPlace>();
  for (const d of destinations) {
    if (d.archivedAt) continue;
    dpById.set(d.id, d);
    dpByName.set(d.name.toLowerCase().trim(), d);
  }

  const markers: unknown[] = [];
  const seen = new Set<string>();
  for (const row of focalRows) {
    let dp: DestinationPlace | undefined;
    if (row.destinationPlaceId) dp = dpById.get(row.destinationPlaceId);
    if (!dp && row.name) dp = dpByName.get(row.name.toLowerCase().trim());
    if (!dp) continue;
    if (seen.has(dp.id)) continue;
    seen.add(dp.id);

    const el = createDestinationLabel(dp.name, dp.id);
    const marker = new maplibregl.Marker({
      element: el,
      anchor: 'left',
    });
    // setLngLat + addTo via duck-typed marker API; both methods
    // chain on maplibregl.Marker.
    (marker as { setLngLat: (xy: [number, number]) => unknown })
      .setLngLat([dp.lng, dp.lat]);
    (marker as { addTo: (m: unknown) => unknown }).addTo(map);
    markers.push(marker);
  }
  return markers;
}

/** Remove the marker handles produced by a previous
 *  `drawDestinationLabels` call. Best-effort — markers may have been
 *  detached when the map was replaced. */
export function clearDestinationLabels(markers: ReadonlyArray<unknown>): void {
  for (const m of markers) {
    try {
      (m as { remove: () => void }).remove();
    } catch {
      /* already detached — ignore */
    }
  }
}
