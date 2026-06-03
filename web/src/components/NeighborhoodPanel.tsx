// ─── NeighborhoodPanel — Phase 5d v2 ───────────────────────────────────
//
// Replaces the `NearbyPanel` right-rail-style sibling with a section
// rendered INSIDE the SignCard's main panel, below the destinations
// table. The mental model shifted from conflict-detection to
// celebrating overlap as the positive signal it is in EGD:
//
//   - Mini-map: spatial picture of the current sign + nearby signs +
//     destinations on this sign. Anchor marker (current) is centred
//     and visually heavier than neighbour markers.
//   - Shared-destination chips: destinations on this sign that ALSO
//     appear on at least one neighbour, with a count of covering
//     neighbours. Click to highlight on the map (commit). Hover to
//     preview the same highlight without committing.
//   - Nearby-signs list: every sign within the catchment radius,
//     sorted by distance. Click a row → recenter map on that sign
//     and highlight it. Does NOT switch the SignCard view (no
//     accidental loss of edit state).
//   - "Trace route" button is a visible placeholder for Phase 5e
//     (route-consistency checking with hierarchy-aware decay).
//
// What this component INTENTIONALLY does not do (see Phase 5d v2 spec):
//
//   - Surface "conflicts" or "redundancy" — we deleted both concepts.
//   - Persist chip-selection across signs.
//   - Always-on connector lines from neighbours to destinations —
//     connectors render only while a chip is selected or hovered.

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  DestinationPlace,
  SignInstance,
  SignType,
} from '../platform/index.ts';
import {
  bearingToCompass8,
  metresToFeet,
  type NeighborhoodAnalysis,
} from '../lib/nearbyOverlap.ts';

// ─── Connector mode (Phase 5d v2 follow-up — interactive testing) ─────
//
// Three relationship-rendering strategies the reviewer can flip between
// live to compare:
//
//   1. 'cooccurrence' (Echoes) — chip-driven. When a Shared destination
//      is clicked, fan a separate dashed line from each covering sign
//      (current + neighbours) to that destination. Pure "this
//      destination is messaged on N signs" view; no path notion.
//
//   2. 'corridor' (Approach) — chip-driven. Routes a single walking
//      polyline from the current sign to the destination via Mapbox
//      Directions. The covering-neighbour signs render as ambient dots
//      already, so the line answers "how does the pedestrian actually
//      walk there?" while the dots answer "which other signs reinforce
//      this destination on the way?"
//
//   3. 'signFocused' (Pivot) — sign-row-driven. Click a nearby sign row
//      and that sign becomes the "active" sign — its full set of
//      destination connectors render on the map. Lets the reviewer ask
//      "what does THAT sign tell people?" without leaving the current
//      SignCard view.
//
// Internal type ids keep their original names so existing analysis/test
// code doesn't churn.
export type ConnectorMode = 'cooccurrence' | 'corridor' | 'signFocused';

import { getMapStyleUrl } from '../lib/mapStyle.ts';
import { hideOsmLabels } from '../lib/mapLabels.ts';
import { fetchWalkingRoute } from '../lib/walkingRoute.ts';

import { displaySignId } from '../lib/displaySignId.ts';

// ─── Props ────────────────────────────────────────────────────────────

