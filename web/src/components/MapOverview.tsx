import { useEffect, useRef, useState, useCallback } from 'react';
import type {
  SignInstance,
  SignType,
  ReviewStatus,
  DestinationPlace,
} from '../platform/index.ts';
import { LocationSearch } from './LocationSearch.tsx';
import { updateInstance } from '../lib/instances.ts';
import {
  drawAllLinks,
  clearAllLinks,
  drawSelectedLinks,
  clearSelectedLinks,
  clearAllDestinationLayers,
} from '../lib/destinationLinks.ts';
import { hideOsmLabels } from '../lib/mapLabels.ts';
import { getMapStyleUrl } from '../lib/mapStyle.ts';
import { createPlacementGhostMarker } from '../lib/placeSignMarker.ts';

interface Props {
  instances: SignInstance[];
  signTypes: Record<string, SignType>;
  onSelectSign: (id: string) => void;
  onClose: () => void;
  /** When set, the map is in placement mode for this sign type. */
  placingTypeId?: string | null;
  /** Called when the user clicks the map to place a sign. */
  onPlaceSign?: (lat: number, lng: number) => void;
  /** Exit placement mode. */
  onCancelPlace?: () => void;
  isDark?: boolean;
  /** Phase I1 — selected basemap id from project.basemapId. Undefined →
   *  the registry default (MapTiler Streets). */
  basemapId?: string;
  /** ID of the currently selected sign instance (for highlighted links). */
  selectedSignId?: string | null;
  /** Destinations rendered as draggable markers on the map.
   *  Archived destinations (`archivedAt != null`) are excluded — list view
   *  owns the archive affordance. */
  destinations?: DestinationPlace[];
  /** When true, the map is in destination-placement mode: the next map
   *  click invokes `onPlaceDestination(lat, lng)` and the cursor shows
   *  the crosshair. Mutually exclusive with `placingTypeId` — the app
   *  enforces this by cancelling one when entering the other. */
  placingDestination?: boolean;
  /** Called when the user clicks the map in destination-placement mode.
   *  Unlike sign placement, this does NOT show a ghost-marker confirm
   *  step — the caller opens the Phase 1 inline add form instead, which
   *  is where the user confirms name / tier / district. */
  onPlaceDestination?: (lat: number, lng: number) => void;
  /** Exit destination-placement mode. */
  onCancelPlaceDestination?: () => void;
  /** Persist a destination after a drag-to-move. The repo's `save()` is
   *  create-or-update by id, so the caller just forwards the whole
   *  record with the new lat/lng. */
  onUpdateDestination?: (dest: DestinationPlace) => void;
}

const MAP_POS_KEY = 'sosisu:signal:map-pos';

function saveMapPos(lng: number, lat: number, zoom: number) {
  localStorage.setItem(MAP_POS_KEY, JSON.stringify({ lng, lat, zoom }));
}