export interface NeighborhoodPanelProps {
  current: SignInstance;
  /** Pre-computed by SignCard so the analysis can be memoised at the
   *  call site (the inputs change infrequently). */
  analysis: NeighborhoodAnalysis;
  /** Used to label nearby-sign rows with their type name. */
  signTypes: Record<string, SignType>;
  /** All destinations in the project — needed by 'signFocused'
   *  connector mode so we can resolve a neighbour's destination
   *  rows back to canonical lat/lng. */
  destinations: ReadonlyArray<DestinationPlace>;
  /** Theme — drives the mini-map's tile style. */
  isDark?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────

export function NeighborhoodPanel({
  current,
  analysis,
  signTypes,
  destinations,
  isDark = true,
}: NeighborhoodPanelProps) {
  const { nearbySigns, sharedDestinations } = analysis;
  const hasNeighbors = nearbySigns.length > 0;

  // Connector mode — the reviewer flips between three rendering
  // strategies live to evaluate which best surfaces "related signage."
  // See the ConnectorMode block comment near the imports for what each
  // mode does.
  const [connectorMode, setConnectorMode] = useState<ConnectorMode>('cooccurrence');

  // Selection state for chips + nearby-sign rows. Both reset whenever
  // the focal sign changes — Phase 5d v2 explicitly does NOT persist
  // selection across signs.
  const [selectedChipId, setSelectedChipId] = useState<string | null>(null);
  const [hoveredChipId, setHoveredChipId] = useState<string | null>(null);
  const [highlightedSignId, setHighlightedSignId] = useState<string | null>(
    null,
  );
  useEffect(() => {
    setSelectedChipId(null);
    setHoveredChipId(null);
    setHighlightedSignId(null);
  }, [current.id]);
  // Reset the active selections when the mode changes too — a chip
  // selection means something different in 'signFocused' mode than in
  // the other two, so we don't leak intent across modes.
  useEffect(() => {
    setSelectedChipId(null);
    setHoveredChipId(null);
    setHighlightedSignId(null);
  }, [connectorMode]);

  // Effective highlight: hover preview wins over committed selection
  // while the cursor is on a chip; on mouse-out the committed selection
  // takes over. This mirrors how the spec described it: "hover preview
  // without committing".
  const highlightedDestId = hoveredChipId ?? selectedChipId;

  return (
    <section
      className="nb-panel"
      aria-label="Neighborhood"
      data-has-neighbors={hasNeighbors ? 'true' : 'false'}
    >
      <header className="nb-header">
        <span className="nb-title">NEIGHBORHOOD</span>
        <ConnectorModeSwitcher mode={connectorMode} onChange={setConnectorMode} />
      </header>

      {!hasNeighbors ? (
        <div className="nb-empty">
          No nearby signs within {metresToFeet(500)} ft.
        </div>
      ) : (
        <>
          <NeighborhoodMap
            current={current}
            analysis={analysis}
            destinations={destinations}
            isDark={isDark}
            connectorMode={connectorMode}
            highlightedDestId={highlightedDestId}
            highlightedSignId={highlightedSignId}
          />

          <div className="nb-shared">
            <div className="nb-section-label">
              {sharedDestinations.length > 0 ? (
                <>
                  Shared destinations ·{' '}
                  <span className="nb-shared-count">
                    {sharedDestinations.length} also
                    {sharedDestinations.length === 1 ? ' appears' : ' appear'}
                    {' '}on nearby signs
                  </span>
                </>
              ) : (
                <span className="nb-section-label-muted">
                  Nearby signs don't share any destinations with this sign yet.
                </span>
              )}
            </div>
            {sharedDestinations.length > 0 && (
              <div className="nb-chip-row">
                {sharedDestinations.map((s) => (
                  <SharedChip
                    key={s.destination.id}
                    name={s.destination.name}
                    count={s.coveringNeighbors.length}
                    selected={selectedChipId === s.destination.id}
                    onClick={() =>
                      setSelectedChipId((cur) =>
                        cur === s.destination.id ? null : s.destination.id,
                      )
                    }
                    onHover={(on) =>
                      setHoveredChipId(on ? s.destination.id : null)
                    }
                  />
                ))}
              </div>
            )}
          </div>

          <div className="nb-nearby">
            <div className="nb-section-label">
              Nearby signs ({nearbySigns.length})
            </div>
            <ul className="nb-nearby-list">
              {nearbySigns.map((n) => {
                // How many of this sign's destinations also appear on
                // current sign's destinations? (Inverse view of the
                // "shares N" caption — useful at-a-glance signal.)
                const shareCount = sharedDestinations.reduce(
                  (acc, s) =>
                    acc +
                    (s.coveringNeighbors.some((c) => c.id === n.sign.id)
                      ? 1
                      : 0),
                  0,
                );
                const signType = signTypes[n.sign.signTypeId];
                const category = signType?.category ?? 'directional';
                return (
                  <li key={n.sign.id}>
                    <button
                      type="button"
                      data-category={category}
                      className={
                        'nb-nearby-row' +
                        (highlightedSignId === n.sign.id
                          ? ' nb-nearby-row-active'
                          : '')
                      }
                      onClick={() =>
                        setHighlightedSignId((cur) =>
                          cur === n.sign.id ? null : n.sign.id,
                        )
                      }
                    >
                      <span
                        className="nb-nearby-cat-dot"
                        aria-hidden="true"
                      />
                      <span className="nb-nearby-id">
                        {displaySignId(n.sign.id)}
                      </span>
                      <span className="nb-nearby-type">
                        {signType?.name ?? '—'}
                      </span>
                      <span className="nb-nearby-meta">
                        {metresToFeet(n.distanceMeters)} ft{' '}
                        {bearingToCompass8(n.bearingDegrees)}
                      </span>
                      {shareCount > 0 && (
                        <span className="nb-nearby-share">
                          shares {shareCount}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}

// ─── Connector-mode switcher ─────────────────────────────────────────
//
// Three-option segmented control. Lives in the panel header. Used to
// flip between Co-occurrence / Corridor / Sign-focused renderings on
// the same sign so the reviewer can compare visually. Plain buttons
// with `aria-checked` for accessibility — radio-button semantics
// without the form gymnastics.

function ConnectorModeSwitcher({
  mode,
  onChange,
}: {
  mode: ConnectorMode;
  onChange: (m: ConnectorMode) => void;
}) {
  const opts: Array<{ id: ConnectorMode; label: string; title: string }> = [
    {
      id: 'cooccurrence',
      label: 'Echoes',
      title: 'Pick a destination — see every sign that calls it out.',
    },
    {
      id: 'corridor',
      label: 'Approach',
      title: 'Pick a destination — see the chain of bearing-aligned signs on the walking approach.',
    },
    {
      id: 'signFocused',
      label: 'Pivot',
      title: 'Pick a nearby sign — see what THAT sign tells people.',
    },
  ];
  return (
    <div className="nb-mode-group" role="radiogroup" aria-label="Connector mode">
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={mode === o.id}
          className={'nb-mode-btn' + (mode === o.id ? ' nb-mode-btn-active' : '')}
          title={o.title}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── Shared destination chip ──────────────────────────────────────────

function SharedChip({
  name,
  count,
  selected,
  onClick,
  onHover,
}: {
  name: string;
  count: number;
  selected: boolean;
  onClick: () => void;
  onHover: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={'nb-chip' + (selected ? ' nb-chip-selected' : '')}
      onClick={onClick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      aria-pressed={selected}
    >
      <span className="nb-chip-name">{name}</span>
      <span className="nb-chip-count">
        on {count + 1} sign{count + 1 === 1 ? '' : 's'}
      </span>
    </button>
  );
}

// ─── Mini-map ──────────────────────────────────────────────────────────
//
// MapLibre instance scoped to the panel. Auto-fits to a bounding box
// covering the current sign + every nearby sign + (when a chip is
// active) the highlighted destination. Markers are HTML overlays so
// they survive setStyle theme swaps.
//
// Connector lines are added/removed via a single GeoJSON source whose
// data swaps when `highlightedDestId` changes — no per-line layer
// churn. When no chip is active the source is empty, keeping the map
// quiet.

function NeighborhoodMap({
  current,
  analysis,
  destinations,
  isDark,
  connectorMode,
  highlightedDestId,
  highlightedSignId,
}: {
  current: SignInstance;
  analysis: NeighborhoodAnalysis;
  destinations: ReadonlyArray<DestinationPlace>;
  connectorMode: ConnectorMode;
  isDark: boolean;
  highlightedDestId: string | null;
  highlightedSignId: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const currentMarkerRef = useRef<any>(null);
  const neighborMarkersRef = useRef<Map<string, any>>(new Map());
  const destDotMarkersRef = useRef<Map<string, any>>(new Map());

  /** Fixed zoom for the inset. Picked once at mount and never animated
   *  away from — earlier `fitBounds` recalculation on every focal-sign
   *  change produced visible zoom/pan motion that read as lag. With a
   *  tighter 200 m neighbourhood radius, zoom 16 frames the catchment
   *  comfortably without needing fitBounds at all. */
  const INSET_ZOOM = 16;

  // ── Mount the map once per panel instance ─────────────────────────
  // Earlier this effect was keyed on `[current.id]` and tore the
  // maplibre instance down + rebuilt it on every focal-sign change.
  // That recreation was the lag the reviewer felt when paging through
  // signs. Now: create once, then react to focal-sign / analysis
  // changes via the markers + `jumpTo` effect below.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (current.lat == null || current.lng == null) return;

    const maplibregl = (window as any).maplibregl;
    if (!maplibregl) return;

    const map = new maplibregl.Map({
      container,
      style: getMapStyleUrl(isDark),
      center: [current.lng, current.lat],
      zoom: INSET_ZOOM,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    mapRef.current = map;

    // On every style.load (initial + theme swap):
    //   1. Silence MapTiler/OSM POI labels so gas stations, restaurants,
    //      etc. don't compete with the sign markers for attention.
    //   2. Ensure the connectors source/layer exists so the chip-click
    //      effect can populate it without checking layer presence.
    const applyMapBaselines = () => {
      hideOsmLabels(map);
      if (!map.getSource('nb-connectors')) {
        map.addSource('nb-connectors', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        // Insert before first symbol layer so labels stay above lines.
        const firstSymbol = map
          .getStyle()
          ?.layers?.find((l: any) => l.type === 'symbol')?.id;
        map.addLayer(
          {
            id: 'nb-connectors-lyr',
            type: 'line',
            source: 'nb-connectors',
            paint: {
              // SOSISU Sky at low opacity — brand highlight for the
              // chip-selection state. CSS vars don't resolve in
              // maplibre paint expressions, so the hex is duplicated.
              'line-color': '#ADDFF7',
              'line-opacity': 0.65,
              'line-width': 1.25,
              'line-dasharray': [4, 4],
            },
          },
          firstSymbol,
        );
      }
    };
    map.on('style.load', applyMapBaselines);
    map.once('load', applyMapBaselines);

    return () => {
      map.remove();
      mapRef.current = null;
      currentMarkerRef.current = null;
      neighborMarkersRef.current.clear();
      destDotMarkersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── React to focal-sign / analysis changes — markers + jumpTo ──────
  // Wipes the existing markers, rebuilds them for the new focal sign
  // and its neighbours, and jumps (no animation) to the new center at
  // the fixed inset zoom. No fitBounds — the catchment radius already
  // bounds what's visible.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (current.lat == null || current.lng == null) return;

    const maplibregl = (window as any).maplibregl;
    if (!maplibregl) return;

    // Tear down stale markers first.
    if (currentMarkerRef.current) {
      currentMarkerRef.current.remove();
      currentMarkerRef.current = null;
    }
    for (const { marker } of neighborMarkersRef.current.values()) {
      marker.remove();
    }
    neighborMarkersRef.current.clear();
    for (const { marker } of destDotMarkersRef.current.values()) {
      marker.remove();
    }
    destDotMarkersRef.current.clear();

    // Anchor marker for the focal sign.
    const cur = document.createElement('div');
    cur.className = 'nb-map-current';
    currentMarkerRef.current = new maplibregl.Marker({
      element: cur,
      anchor: 'center',
    })
      .setLngLat([current.lng!, current.lat!])
      .addTo(map);

    // Neighbour markers. The dot is the marker element; the always-on
    // ID label hangs below via a CSS ::after pseudo reading
    // `data-label`. Pseudo-element approach keeps the marker a single
    // node so MapLibre's anchor stays on the dot's lat/lng.
    for (const n of analysis.nearbySigns) {
      if (n.sign.lat == null || n.sign.lng == null) continue;
      const el = document.createElement('div');
      el.className = 'nb-map-neighbor';
      el.dataset.label = displaySignId(n.sign.id);
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([n.sign.lng, n.sign.lat])
        .addTo(map);
      neighborMarkersRef.current.set(n.sign.id, { marker, el });
    }

    // Destination dot markers (shared destinations only).
    for (const s of analysis.sharedDestinations) {
      const el = document.createElement('div');
      el.className = 'nb-map-dest';
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([s.destination.lng, s.destination.lat])
        .addTo(map);
      destDotMarkersRef.current.set(s.destination.id, { marker, el });
    }

    // No animation on focal-sign change — reviewer asked for stillness.
    map.jumpTo({ center: [current.lng!, current.lat!], zoom: INSET_ZOOM });
  }, [current.id, analysis]);

  // ── Theme hot-swap ────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(getMapStyleUrl(isDark));
  }, [isDark]);

  // ── Highlight wiring — connector lines + marker emphasis ─────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource('nb-connectors');
    if (!src) return;

    if (current.lat == null || current.lng == null) return;
    const here: [number, number] = [current.lng, current.lat];

    // Destination dim/highlight pass.
    for (const [destId, { el }] of destDotMarkersRef.current.entries()) {
      el.classList.toggle(
        'nb-map-dest-active',
        highlightedDestId === destId,
      );
      el.classList.toggle(
        'nb-map-dest-dim',
        highlightedDestId !== null && highlightedDestId !== destId,
      );
    }

    // Build features for the connectors source. The strategy depends
    // on `connectorMode` — see the ConnectorMode block comment up top.
    // Each mode is its own feature-building function so we can iterate
    // on one without disturbing the others.
    const features: any[] = [];

    if (connectorMode === 'cooccurrence' && highlightedDestId) {
      // Mode A — fan: every covering sign → destination, individually.
      const shared = analysis.sharedDestinations.find(
        (s) => s.destination.id === highlightedDestId,
      );
      if (shared) {
        const dest: [number, number] = [
          shared.destination.lng,
          shared.destination.lat,
        ];
        features.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [here, dest] },
        });
        for (const cov of shared.coveringNeighbors) {
          if (cov.lat == null || cov.lng == null) continue;
          features.push({
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: [[cov.lng, cov.lat], dest],
            },
          });
        }
      }
    }

    if (connectorMode === 'corridor' && highlightedDestId) {
      // Mode B — single walking route from the current sign to the
      // destination via Mapbox Directions. The covering-neighbour signs
      // already render as ambient dots on the map; no need to thread the
      // line through them. Earlier "chain through aligned neighbours"
      // logic produced bouncing zigzags through buildings and water.
      //
      // Straight current→dest line is pushed synchronously so the
      // connector is visible immediately; once the routed walk fetches,
      // the cleanup below replaces the source data with the routed
      // geometry. Falls back to the straight line when the Mapbox token
      // isn't configured or the request fails.
      const shared = analysis.sharedDestinations.find(
        (s) => s.destination.id === highlightedDestId,
      );
      if (shared) {
        const dest: [number, number] = [
          shared.destination.lng,
          shared.destination.lat,
        ];
        features.push({
          type: 'Feature',
          properties: { kind: 'corridor' },
          geometry: { type: 'LineString', coordinates: [here, dest] },
        });
      }
    }

    if (connectorMode === 'signFocused' && highlightedSignId) {
      // Mode C — pick a neighbour, draw what THAT sign points at. We
      // resolve each of its destination rows back to a DestinationPlace
      // (canonical lat/lng) using the destinations prop, dedupe, and
      // fan a line from the neighbour to each.
      const dpById = new Map<string, DestinationPlace>();
      for (const d of destinations) {
        if (!d.archivedAt) dpById.set(d.id, d);
      }
      const neighbour = analysis.nearbySigns.find(
        (n) => n.sign.id === highlightedSignId,
      )?.sign;
      if (neighbour && neighbour.lat != null && neighbour.lng != null) {
        const seen = new Set<string>();
        const from: [number, number] = [neighbour.lng, neighbour.lat];
        for (const side of neighbour.sides) {
          for (const row of side.destinations) {
            if (!row.destinationPlaceId) continue;
            if (seen.has(row.destinationPlaceId)) continue;
            seen.add(row.destinationPlaceId);
            const dp = dpById.get(row.destinationPlaceId);
            if (!dp) continue;
            features.push({
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: [from, [dp.lng, dp.lat]],
              },
            });
          }
        }
      }
    }

    src.setData({ type: 'FeatureCollection', features });

    // Each mode gets its own paint signature so the reviewer can
    // visually distinguish them mid-comparison without reading the
    // active button. Driven via setPaintProperty (cheap — same layer,
    // same source) instead of swapping layers.
    //
    // Colors are the three SOSISU brand "bright" pastels — same family,
    // distinct hues, all on-brand:
    //   Echoes     → Signal Sky    #ADDFF7
    //   Approach   → Solid Mint    #B5F7AF
    //   Pivot      → Surface Aqua  #ADF7E9
    // Stroke and dash kept consistent so color carries the distinction.
    const paintByMode: Record<
      ConnectorMode,
      { color: string; width: number; dasharray: number[]; opacity: number }
    > = {
      cooccurrence: { color: '#ADDFF7', width: 1.25, dasharray: [3, 3], opacity: 0.8 },
      corridor: { color: '#B5F7AF', width: 1.25, dasharray: [3, 3], opacity: 0.85 },
      signFocused: { color: '#ADF7E9', width: 1.25, dasharray: [3, 3], opacity: 0.85 },
    };
    const p = paintByMode[connectorMode];
    try {
      map.setPaintProperty('nb-connectors-lyr', 'line-color', p.color);
      map.setPaintProperty('nb-connectors-lyr', 'line-width', p.width);
      map.setPaintProperty('nb-connectors-lyr', 'line-dasharray', p.dasharray);
      map.setPaintProperty('nb-connectors-lyr', 'line-opacity', p.opacity);
    } catch {
      /* layer may not exist yet on first style.load — ensureConnectors will
         re-apply on the next pass via the layer's static paint defaults */
    }

    // Approach mode upgrade: replace the straight current→dest line we
    // just pushed with a routed walking path from Mapbox Directions.
    // Cancellation guards against a stale fetch landing after the
    // reviewer has clicked a different chip or switched modes.
    if (connectorMode === 'corridor' && highlightedDestId) {
      const shared = analysis.sharedDestinations.find(
        (s) => s.destination.id === highlightedDestId,
      );
      if (shared) {
        const dest: [number, number] = [
          shared.destination.lng,
          shared.destination.lat,
        ];
        const ctrl = new AbortController();
        fetchWalkingRoute(here, dest, ctrl.signal).then((route) => {
          if (ctrl.signal.aborted || !route) return;
          const m = mapRef.current;
          const s2 = m?.getSource?.('nb-connectors');
          if (!s2) return;
          s2.setData({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: { kind: 'corridor' },
                geometry: route,
              },
            ],
          });
        });
        return () => ctrl.abort();
      }
    }
  }, [
    connectorMode,
    highlightedDestId,
    highlightedSignId,
    analysis,
    current,
    destinations,
  ]);

  // ── Nearby-sign row click → marker highlight + recenter ──────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const [id, { el }] of neighborMarkersRef.current.entries()) {
      el.classList.toggle(
        'nb-map-neighbor-active',
        highlightedSignId === id,
      );
    }
    // No `easeTo` here — clicking a row just highlights its dot. The
    // map view stays put so the reviewer doesn't lose spatial context
    // every time they tab through the list.
  }, [highlightedSignId]);

  return <div className="nb-map" ref={containerRef} aria-hidden="true" />;
}

// ─── Convenience re-export so SignCard's mock import surface stays
// in one place if/when this gets a context wrapper. ──────────────────

export type NeighborhoodPanelChildren = ReactNode; // (kept for future extensibility)