function loadMapPos(): { lng: number; lat: number; zoom: number } | null {
  try {
    const raw = localStorage.getItem(MAP_POS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function statusColor(s: ReviewStatus): string {
  switch (s) {
    case 'approved': return '#5CBF7A';
    case 'edited': return '#E8B84A';
    case 'flagged': return '#E8614F';
    default: return 'transparent';
  }
}

export function MapOverview({
  instances,
  signTypes,
  onSelectSign,
  onClose,
  placingTypeId,
  onPlaceSign,
  onCancelPlace,
  isDark = true,
  basemapId,
  selectedSignId,
  destinations = [],
  placingDestination = false,
  onPlaceDestination,
  onCancelPlaceDestination,
  onUpdateDestination,
}: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mlMapRef = useRef<any>(null);
  const placingRef = useRef(placingTypeId);
  placingRef.current = placingTypeId;
  const onPlaceRef = useRef(onPlaceSign);
  onPlaceRef.current = onPlaceSign;

  // Destination placement + drag refs — mirror the sign-placement pattern
  // so the map's click handler can pull the latest callback without the
  // closure baking in a stale reference.
  const placingDestRef = useRef(placingDestination);
  placingDestRef.current = placingDestination;
  const onPlaceDestRef = useRef(onPlaceDestination);
  onPlaceDestRef.current = onPlaceDestination;
  const onUpdateDestRef = useRef(onUpdateDestination);
  onUpdateDestRef.current = onUpdateDestination;

  // Destination link toggle
  const [showLinks, setShowLinks] = useState(false);
  const showLinksRef = useRef(showLinks);
  showLinksRef.current = showLinks;

  // Placement preview state — ghost marker before confirming
  const [previewPos, setPreviewPos] = useState<{ lat: number; lng: number } | null>(null);
  const previewMarkerRef = useRef<any>(null);
  const previewPosRef = useRef(previewPos);
  previewPosRef.current = previewPos;

  // Move mode state — which instance is being moved
  const [movingInstanceId, setMovingInstanceId] = useState<string | null>(null);

  // Tooltip element ref for placement mode
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Destination markers keyed by destination id. The bookkeeping has to
  // outlive individual effects because the diff runs on every
  // `destinations` prop change, while creation/cleanup is scoped to the
  // map's lifetime (see main effect's cleanup).
  const destMarkersRef = useRef<Map<string, any>>(new Map());

  // Sign markers live in a ref (not rebuilt by recreating the map) so the
  // map can be created ONCE and markers re-synced on `instances` change —
  // avoids the tile-reload flash that a full map rebuild caused on sign
  // placement. `onSelectRef` keeps the popup "Review →" callback current
  // for the map's once-registered global handler; `didInitialFitRef` gates
  // the fit-to-all-signs to a single first run.
  const signMarkersRef = useRef<Record<string, any>>({});
  const onSelectRef = useRef(onSelectSign);
  onSelectRef.current = onSelectSign;
  const didInitialFitRef = useRef(false);
  // Current data for the once-registered style.load link redraw, so the
  // setStyle effect can depend only on the actual style inputs (theme /
  // basemap) and NOT on `instances`/`destinations` — otherwise placing a
  // sign would re-run setStyle and reload the whole style (a flash).
  const instancesRef = useRef(instances);
  instancesRef.current = instances;
  const destinationsRef = useRef(destinations);
  destinationsRef.current = destinations;

  // Monotonic counter incremented when a fresh map is ready to host
  // markers. The destination-markers effect depends on this so it runs
  // once per map lifetime (not on every React render), and doesn't try
  // to attach markers before the MapLibre instance is available.
  const [mapReady, setMapReady] = useState(0);

  // Stats
  const counts = { approved: 0, edited: 0, flagged: 0, pending: 0 };
  for (const inst of instances) counts[inst.reviewStatus]++;

  // Cursor style for placement mode (sign OR destination)
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    el.style.cursor = placingTypeId || placingDestination ? 'crosshair' : '';
  }, [placingTypeId, placingDestination]);

  // Tooltip follow cursor during placement mode (sign OR destination).
  // Uses a single tooltip element; the rendered text branches on mode.
  useEffect(() => {
    const el = mapRef.current;
    const tip = tooltipRef.current;
    if (!el || !tip) return;
    if (!placingTypeId && !placingDestination) {
      tip.style.display = 'none';
      return;
    }
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      tip.style.display = 'block';
      tip.style.left = `${e.clientX - rect.left + 14}px`;
      tip.style.top = `${e.clientY - rect.top + 14}px`;
    };
    const onLeave = () => { tip.style.display = 'none'; };
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
      tip.style.display = 'none';
    };
  }, [placingTypeId, placingDestination]);

  useEffect(() => {
    if (!mapRef.current) return;
    const maplibregl = (window as any).maplibregl;
    if (!maplibregl) return;

    if (mlMapRef.current) {
      mlMapRef.current.remove();
    }

    // Tile style URL is centralised in `lib/mapStyle.ts` so both this
    // map and SignCard's inset map agree on dark/light variants and
    // dev/prod base. Theme changes hot-swap via `map.setStyle` in the
    // sibling effect below — this URL is just the initial render.
    const styleUrl = getMapStyleUrl(basemapId, { isDark });

    // Determine initial position: saved position > instance bounds > world view
    const saved = loadMapPos();
    const initCenter: [number, number] = saved ? [saved.lng, saved.lat] : [0, 20];
    const initZoom = saved ? saved.zoom : 2;

    const map = new maplibregl.Map({
      container: mapRef.current,
      style: styleUrl,
      center: initCenter,
      zoom: initZoom,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      // In dev, rewrite all api.maptiler.com requests through the Vite proxy
      // to avoid CORS issues with localhost origins.
      ...(import.meta.env.DEV
        ? {
            transformRequest: (url: string) => {
              if (url.startsWith('https://api.maptiler.com')) {
                return { url: url.replace('https://api.maptiler.com', `${window.location.origin}/maptiler`) };
              }
              return { url };
            },
          }
        : {}),
    });

    // Persist position on move
    map.on('moveend', () => {
      const c = map.getCenter();
      saveMapPos(c.lng, c.lat, map.getZoom());
    });

    // Global callbacks for popup buttons. The map is created once, so read
    // the live onSelect via a ref (a captured `onSelectSign` would go stale)
    // and look up markers in the shared `signMarkersRef` (synced separately).
    (window as any).__signalGoTo = (id: string) => {
      onSelectRef.current(id);
    };

    (window as any).__signalMoveSign = (id: string) => {
      const marker = signMarkersRef.current[id];
      if (!marker) return;
      marker.setDraggable(true);
      marker.getElement().style.cursor = 'grab';
      marker.getElement().style.filter = 'drop-shadow(0 0 8px #ADDFF7)';
      // Close popup
      const popup = marker.getPopup();
      if (popup && popup.isOpen()) popup.remove();
      setMovingInstanceId(id);

      const onDragEnd = () => {
        const lngLat = marker.getLngLat();
        updateInstance(id, { lat: lngLat.lat, lng: lngLat.lng });
        marker.setDraggable(false);
        marker.getElement().style.cursor = 'pointer';
        marker.getElement().style.filter = 'drop-shadow(0 1px 4px rgba(0,0,0,.9))';
        setMovingInstanceId(null);
        marker.off('dragend', onDragEnd);
      };
      marker.on('dragend', onDragEnd);
    };

    // Click-to-place handler. Sign placement goes through a ghost-preview
    // confirm step; destination placement goes straight to the caller
    // (they open a form to collect name/tier/district, which is the
    // effective confirm step).
    map.on('click', (e: any) => {
      if (placingRef.current && onPlaceRef.current) {
        setPreviewPos({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      } else if (placingDestRef.current && onPlaceDestRef.current) {
        onPlaceDestRef.current(e.lngLat.lat, e.lngLat.lng);
      }
    });

    map.on('load', () => {
      // Silence MapTiler/OSM POI / building / place / transit labels —
      // their naming convention diverges from the project's CSV so
      // they create false-positive "the building is in the wrong
      // place" confusion. Roads and street labels stay visible for
      // navigation context. (See `lib/mapLabels.ts`.)
      hideOsmLabels(map);

      // Sign markers + the initial fit are handled by the dedicated
      // sign-marker sync effect below (keyed on `mapReady` + `instances`),
      // so the map is created ONCE and placing a sign re-syncs markers on
      // this live map instead of recreating it (which re-fetched tiles and
      // flashed). `setMapReady` triggers that effect.

      // Draw destination links if the toggle is already on
      if (showLinksRef.current) {
        drawAllLinks(map, instances, destinations);
      }

      // Signal the destination-markers effect that the map is ready
      // to receive them. Increment so each map lifetime is distinct.
      setMapReady((k) => k + 1);
    });

    mlMapRef.current = map;

    return () => {
      delete (window as any).__signalGoTo;
      delete (window as any).__signalMoveSign;
      clearAllDestinationLayers(map);
      // Destination markers are attached to *this* map — nuke them so
      // the next effect pass re-creates them on the new map instance.
      for (const m of destMarkersRef.current.values()) {
        try { m.remove(); } catch {
          /* marker already detached — best-effort cleanup */
        }
      }
      destMarkersRef.current.clear();
      // Sign markers are attached to this map too — clear the ref so a
      // remount re-syncs onto the fresh map instance.
      signMarkersRef.current = {};
      didInitialFitRef.current = false;
      map.remove();
      mlMapRef.current = null;
    };
    // Create the map ONCE. `isDark`/`basemapId` are handled by the
    // setStyle sibling effect; `instances`/`signTypes`/`onSelectSign` are
    // handled by the sign-marker sync effect (markers) + links effect, all
    // operating on this live map. Keeping creation out of those deps is what
    // stops the tile-reload flash on sign placement (recreating the map per
    // `instances` change re-fetched tiles + rebuilt every marker).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Phase 5c follow-up: hot-swap tile style on theme change ─────────────
  //
  // `setStyle` fetches the new style.json and clears every layer +
  // source the map was carrying — but HTML markers (sign dots,
  // destination markers) survive because they're DOM overlays, not
  // map-rendered. The only custom *layer* MapOverview adds is the
  // destination-link line set drawn by `drawAllLinks`, which is
  // gated on `showLinksRef.current`. Re-add it on `style.load` if
  // the toggle is on.
  useEffect(() => {
    const map = mlMapRef.current;
    if (!map) return;
    const onStyleLoad = () => {
      // setStyle re-loads the default style with all layers visible —
      // re-silence the POI / building / place / transit labels (road
      // and street labels stay visible).
      hideOsmLabels(map);
      // Re-apply the all-destinations link layer if it was visible
      // before the style swap. Read current data via refs so this effect
      // need not depend on instances/destinations (which would re-run
      // setStyle on every placement — a flash).
      if (showLinksRef.current) {
        drawAllLinks(map, instancesRef.current, destinationsRef.current);
      }
    };
    map.once('style.load', onStyleLoad);
    map.setStyle(getMapStyleUrl(basemapId, { isDark }));
    return () => {
      map.off('style.load', onStyleLoad);
    };
  }, [isDark, basemapId]);

  // ── Destination markers — create / update / remove diff ─────────────────
  //
  // Runs whenever the active destinations list changes or a fresh map is
  // ready. Drags are persisted on `dragend` via the `onUpdateDestRef`
  // callback — we pass the whole record through unchanged except for
  // lat/lng so the repo's `save()` handles create-or-update correctly.
  // Trivial drags (< ~1m) are discarded to avoid spurious `updatedAt`
  // bumps from stray clicks that register as drags.
  useEffect(() => {
    if (!mapReady) return;
    const map = mlMapRef.current;
    const maplibregl = (window as any).maplibregl;
    if (!map || !maplibregl) return;

    const active = destinations.filter((d) => !d.archivedAt);
    const activeIds = new Set(active.map((d) => d.id));

    // Remove markers whose destination is archived or deleted.
    for (const [id, marker] of destMarkersRef.current) {
      if (!activeIds.has(id)) {
        marker.remove();
        destMarkersRef.current.delete(id);
      }
    }

    // Create or reposition markers.
    for (const dest of active) {
      const existing = destMarkersRef.current.get(dest.id);
      if (existing) {
        const prev = existing.getLngLat();
        if (
          Math.abs(prev.lat - dest.lat) > 1e-9 ||
          Math.abs(prev.lng - dest.lng) > 1e-9
        ) {
          existing.setLngLat([dest.lng, dest.lat]);
        }
        continue;
      }

      const el = document.createElement('div');
      el.className = 'dest-marker';
      Object.assign(el.style, {
        width: '12px',
        height: '12px',
        borderRadius: '50%',
        background: 'var(--product-accent, #ADDFF7)',
        border: '2px solid var(--sosisu-bg-black, #0E0E10)',
        boxShadow: '0 1px 4px rgba(0,0,0,.8)',
        cursor: 'grab',
      });

      const popup = new maplibregl.Popup({
        closeButton: false,
        offset: 14,
        className: 'dest-popup',
      }).setText(dest.name);

      const marker = new maplibregl.Marker({
        element: el,
        anchor: 'center',
        draggable: true,
      })
        .setLngLat([dest.lng, dest.lat])
        .addTo(map);

      // Hover → popup. Not always-on because the map is already dense.
      el.addEventListener('mouseenter', () => {
        popup.setLngLat(marker.getLngLat()).addTo(map);
      });
      el.addEventListener('mouseleave', () => {
        popup.remove();
      });

      marker.on('dragstart', () => {
        el.style.cursor = 'grabbing';
        popup.remove();
      });

      marker.on('dragend', () => {
        el.style.cursor = 'grab';
        const lngLat = marker.getLngLat();
        // ~1m threshold in lat/lng degrees. Filters out clicks that
        // registered as zero-distance drags and avoids writing an
        // unchanged record just to bump `updatedAt`.
        const latDiff = Math.abs(lngLat.lat - dest.lat);
        const lngDiff = Math.abs(lngLat.lng - dest.lng);
        if (latDiff < 1e-5 && lngDiff < 1e-5) return;
        onUpdateDestRef.current?.({
          ...dest,
          lat: lngLat.lat,
          lng: lngLat.lng,
        });
      });

      destMarkersRef.current.set(dest.id, marker);
    }
  }, [mapReady, destinations]);

  // ── Sign markers — re-synced on the LIVE map (no map recreate) ──────────
  //
  // Runs when the sign list changes or a fresh map is ready. Mirrors the
  // destination-marker effect above: rebuilding markers here (rather than
  // recreating the whole map on every `instances` change) is what removes
  // the tile-reload flash when placing a sign. Markers are tracked in
  // `signMarkersRef` so `__signalMoveSign` can find them and so this effect
  // can clear the previous batch before re-adding.
  useEffect(() => {
    if (!mapReady) return;
    const map = mlMapRef.current;
    const maplibregl = (window as any).maplibregl;
    if (!map || !maplibregl) return;

    // Full rebuild: drop the previous batch, re-add from current instances.
    for (const id of Object.keys(signMarkersRef.current)) {
      try {
        signMarkersRef.current[id].remove();
      } catch {
        /* marker already detached — best-effort cleanup */
      }
    }
    signMarkersRef.current = {};

    const bounds = new maplibregl.LngLatBounds();

    for (const inst of instances) {
      if (!inst.lat || !inst.lng) continue;
      bounds.extend([inst.lng, inst.lat]);

      // Sign marker — plain colored dot, color-coded by review status.
      // statusColor() returns 'transparent' for pending; fall back to a
      // neutral grey so pending dots stay visible (the colour IS the body).
      const dotColor =
        statusColor(inst.reviewStatus) === 'transparent'
          ? '#3A3A3E'
          : statusColor(inst.reviewStatus);
      const wrap = document.createElement('div');
      wrap.className = 'sign-marker-wrap';
      wrap.style.cursor = 'pointer';

      const dot = document.createElement('div');
      dot.className = 'sign-marker';
      dot.style.background = dotColor;
      wrap.appendChild(dot);

      const label = document.createElement('span');
      label.className = 'sign-marker-label';
      // CU Boulder seed format: cu-bldr-sign-{CODE}-{NUM}. The
      // user-meaningful slice is everything after `cu-bldr-sign-`.
      label.textContent = inst.id.startsWith('cu-bldr-sign-')
        ? inst.id.slice('cu-bldr-sign-'.length)
        : inst.id;
      wrap.appendChild(label);

      const el = wrap;

      const st = signTypes[inst.signTypeId];
      const destList = inst.sides
        .flatMap((s) => s.destinations)
        .slice(0, 4)
        .map((d) => d.name)
        .join('<br>');
      const moreCount = inst.sides.flatMap((s) => s.destinations).length - 4;

      const popupHtml = `
          <div style="padding:.75rem 1rem;min-width:200px;font-family:'IBM Plex Sans',sans-serif;">
            <div style="font-size:20px;font-weight:300;margin-bottom:2px">${inst.id}</div>
            <div style="font-size:12px;color:#8E8E93;margin-bottom:8px">
              ${inst.neighborhood || ''} · ${st?.name || st?.code || ''}
            </div>
            <div style="font-size:12px;color:#8E8E93;line-height:1.7;margin-bottom:8px">
              ${destList}${moreCount > 0 ? `<div style="font-size:11px;color:#8E8E93">+${moreCount} more</div>` : ''}
            </div>
            <div style="display:flex;gap:6px">
              <button onclick="window.__signalGoTo && window.__signalGoTo('${inst.id}')" style="
                flex:1;padding:7px;
                background:rgba(116,135,145,.1);border:1px solid rgba(116,135,145,.3);
                border-radius:4px;color:#748791;font-family:'IBM Plex Mono',monospace;
                font-size:11px;letter-spacing:.06em;text-transform:uppercase;
                cursor:pointer;text-align:center;
              ">Review →</button>
              <button onclick="window.__signalMoveSign && window.__signalMoveSign('${inst.id}')" style="
                padding:7px 10px;
                background:rgba(173,223,247,.08);border:1px solid rgba(173,223,247,.25);
                border-radius:4px;color:#ADDFF7;font-family:'IBM Plex Mono',monospace;
                font-size:11px;letter-spacing:.06em;text-transform:uppercase;
                cursor:pointer;text-align:center;
              ">Move</button>
            </div>
          </div>
        `;

      const popup = new maplibregl.Popup({
        closeButton: false,
        maxWidth: '240px',
        className: 'cu-popup',
      }).setHTML(popupHtml);

      const marker = new maplibregl.Marker({ element: el, anchor: 'left' })
        .setLngLat([inst.lng, inst.lat])
        .setPopup(popup)
        .addTo(map);
      signMarkersRef.current[inst.id] = marker;
    }

    // Fit-to-all-signs ONCE — first run only, and only when the user has no
    // saved camera. moveend persists the camera (incl. this fit), so later
    // placements respect the user's position instead of zoom-bouncing.
    if (!didInitialFitRef.current && !bounds.isEmpty() && !loadMapPos()) {
      map.fitBounds(bounds, { padding: 40 });
    }
    didInitialFitRef.current = true;
  }, [mapReady, instances, signTypes]);

  // Ghost preview marker — shown on click before confirming placement
  useEffect(() => {
    const map = mlMapRef.current;
    const maplibregl = (window as any).maplibregl;
    if (!map || !maplibregl || !previewPos) {
      // Remove stale preview marker
      if (previewMarkerRef.current) {
        previewMarkerRef.current.remove();
        previewMarkerRef.current = null;
      }
      return;
    }
    // Remove old preview marker if repositioning
    if (previewMarkerRef.current) {
      previewMarkerRef.current.remove();
    }
    // Phase 6 \u2014 split outer wrapper from inner glyph so MapLibre's
    // inline-style positioning transform on the marker root isn't
    // clobbered by `.placement-ghost-marker`'s CSS `transform: scale(...)`
    // / `ghost-appear` keyframe. Pre-fix, the CSS won and the dash
    // rendered at the map container's top-left regardless of click point.
    const { outer } = createPlacementGhostMarker();
    const marker = new maplibregl.Marker({ element: outer, anchor: 'center' })
      .setLngLat([previewPos.lng, previewPos.lat])
      .addTo(map);
    previewMarkerRef.current = marker;
    return () => {
      marker.remove();
      previewMarkerRef.current = null;
    };
  }, [previewPos]);

  // Confirm or cancel placement preview
  const handleConfirmPlace = useCallback(() => {
    if (previewPos && onPlaceSign) {
      onPlaceSign(previewPos.lat, previewPos.lng);
    }
    setPreviewPos(null);
  }, [previewPos, onPlaceSign]);

  const handleCancelPreview = useCallback(() => {
    setPreviewPos(null);
  }, []);

  // Clear preview when exiting placement mode
  useEffect(() => {
    if (!placingTypeId) setPreviewPos(null);
  }, [placingTypeId]);

  // React to showLinks toggle
  useEffect(() => {
    const map = mlMapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    if (showLinks) {
      drawAllLinks(map, instances, destinations);
    } else {
      clearAllLinks(map);
    }
  }, [showLinks, instances, destinations]);

  // React to selected sign changes — draw highlighted links
  useEffect(() => {
    const map = mlMapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    if (selectedSignId) {
      const inst = instances.find((i) => i.id === selectedSignId);
      if (inst) {
        drawSelectedLinks(map, inst, destinations);
      } else {
        clearSelectedLinks(map);
      }
    } else {
      clearSelectedLinks(map);
    }
  }, [selectedSignId, instances, destinations]);

  const maptilerKey =
    (import.meta.env.VITE_MAPTILER_KEY as string | undefined) ?? '';

  const handleLocationSelect = useCallback(
    (lat: number, lng: number, _name: string) => {
      const map = mlMapRef.current;
      if (!map) return;
      map.jumpTo({ center: [lng, lat], zoom: 16 });
      // Force a resize so tiles re-render at the new position
      requestAnimationFrame(() => map.resize());
      saveMapPos(lng, lat, 16);
    },
    [],
  );

  const placingType = placingTypeId ? signTypes[placingTypeId] : null;

  return (
    <div className="map-overview">
      {/* Stats bar */}
      <div className="map-stats">
        {movingInstanceId ? (
          <>
            <div className="map-stat" style={{ color: '#ADDFF7', fontWeight: 500 }}>
              Drag {movingInstanceId} to new position
            </div>
            <button
              className="map-close-btn"
              onClick={() => setMovingInstanceId(null)}
              title="Cancel move"
              style={{ color: '#E8614F' }}
            >
              {'×'}
            </button>
          </>
        ) : placingTypeId && placingType ? (
          <>
            <div className="map-stat" style={{ color: '#ADDFF7', fontWeight: 500 }}>
              {previewPos
                ? `Confirm placement: ${placingType.code}`
                : `Click map to place: ${placingType.code} — ${placingType.name}`}
            </div>
            {previewPos ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="placement-ok-btn" onClick={handleConfirmPlace}>
                  OK
                </button>
                <button className="placement-cancel-btn" onClick={handleCancelPreview}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="map-close-btn"
                onClick={onCancelPlace}
                title="Exit placement mode"
              >
                {'×'}
              </button>
            )}
          </>
        ) : placingDestination ? (
          <>
            <div
              className="map-stat"
              style={{ color: '#ADDFF7', fontWeight: 500 }}
            >
              Click on the map to place a destination
            </div>
            <button
              className="map-close-btn"
              onClick={onCancelPlaceDestination}
              title="Exit placement mode"
            >
              {'×'}
            </button>
          </>
        ) : (
          <>
            <div className="map-stat">
              <div className="map-stat-dot" style={{ background: '#5CBF7A' }} />
              {counts.approved} approved
            </div>
            <div className="map-stat">
              <div className="map-stat-dot" style={{ background: '#E8B84A' }} />
              {counts.edited} edited
            </div>
            <div className="map-stat">
              <div className="map-stat-dot" style={{ background: '#E8614F' }} />
              {counts.flagged} flagged
            </div>
            <div className="map-stat">
              <div className="map-stat-dot" style={{ background: '#3A3A3E' }} />
              {counts.pending} pending
            </div>
            <div
              className="map-stat"
              style={{
                color: 'var(--product-accent)',
                borderLeft: '1px solid var(--sosisu-border)',
                paddingLeft: '1.5rem',
              }}
            >
              {instances.length} signs total
            </div>
            <button
              className="map-close-btn"
              onClick={onClose}
              title="Back to review"
            >
              {'×'}
            </button>
          </>
        )}
      </div>

      {/* Map */}
      <div ref={mapRef} className="overview-map" />

      {/* Placement tooltip — follows cursor */}
      <div ref={tooltipRef} className="placement-tooltip" style={{ display: 'none' }}>
        {placingDestination
          ? 'Click to place destination'
          : `Click to place ${placingType?.code ?? 'sign'}`}
      </div>

      {/* Location search overlay */}
      <div className="loc-search-wrap">
        <LocationSearch
          onSelect={handleLocationSelect}
          maptilerKey={maptilerKey}
        />
      </div>

      {/* Destination links toggle */}
      <button
        className={`map-links-toggle${showLinks ? ' active' : ''}`}
        onClick={() => setShowLinks((v) => !v)}
        title={showLinks ? 'Hide destination links' : 'Show destination links'}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginRight: 6 }}>
          <path
            d="M2 12L12 2"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="3 2"
            strokeLinecap="round"
          />
          <circle cx="2" cy="12" r="1.5" fill="currentColor" />
          <circle cx="12" cy="2" r="1.5" fill="currentColor" />
        </svg>
        {showLinks ? 'Links on' : 'Show links'}
      </button>
    </div>
  );
}
