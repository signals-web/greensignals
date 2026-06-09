import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type {
  SignInstance,
  SignType,
  Destination,
  SignSide,
  FacingDirection,
  ReviewStatus,
  DestinationPlace,
} from '../platform/index.ts';
import { CategoryIcon, CATEGORY_META } from './CategoryIcon.tsx';
import { ArrowDisplay, ArrowPicker } from './ArrowWidgets.tsx';
import { Compass } from './Compass.tsx';
import { updateInstance } from '../lib/instances.ts';
import { logActivity } from './RightPanel.tsx';
import {
  splitSides,
  estimateDestPos,
  FACING_DEG,
  type SplitSide,
  type SplitDest,
} from '../lib/directions.ts';
import {
  buildDestinationLookup,
  drawInsetLeaderLines,
} from '../lib/destinationLinks.ts';
import { computeInsetBounds } from '../lib/insetMapBounds.ts';
import {
  clearDestinationLabels,
  drawDestinationLabels,
  hideOsmLabels,
} from '../lib/mapLabels.ts';
import { getMapStyleUrl } from '../lib/mapStyle.ts';
import { NeighborhoodPanel } from './NeighborhoodPanel.tsx';
import { analyzeNeighborhood } from '../lib/nearbyOverlap.ts';
import {
  buildHandoffUrl,
  policyForSignType,
  resolveUseShortName,
  roleCan,
} from '../platform/index.ts';
import type { ProjectRole } from '../platform/index.ts';
import { DestinationPicker } from './DestinationPicker.tsx';
// Phase 3's `<DestinationSuggestions />` panel was removed from the
// edit-mode render in Phase 4 (bulk auto-population from the Project
// Dashboard supersedes it). Its file is kept on disk for possible
// reuse as an "explain this row" affordance.

const SURFACE_URL =
  (import.meta.env.VITE_SURFACE_URL as string | undefined) ??
  'http://localhost:5174';
const PROJECT_ID = 'cu-boulder';

const FACING_DIRS: FacingDirection[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

interface Props {
  instance: SignInstance;
  signType: SignType | undefined;
  allInstances: SignInstance[];
  signTypes: Record<string, SignType>;
  onNext: () => void;
  onPrev: () => void;
  canNext: boolean;
  canPrev: boolean;
  index: number;
  total: number;
  allFiltered: SignInstance[];
  onGoTo: (id: string) => void;
  reviewerName: string | null;
  onRequireReviewer: () => Promise<string | null>;
  onDeleteInstance?: (id: string) => void;
  /** Project's destination places. Powers the type-ahead picker on the
   *  edit table and the Phase 3 suggestions panel. Archived records are
   *  filtered out inside those components. */
  destinations?: DestinationPlace[];
  /** B4 — ensure DestinationPlace records exist for a batch of typed
   *  destination names (case-insensitive dedup, stub coords from the sign),
   *  persisting any new ones. Returns the resolved places in input order so
   *  Save can link each unlinked row by id. Optional — when absent, typed
   *  rows persist as free text (legacy behavior). */
  onEnsureDestinationPlaces?: (
    names: string[],
    stub: { lat: number; lng: number },
  ) => Promise<DestinationPlace[]>;
  /** Re-run the bulk schedule generator for a single sign with a
   *  given facing direction. Used by edit mode to live-preview the
   *  destination list as the reviewer cycles the facing dial. The
   *  caller does NOT persist; SignCard's existing Save flow commits
   *  whatever the editor ends up with. */
  onRegenerateOneSign?: (
    instance: SignInstance,
    facing: FacingDirection,
  ) => SignInstance;
  /** Whether the app is in dark mode. Drives the inset map's tile
   *  style — light mode swaps to a light MapTiler variant via
   *  `getMapStyleUrl(basemapId, { isDark })` and `map.setStyle()` so the inset
   *  matches the surrounding UI rather than fighting it. */
  isDark?: boolean;
  /** Phase I1 — selected basemap id from project.basemapId. Undefined →
   *  the registry default (MapTiler Streets). Drives the inset map style. */
  basemapId?: string;
}

function statusColor(s: ReviewStatus): string {
  switch (s) {
    case 'approved': return '#5CBF7A';
    case 'edited': return '#E8B84A';
    case 'flagged': return '#E8614F';
    default: return '#3A3A3E';
  }
}

import { displaySignId } from '../lib/displaySignId.ts';

function displayId(inst: SignInstance): string {
  return displaySignId(inst.id);
}

/** Flatten stored sides into a single destination array. */
function flattenDests(sides: SignSide[]): Destination[] {
  return sides.flatMap((s) => s.destinations);
}

/** CSS rotation in degrees for the inset map's directional vector
 *  marker. The marker's default visual baseline is "line points up"
 *  (north), so rotation = `FACING_DEG[facing]` directly:
 *
 *    facing N (compass 0°)   → rotate(  0°)  → line up
 *    facing E (compass 90°)  → rotate( 90°)  → line right
 *    facing S (compass 180°) → rotate(180°)  → line down
 *    facing W (compass 270°) → rotate(270°)  → line left
 *
 *  Undefined facing → 0° (no rotation; the marker also drops the line
 *  in that case so 0 reads as a plain anchor dot, not a misleading
 *  north-pointing vector). */
export function insetVectorRotationDeg(
  facing: FacingDirection | undefined,
): number {
  if (!facing) return 0;
  return FACING_DEG[facing];
}

/** Build the inset map's marker glyph — a top-down view of the sign:
 *  a thin rectangular panel sitting on a short post, with the front
 *  edge of the panel marked. The post's BASE coincides with the
 *  marker's anchor point (the sign's actual lat/lng); the panel
 *  extends in the facing direction.
 *
 *  Why a panel + post and not an arrow: an arrow reads as
 *  "navigation." A real wayfinding sign viewed from above is a flat
 *  panel whose long axis is *perpendicular* to its facing direction
 *  (the panel's surface faces outward — from above you see the
 *  narrow profile from the side). The glyph should match the object
 *  it represents.
 *
 *  Rotation is applied by `marker.setRotation(...)` with
 *  `rotationAlignment: 'map'` (set at the call site), so the glyph
 *  stays fixed in WORLD frame. Combined with the heads-up map
 *  bearing, the panel ends up at the top of the inset and the map's
 *  tiles rotate beneath it when the reviewer cycles the FACING
 *  dial. */
function createInsetVectorMarker(color: string): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'sign-marker-vector';

  // SVG: 24 wide × 18 tall. Bottom-center (12, 18) is the post's
  // BASE — paired with the marker's `anchor: 'bottom'` option, this
  // puts the post base at the sign's lat/lng.
  //
  // Layout (un-rotated, world-N at top):
  //
  //   y=3   ┌──────────┐  ← front edge (light stroke)
  //   y=4   │  panel   │     14 × 4 filled rectangle
  //   y=8   └──────────┘  ← back edge (post connects here)
  //          │  post   │     2-px line, 10 px tall
  //   y=18   •          ← anchor (post base = sign's lat/lng)
  //
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '18');
  svg.setAttribute('viewBox', '0 0 24 18');
  svg.setAttribute('overflow', 'visible');

  // Post — outline first (dark) then foreground (status color).
  // Connects the panel's back-edge midpoint to the anchor.
  const postOutline = document.createElementNS(ns, 'line');
  postOutline.setAttribute('x1', '12');
  postOutline.setAttribute('y1', '18');
  postOutline.setAttribute('x2', '12');
  postOutline.setAttribute('y2', '8');
  postOutline.setAttribute('stroke', 'rgba(0,0,0,0.85)');
  postOutline.setAttribute('stroke-width', '4');
  postOutline.setAttribute('stroke-linecap', 'round');
  svg.appendChild(postOutline);
  const post = document.createElementNS(ns, 'line');
  post.setAttribute('class', 'sign-post');
  post.setAttribute('x1', '12');
  post.setAttribute('y1', '18');
  post.setAttribute('x2', '12');
  post.setAttribute('y2', '8');
  post.setAttribute('stroke', color);
  post.setAttribute('stroke-width', '2');
  post.setAttribute('stroke-linecap', 'round');
  svg.appendChild(post);

  // Panel — outline first (slightly larger dark rectangle around it)
  // for tile-agnostic legibility, then the filled status-coloured
  // rectangle on top.
  const panelOutline = document.createElementNS(ns, 'rect');
  panelOutline.setAttribute('x', '4');
  panelOutline.setAttribute('y', '3');
  panelOutline.setAttribute('width', '16');
  panelOutline.setAttribute('height', '6');
  panelOutline.setAttribute('rx', '0.75');
  panelOutline.setAttribute('fill', 'rgba(0,0,0,0.85)');
  svg.appendChild(panelOutline);
  const panel = document.createElementNS(ns, 'rect');
  panel.setAttribute('class', 'sign-panel');
  panel.setAttribute('x', '5');
  panel.setAttribute('y', '4');
  panel.setAttribute('width', '14');
  panel.setAttribute('height', '4');
  panel.setAttribute('rx', '0.5');
  panel.setAttribute('fill', color);
  svg.appendChild(panel);

  // Front-edge indicator — a brighter stroke along the long edge
  // furthest from the post. Reads as "the panel face that pedestrians
  // approach" so a reviewer can tell front from back at a glance.
  const frontEdge = document.createElementNS(ns, 'line');
  frontEdge.setAttribute('class', 'sign-panel-front');
  frontEdge.setAttribute('x1', '5.5');
  frontEdge.setAttribute('y1', '4');
  frontEdge.setAttribute('x2', '18.5');
  frontEdge.setAttribute('y2', '4');
  frontEdge.setAttribute('stroke', '#ffffff');
  frontEdge.setAttribute('stroke-width', '1.5');
  frontEdge.setAttribute('stroke-linecap', 'round');
  svg.appendChild(frontEdge);

  wrap.appendChild(svg);
  return wrap;
}

export function SignCard({
  instance,
  signType,
  allInstances,
  signTypes,
  onNext,
  onPrev,
  canNext,
  canPrev,
  index,
  total,
  allFiltered,
  onGoTo,
  reviewerName,
  onRequireReviewer,
  onDeleteInstance,
  destinations = [],
  onEnsureDestinationPlaces,
  onRegenerateOneSign,
  isDark = true,
  basemapId,
}: Props) {
  // Phase 5: per-sign-type capacity. `policy.capacityPerSide` replaces
  // the old project-wide `topNPerSide` knob. The capacity rendered
  // above is what the bulk generator actually applied for *this*
  // sign — Map (M), Primary (PM), Secondary (SD), and Nudge (N)
  // each carry their own cap and walk-distance filter via
  // DEFAULTS_BY_CODE, with optional per-type overrides on the
  // SignType record itself.
  const policy = policyForSignType(signType);
  const capacityPerSide = policy.capacityPerSide;
  const [editing, setEditing] = useState(false);
  const [editDests, setEditDests] = useState<Destination[]>([]);
  const [editNotes, setEditNotes] = useState('');
  const [editFacing, setEditFacing] = useState<FacingDirection | undefined>();
  // Phase 5d v2: nearby signs now live in the NeighborhoodPanel below
  // the destinations table (with their own mini-map). The inset map's
  // em-dash nearby-highlight glyphs were a 5d device for showing
  // neighbours on the focal map; with the new panel they're redundant
  // and have been removed. The hover state below stays for the
  // destinations-row → inset-marker hover affordance.
  const [hoveredDest, setHoveredDest] = useState<string | null>(null);

  // Track destination dot markers for highlight/pulse
  const destMarkersRef = useRef<Map<string, any>>(new Map());
  // Track destination label markers (HTML overlays carrying the
  // CSV's canonical destination names). Held so they can be cleared
  // before re-drawing on every style.load (theme swap) or data
  // change.
  const destLabelMarkersRef = useRef<unknown[]>([]);
  // Inset map's directional-vector marker. Held as a maplibregl
  // Marker (not just the DOM element) so the live-rotation effect
  // can call setRotation() — which combines correctly with the
  // map's heads-up bearing because the marker uses
  // rotationAlignment: 'map'. Recreating the maplibre map on every
  // dial click would flicker tiles, so the map effect's dep list
  // intentionally omits `instance.facing`; this ref bridges the gap.
  const insetMarkerRef = useRef<{
    setRotation: (deg: number) => void;
  } | null>(null);

  // Direction lock — persisted on the SignInstance model. Defaults to
  // unlocked; a sign is only locked when an editor has explicitly
  // clicked the padlock toggle, which writes `directionLocked: true`
  // via updateInstance. Previously fell back to `!!instance.facing`,
  // which evaluated true on every seeded sign (they all carry a
  // facing) and silently disabled the dial in view mode.
  const facingLocked = instance.directionLocked ?? false;

  // Direction-lock toggle gate. Anyone with the `instance.edit`
  // capability sees the padlock as a clickable button; anyone else
  // sees a static span (when locked) or nothing (when unlocked).
  // Demo mode hardcodes everyone to 'owner' until real auth lands —
  // see `code/platform/src/auth/permissions.ts` for the role
  // capability table. The previous in-place mutation in
  // `lib/instances.ts` made this look broken (clicks persisted, but
  // React's identity-bail-out skipped the re-render); fixed in
  // `notify()` so the toggle reflects in the UI on click.
  const currentRole: ProjectRole = 'owner';
  const canToggleLock = roleCan(currentRole, 'instance.edit');

  const mapRef = useRef<HTMLDivElement>(null);
  const mlMapRef = useRef<any>(null);

  // Current facing (live from instance, or from edit state)
  const facing = editing ? editFacing : instance.facing;

  // Dynamic split: flatten stored sides → splitSides based on facing
  const allDests = useMemo(() => flattenDests(instance.sides), [instance.sides]);
  const activeDests = editing ? editDests : allDests;

  const [sideA, sideB] = useMemo(
    () => splitSides(activeDests, facing),
    [activeDests, facing],
  );

  // ── MapLibre GL map ──────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !instance.lat || !instance.lng) return;
    const maplibregl = (window as any).maplibregl;
    if (!maplibregl) return;

    if (mlMapRef.current) {
      mlMapRef.current.remove();
      mlMapRef.current = null;
    }

    // Tile style URL is centralised in `lib/mapStyle.ts` so this
    // map and MapOverview agree on the dark/light variants. Theme
    // changes hot-swap via `map.setStyle` in the sibling effect
    // below — no need to rebuild the map (or include `isDark` in
    // this effect's dep list) on a theme toggle.
    const styleUrl = getMapStyleUrl(basemapId, { isDark });

    // Heads-up rotation: the inset map's bearing rotates so the sign's
    // facing direction is at the top of the screen. MapLibre's bearing
    // convention: a bearing of N° puts the compass direction N° at
    // screen-up (e.g., bearing=90 → east is up). So bearing
    // matches FACING_DEG[facing] directly. Initial bearing is set
    // here; subsequent facing changes ease via the sibling effect
    // below.
    const initialBearing = insetVectorRotationDeg(instance.facing);
    const map = new maplibregl.Map({
      container: mapRef.current,
      style: styleUrl,
      center: [instance.lng, instance.lat],
      zoom: 16,
      bearing: initialBearing,
      attributionControl: false,
      // dragRotate is off so the user can't bump bearing manually —
      // it's our heads-up axis, not a freely-pannable viewport.
      // Programmatic easeTo() still works regardless.
      dragRotate: false,
      pitchWithRotate: false,
    });

    // Phase 5c follow-up: layer setup is split out from marker
    // creation so it can run on every `style.load` (initial + every
    // setStyle from the theme-swap effect below). HTML markers
    // survive setStyle, so they're created once on the initial
    // 'load' instead.
    const applyMapLayers = () => {
      // Silence MapTiler/OSM POI / building / place / transit labels —
      // their naming convention diverges from the project's CSV so
      // they create false-positive "the building is in the wrong
      // place" confusion. Roads and street labels stay visible for
      // navigation context. (See `lib/mapLabels.ts` for the
      // pattern table.)
      hideOsmLabels(map);

      // Render labels for the focal sign's destinations at their
      // canonical CSV lat/lng. Clear the previous batch first so
      // re-running on style.load doesn't stack duplicates.
      clearDestinationLabels(destLabelMarkersRef.current);
      destLabelMarkersRef.current = drawDestinationLabels(
        map,
        allDests,
        destinations,
      );

      // Re-add the dashed leader lines from the focal sign to its
      // destinations. setStyle wipes layers/sources, so this runs on
      // every style.load (initial + theme swap).
      //
      // Architectural invariant (Phase 5c): line endpoints are the
      // CANONICAL DestinationPlace.lat/lng — no 45° snapping, no
      // arrow-derived geometry. The 45° snap in `dest.arrow` exists
      // because physical signs have 8 arrow positions, NOT because
      // the map's geometry is constrained. Both leader lines and
      // destination labels read from DestinationPlace.lat/lng + name
      // (see `lib/destinationLinks.ts` and `lib/mapLabels.ts`).
      drawInsetLeaderLines(map, instance, destinations, isDark);
    };

    // We need applyMapLayers to run when the map's style is ready. We
    // listen for 'style.load' (which re-fires on every setStyle for
    // theme swaps) AND call it explicitly inside 'load' (the first-time
    // ready event that ALWAYS fires, even if maplibre's initial style
    // load took a retry / "rebuild from scratch" path that suppressed
    // 'style.load'). Both paths are idempotent: clearDestinationLabels
    // / safeRemove inside the helpers wipe any prior state before
    // re-adding.
    map.on('style.load', applyMapLayers);

    map.once('load', () => {
      // Initial-load belt-and-braces: run applyMapLayers here too in
      // case 'style.load' got swallowed by a retry. See block comment
      // above the `map.on('style.load', ...)` registration.
      applyMapLayers();

      // Inset map: the focal sign renders as a directional line —
      // base at the sign's lat/lng, line extending in the facing
      // direction. The dashboard map (MapOverview) keeps plain dots
      // because 118 vectors at campus zoom is clutter; on the inset
      // there's only the focal sign so orientation context is useful.
      //
      // Marker is anchored at its BOTTOM-CENTER so the line BASE
      // coincides with the sign's lat/lng. `rotationAlignment: 'map'`
      // means the marker rotates with the map's bearing — combined
      // with `setRotation(facingDeg)` (in MAP frame), the line ends up
      // pointing in the facing direction in WORLD coordinates. With
      // the heads-up bearing also = facingDeg, the line lands at
      // screen-up. The `insetMarkerRef` lets the live-rotation effect
      // call setRotation() on dial clicks without a map rebuild.
      const signEl = createInsetVectorMarker(
        statusColor(instance.reviewStatus),
      );
      const insetMarker = new maplibregl.Marker({
        element: signEl,
        anchor: 'bottom',
        rotationAlignment: 'map',
        rotation: insetVectorRotationDeg(instance.facing),
      })
        .setLngLat([instance.lng, instance.lat])
        .addTo(map);
      insetMarkerRef.current = insetMarker;

      // Clear previous marker refs.
      destMarkersRef.current.clear();

      // Destination dot markers — HTML overlays, survive setStyle.
      // Same canonical-first resolution as the link-layer block above
      // (see invariant note there). Build the lookup once for this
      // batch.
      const dotLookup = buildDestinationLookup(destinations);
      for (const dest of allDests) {
        if (dest.arrow == null) continue;
        const dp = dotLookup.resolve(dest);
        let markerLat: number;
        let markerLng: number;
        if (dp) {
          markerLat = dp.lat;
          markerLng = dp.lng;
        } else {
          const [estLat, estLng] = estimateDestPos(
            instance.lat!,
            instance.lng!,
            dest.arrow,
            dest.walkTime,
          );
          markerLat = estLat;
          markerLng = estLng;
        }

        const dotEl = document.createElement('div');
        dotEl.className = 'dest-marker-dot';
        Object.assign(dotEl.style, {
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: '#748791',
          opacity: '.7',
          // Scope transitions to the visual properties the hover effect
          // changes — NEVER `all`. MapLibre repositions HTML markers by
          // writing `transform` every frame during fitBounds / zoom
          // animations, and `transition: all` would smoothly interpolate
          // each frame's transform over .2s — which reads as the dots
          // lagging behind the camera during zoom.
          transition:
            'width .2s ease, height .2s ease, background .2s ease, opacity .2s ease, box-shadow .2s ease',
        });
        const marker = new maplibregl.Marker({ element: dotEl, anchor: 'center' })
          .setLngLat([markerLng, markerLat])
          .addTo(map);

        // Store reference for hover highlighting. We also stash the
        // destinationPlaceId (when known) so the hover effect can
        // address the matching `.destination-label[data-dest-id]`.
        if (dest.name) {
          const destName = dest.name;
          destMarkersRef.current.set(destName, {
            marker,
            el: dotEl,
            lng: markerLng,
            lat: markerLat,
            destId: dp?.id,
          });
          // Hover on the dot reveals the matching .destination-label.
          // Default is hidden to avoid the all-names-overlap problem
          // on dense campuses; hover (or row-hover from the
          // destinations table) brings it in only when needed.
          dotEl.addEventListener('mouseenter', () => setHoveredDest(destName));
          dotEl.addEventListener('mouseleave', () => setHoveredDest(null));
        }
      }

      // Phase 5c follow-up: auto-fit the inset to bound the focal
      // sign + every linked destination. Map signs (anchors campus-
      // wide) used to leave their destinations off-screen; this
      // ensures the dashed lines + dots are all visible on initial
      // render. The reviewer can pan/zoom freely afterwards; the
      // corner Focus button re-runs the same fit on demand.
      handleFocusRef.current();
    });

    mlMapRef.current = map;

    return () => {
      // Drop any label markers attached to this map instance — they
      // were tracked by ref so the next inset (different sign) can
      // start fresh.
      clearDestinationLabels(destLabelMarkersRef.current);
      destLabelMarkersRef.current = [];
      map.remove();
      mlMapRef.current = null;
    };
  }, [instance.id, instance.lat, instance.lng, allDests, destinations]);

  // Phase 5c follow-up: hot-swap inset tile style on theme change.
  // The map effect above intentionally omits `isDark` from its dep
  // list — recreating the maplibre map every theme toggle would
  // re-fetch tiles and re-create the focal-sign marker, the dest
  // dot markers, and the dashed link layers from scratch. Instead
  // `setStyle` swaps just the tiles + style.json; the marker DOM
  // overlays survive (HTML), and `applyMapLayers` re-runs via the
  // `style.load` listener registered in the map effect.
  useEffect(() => {
    mlMapRef.current?.setStyle(getMapStyleUrl(basemapId, { isDark }));
  }, [isDark, basemapId]);

  // Inset map heads-up + line rotation — fires on facing dial click.
  // The map effect above intentionally omits `instance.facing` from
  // its dep list (rebuilding the maplibre map on every click would
  // flicker the tiles); this effect handles the two changes that
  // SHOULD happen per click:
  //
  //   1. Marker line: `setRotation(facingDeg)` — instant snap in
  //      MAP frame (the line's world heading updates immediately).
  //   2. Map bearing: `easeTo(bearing: facingDeg, duration: 300)` —
  //      smooth 300ms transition so the heads-up axis pivots
  //      gracefully rather than jolting.
  //
  // Combined with `rotationAlignment: 'map'` on the marker, the line
  // visually settles at screen-up after the bearing ease completes.
  useEffect(() => {
    const deg = insetVectorRotationDeg(instance.facing);
    insetMarkerRef.current?.setRotation(deg);
    mlMapRef.current?.easeTo({ bearing: deg, duration: 300 });
  }, [instance.facing]);

  // React to hovered destination — highlight the matching marker on
  // the mini-map AND reveal the matching `.destination-label`. The
  // labels are hidden by default (CSS) to avoid overlap on dense
  // campuses; this effect is the single source of truth for which one
  // is currently shown.
  useEffect(() => {
    let activeDestId: string | undefined;
    for (const [name, entry] of destMarkersRef.current.entries()) {
      const isHovered = name === hoveredDest;
      if (isHovered) activeDestId = entry.destId;
      Object.assign(entry.el.style, {
        width: isHovered ? '14px' : '6px',
        height: isHovered ? '14px' : '6px',
        // Hovered → SOSISU Sky (var(--product-bright)) accent; idle →
        // SOSISU Signal-mid neutral. Browsers resolve var() in inline
        // style assignments, so the brand-token swap stays centralised.
        background: isHovered ? 'var(--product-bright)' : 'var(--product-accent)',
        opacity: isHovered ? '1' : '.7',
        // Sky-tinted glow at 60% — same accent as the dot's background.
        boxShadow: isHovered
          ? '0 0 8px 3px color-mix(in srgb, var(--product-bright) 60%, transparent)'
          : 'none',
      });
    }
    // Toggle `.is-visible` on every dest label, then on the active one.
    // Walk via querySelectorAll because the labels are HTML maplibregl
    // markers — no React tree to refer to.
    const labels = document.querySelectorAll('.destination-label');
    for (const label of labels) {
      const id = (label as HTMLElement).dataset.destId;
      label.classList.toggle('is-visible', !!activeDestId && id === activeDestId);
    }
  }, [hoveredDest]);

  // Phase 5c follow-up: focus button handler. Re-fits the inset to
  // bound the focal sign + every linked destination, with heads-up
  // bearing preserved. Wired to the corner button on the inset and
  // to the initial-load auto-fit (via `handleFocusRef`) so they
  // share a single code path.
  //
  // The pre-Phase-5c name-click handler that flew the map to a
  // single destination on row click is intentionally gone — the
  // bounce was disorienting when scanning the messaging list.
  // Hover-highlight (via destMarkersRef + hoveredDest) still works.
  const handleFocus = useCallback(() => {
    const map = mlMapRef.current;
    if (!map || instance.lat == null || instance.lng == null) return;
    const bounds = computeInsetBounds(
      { lat: instance.lat, lng: instance.lng },
      flattenDests(instance.sides),
      destinations,
    );
    map.fitBounds(bounds, {
      padding: 60,
      maxZoom: 17,
      bearing: insetVectorRotationDeg(instance.facing),
      duration: 500,
    });
  }, [instance, destinations]);
  // Captured in a ref so the map effect's `load` callback can call
  // the latest version without re-running the effect on every
  // closure-capture change.
  const handleFocusRef = useRef(handleFocus);
  handleFocusRef.current = handleFocus;

  // Reset editing when instance changes
  useEffect(() => { setEditing(false); }, [instance.id]);

  // ── Reviewer gate ────────────────────────────────────────────────
  const requireReviewer = useCallback(async (): Promise<string | null> => {
    if (reviewerName) return reviewerName;
    return onRequireReviewer();
  }, [reviewerName, onRequireReviewer]);

  // ── Actions ──────────────────────────────────────────────────────
  const handleApprove = useCallback(async () => {
    const name = await requireReviewer();
    if (!name) return;
    updateInstance(instance.id, { reviewStatus: 'approved', reviewedBy: name });
    logActivity({ signId: instance.id, action: 'approved', reviewer: name });
  }, [instance.id, requireReviewer]);

  const handleFlag = useCallback(async () => {
    const name = await requireReviewer();
    if (!name) return;
    updateInstance(instance.id, { reviewStatus: 'flagged', reviewedBy: name });
    logActivity({ signId: instance.id, action: 'flagged', reviewer: name });
  }, [instance.id, requireReviewer]);

  const startEdit = useCallback(() => {
    setEditDests(allDests.map((d) => ({ ...d })));
    setEditNotes(instance.notes ?? '');
    setEditFacing(instance.facing);
    setEditing(true);
  }, [instance, allDests]);

  // ── Live regen on facing-dial change ─────────────────────────────────
  // When the reviewer cycles the facing dial in edit mode, re-run the
  // bulk generator for this single sign so the destination list
  // reflects the new orientation. Manual rows in `editDests` survive
  // because we hand them through as a synthetic side and the
  // generator runs in `replace-auto` mode.
  //
  // Debounced 300 ms — rapidly cycling N → NE → E → SE shouldn't fire
  // four regenerations.
  const instanceRef = useRef(instance);
  instanceRef.current = instance;
  const editDestsRef = useRef<Destination[]>(editDests);
  editDestsRef.current = editDests;
  useEffect(() => {
    if (!editing) return;
    if (!onRegenerateOneSign) return;
    if (!editFacing) return;
    // Don't fire on the initial setEditFacing(instance.facing) inside
    // startEdit — only when the dial actually moves.
    if (editFacing === instance.facing) return;

    const timer = setTimeout(() => {
      // Pass a synthetic instance whose sides carry the in-flight
      // editDests, not the persisted sides — so unsaved manual edits
      // survive the regen. The generator's `replace-auto` mode drops
      // the auto rows from this synthetic side and appends fresh ones
      // for the new facing.
      const synthetic: SignInstance = {
        ...instanceRef.current,
        facing: editFacing,
        sides: [
          { label: 'FRONT', destinations: editDestsRef.current },
          { label: 'BACK', destinations: [] },
        ],
      };
      const regen = onRegenerateOneSign(synthetic, editFacing);
      setEditDests(flattenDests(regen.sides));
    }, 300);
    return () => clearTimeout(timer);
  }, [editFacing, editing, instance.facing, onRegenerateOneSign]);

  const cancelEdit = useCallback(() => { setEditing(false); }, []);

  const saveEdit = useCallback(async () => {
    const name = await requireReviewer();
    if (!name) return;

    // B4 — ensure a DestinationPlace exists for every typed-but-unlinked
    // destination so it routes through to Surface (and dedups by name).
    // Stub coords come from the sign's own location; the reviewer refines
    // them later from Building Names. No-ops if the host didn't wire the
    // callback or the sign has no coords yet.
    const linkByName = new Map<string, string>();
    if (onEnsureDestinationPlaces && instance.lat != null && instance.lng != null) {
      const unlinked = [
        ...new Set(
          editDests
            .filter((d) => d.name.trim() && !d.destinationPlaceId)
            .map((d) => d.name.trim()),
        ),
      ];
      if (unlinked.length > 0) {
        const places = await onEnsureDestinationPlaces(unlinked, {
          lat: instance.lat,
          lng: instance.lng,
        });
        unlinked.forEach((n, i) => {
          if (places[i]) linkByName.set(n.toLowerCase(), places[i].id);
        });
      }
    }
    const linkId = (d: Destination): string | undefined =>
      d.destinationPlaceId ?? linkByName.get(d.name.trim().toLowerCase());

    // Re-split using the current edit facing, then save as two sides
    const [front, back] = splitSides(editDests, editFacing);
    const mapRow = (d: Destination) => {
      const pid = linkId(d);
      return {
        arrow: d.arrow,
        name: d.name,
        walkTime: d.walkTime,
        ...(pid && { destinationPlaceId: pid }),
      };
    };
    const newSides: SignSide[] = [
      {
        label: `${front.label} · ${front.compass}`,
        destinations: front.destinations.map(mapRow),
      },
      {
        label: `${back.label} · ${back.compass}`,
        destinations: back.destinations.map(mapRow),
      },
    ];
    updateInstance(instance.id, {
      sides: newSides,
      notes: editNotes,
      facing: editFacing,
      reviewStatus: 'edited',
      reviewedBy: name,
    });
    logActivity({ signId: instance.id, action: 'edited', reviewer: name });
    setEditing(false);
  }, [instance.id, instance.lat, instance.lng, editDests, editNotes, editFacing, requireReviewer, onEnsureDestinationPlaces]);

  // ── Edit helpers (flat array) ────────────────────────────────────
  // Any user-initiated field edit clears the row's `auto` flag — the
  // next bulk regeneration shouldn't clobber a row the reviewer
  // touched. The flag is removed entirely (rather than set to false)
  // so the persisted shape stays minimal.
  function clearAutoFlag(row: Destination): Destination {
    if (row.auto !== true) return row;
    const { auto: _dropped, ...rest } = row;
    return rest;
  }

  function updateDest(idx: number, field: keyof Destination, value: any) {
    setEditDests((prev) => {
      const next = prev.map((d) => ({ ...d }));
      (next[idx] as any)[field] = value;
      next[idx] = clearAutoFlag(next[idx]!);
      return next;
    });
  }

  /** Merge a partial update into a row. Used by DestinationPicker which
   *  may change name and destinationPlaceId atomically (linking or
   *  breaking a link should be one state update, not two). */
  function updateDestFields(idx: number, fields: Partial<Destination>) {
    setEditDests((prev) => {
      const next = prev.map((d) => ({ ...d }));
      const row = { ...next[idx]!, ...fields };
      // Clean up explicit undefineds so the persisted doc doesn't carry
      // noisy fields — Firestore treats `undefined` as delete on setDoc
      // with merge but sometimes we want the key removed entirely.
      if (fields.destinationPlaceId === undefined) {
        delete (row as { destinationPlaceId?: string }).destinationPlaceId;
      }
      next[idx] = clearAutoFlag(row);
      return next;
    });
  }

  function removeDest(idx: number) {
    setEditDests((prev) => prev.filter((_, i) => i !== idx));
  }

  function addDest() {
    // New rows start manual — Phase 4 reserves `auto: true` for the
    // bulk generator's output, and any reviewer-initiated row should
    // survive subsequent regenerations.
    setEditDests((prev) => [...prev, { arrow: null, name: '', walkTime: '', auto: false }]);
  }

  // Phase 3's `appendDest` (a fully-formed-row append used by the inline
  // suggestions panel) is no longer wired now that the panel is gone.
  // Phase 4 bulk regeneration writes directly via the schedule
  // generator, so SignCard's edit mode only needs the per-field
  // helpers above.

  // Map destinationPlaceId → DestinationPlace for display-mode name
  // resolution (linked rows show the live name from the record, which
  // may have been renamed since the sign was last edited).
  const destPlaceMap = useMemo(() => {
    const m = new Map<string, DestinationPlace>();
    for (const d of destinations) m.set(d.id, d);
    return m;
  }, [destinations]);

  // Stage 0.3 Commit 2 — short-name decision now composes through
  // canonical `resolveUseShortName(signType, codeDefault)`. Resolution
  // precedence (override → per-code → width-derived):
  //   1. signType.useShortName  — explicit per-type override (rare)
  //   2. policy.useShortName    — per-code policy from
  //      DEFAULTS_BY_CODE (authoritative; e.g. SD always opts in
  //      regardless of physical width)
  //   3. width < 600mm          — fallback for custom codes lacking a
  //      DEFAULTS_BY_CODE entry
  // signType is defined when a sign card is rendered for an instance;
  // the false fallback covers the brief render window where it isn't.
  const useShortNameEffective = signType
    ? resolveUseShortName(signType, policy.useShortName)
    : policy.useShortName;

  const resolvedName = useCallback(
    (row: { name: string; destinationPlaceId?: string }): string => {
      // Phase 5b + Stage 0.3: when the resolved short-name flag is
      // true, prefer the linked DestinationPlace's `shortName`. Falls
      // back to `name` when shortName is unset (or whitespace-only)
      // so EGD edges always have *some* string to show. Manual rows
      // without a destinationPlaceId can't have a shortName, so they
      // always render their stored name.
      if (row.destinationPlaceId) {
        const live = destPlaceMap.get(row.destinationPlaceId);
        if (live) {
          if (
            useShortNameEffective &&
            live.shortName &&
            live.shortName.trim() !== ''
          ) {
            return live.shortName;
          }
          return live.name;
        }
      }
      return row.name;
    },
    [destPlaceMap, useShortNameEffective],
  );

  const status = instance.reviewStatus;
  const dispId = displayId(instance);

  // ── Render helpers ───────────────────────────────────────────────
  const renderSide = (side: SplitSide, sideIdx: number) => (
    <div key={sideIdx} className="side-panel">
      <div className="side-header">
        <span className="side-label">
          Side {String.fromCharCode(65 + sideIdx)}
        </span>
        <span className="side-sublabel">
          {side.label} {side.compass !== side.label ? `· ${side.compass}` : ''}
        </span>
      </div>
      <table className="dest-table">
        <thead>
          <tr>
            <th className="arrow-col">Arrow</th>
            <th>Destination</th>
            <th style={{ width: 90 }}>Walk</th>
          </tr>
        </thead>
        <tbody>
          {side.destinations.map((dest, i) => {
            const displayName = resolvedName(dest);
            const linked = !!dest.destinationPlaceId;
            const isManual = dest.auto !== true;
            return (
              <tr
                key={i}
                className={[
                  displayName && hoveredDest === displayName
                    ? 'dest-row-highlight'
                    : '',
                  isManual ? 'dest-row-manual' : 'dest-row-auto',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onMouseEnter={() => displayName && setHoveredDest(displayName)}
                onMouseLeave={() => setHoveredDest(null)}
              >
                <td>
                  <ArrowDisplay deg={dest.displayArrow} clamped={dest.clamped} />
                </td>
                <td className={`dest-name-cell${displayName ? '' : ' empty'}`}>
                  {isManual && (
                    <span
                      className="dest-manual-mark"
                      title="Manually edited"
                    >
                      {'✎'}
                    </span>
                  )}
                  {linked && (
                    <span
                      className="dest-link-pin"
                      title="Linked to destinations database"
                    >
                      {'\u25C9'}
                    </span>
                  )}
                  {displayName || '\u2014'}
                </td>
                <td>
                  {dest.walkTime && <span className="ttd-chip">{dest.walkTime}</span>}
                </td>
              </tr>
            );
          })}
          {side.destinations.length === 0 && (
            <tr>
              <td colSpan={3} style={{ padding: '1.5rem', color: 'var(--sosisu-border)', fontStyle: 'italic', fontSize: 14 }}>
                No destinations
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const renderEditTable = () => (
    <div className="side-panel" style={{ gridColumn: '1 / -1' }}>
      <div className="side-header">
        <span className="side-label">All Destinations</span>
        <span className="side-sublabel">
          Split preview: {sideA.destinations.length} front / {sideB.destinations.length} back
        </span>
      </div>
      <table className="dest-table">
        <thead>
          <tr>
            <th className="arrow-col">Arrow</th>
            <th>Destination</th>
            <th style={{ width: 90 }}>Walk</th>
            <th style={{ width: 36 }} />
          </tr>
        </thead>
        <tbody>
          {editDests.map((dest, idx) => (
            <tr key={idx}>
              <td>
                <ArrowPicker
                  value={dest.arrow}
                  onChange={(deg) => updateDest(idx, 'arrow', deg)}
                  facing={editFacing}
                />
              </td>
              <td>
                <DestinationPicker
                  value={dest.name}
                  {...(dest.destinationPlaceId && {
                    destinationPlaceId: dest.destinationPlaceId,
                  })}
                  destinations={destinations}
                  onChange={(next) => updateDestFields(idx, next)}
                />
              </td>
              <td>
                <input
                  className="edit-input ttd-input"
                  value={dest.walkTime ?? ''}
                  onChange={(e) => updateDest(idx, 'walkTime', e.target.value)}
                  placeholder="~2 min"
                />
              </td>
              <td>
                <button className="remove-btn" onClick={() => removeDest(idx)}>
                  {'×'}
                </button>
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={4} style={{ padding: '10px 1.5rem' }}>
              <button className="add-dest-btn" onClick={addDest}>
                + add destination
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      {/*
        Phase 4 removed the inline `<DestinationSuggestions />` panel —
        bulk auto-population from the Project Dashboard supersedes it.
        The component file stays for possible reuse as an "explain this
        row" affordance later. `appendDest` likewise stays because the
        Phase 4 generator's flat-row shape lines up with what
        `appendDest` accepts; some consumer may want it again.
      */}
    </div>
  );

  // ── Phase 5d v2: neighborhood analysis ────────────────────────────
  // Pure overlap analysis — replaces the Phase 5d conflict-detection
  // model. `analyzeNeighborhood` returns nearby signs (within 500 m,
  // sorted by distance) and shared destinations (with their covering
  // neighbours). No conflict / redundant categorisation.
  const neighborhoodAnalysis = useMemo(
    () =>
      analyzeNeighborhood({
        current: instance,
        allSigns: allInstances,
        destinations,
      }),
    [instance, allInstances, destinations],
  );

  return (
    <>
      {/* Navigation bar */}
      <div className="sign-nav">
        <button className="nav-arrow" disabled={!canPrev} onClick={onPrev}>{'←'}</button>
        <span className="nav-counter">{index + 1} of {total}</span>
        <div className="nav-dots">
          {total <= 100
            ? allFiltered.map((inst) => (
                <div
                  key={inst.id}
                  className={`nav-dot${inst.id === instance.id ? ' current' : ''}`}
                  style={{ background: statusColor(inst.reviewStatus) }}
                  onClick={() => onGoTo(inst.id)}
                  title={inst.location}
                />
              ))
            : (
                <span style={{ fontSize: 12, color: 'var(--sosisu-text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {total} signs
                </span>
              )}
        </div>
        <button className="nav-arrow" disabled={!canNext} onClick={onNext}>{'→'}</button>
      </div>

      {/* Status banner */}
      {status !== 'pending' && (
        <div
          className={`status-banner banner-${status}`}
          style={{ borderRadius: '10px 10px 0 0', marginBottom: -1 }}
        >
          {status === 'approved' ? 'Approved'
            : status === 'edited' ? 'Edited \u2014 awaiting SIGNALS review'
            : 'Flagged for discussion'}
        </div>
      )}

      {/* Card */}
      <div className="sign-card" style={status !== 'pending' ? { borderTopLeftRadius: 0, borderTopRightRadius: 0 } : undefined}>
        {/* Header: info + map */}
        <div className="sign-card-header">
          <div className="sign-card-header-left">
            <div className="sign-card-top">
              <div className="sign-card-id">{dispId}</div>
              {signType && (
                <div className="sign-type-icon">
                  <CategoryIcon category={signType.category} size={28} />
                </div>
              )}
            </div>
            <div className="sign-card-type" style={signType ? { color: CATEGORY_META[signType.category]?.color } : undefined}>
              {signType?.name || signType?.category || ''}
            </div>
            {instance.neighborhood && (
              <div className="sign-card-name">{instance.neighborhood}</div>
            )}
            {instance.lat && instance.lng && (
              <div className="sign-card-dims">
                {instance.lat.toFixed(5)}, {instance.lng.toFixed(5)}
              </div>
            )}

            {/* Facing direction picker — always interactive, with lock */}
            <div className="facing-section">
              <div className="facing-label">Facing</div>
              <div className="facing-picker">
                <div className="facing-compass" title={`Facing ${facing || '\u2014'}`}>
                  <Compass facing={facing} size={24} />
                </div>
                {FACING_DIRS.map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    className={`facing-btn${facing === dir ? ' active' : ''}`}
                    disabled={!editing && facingLocked}
                    onClick={() => {
                      if (editing) {
                        setEditFacing(dir);
                      } else {
                        updateInstance(instance.id, { facing: dir });
                      }
                    }}
                  >
                    {dir}
                  </button>
                ))}
                {canToggleLock ? (
                  <button
                    type="button"
                    className={`facing-lock-btn${facingLocked ? ' locked' : ''}`}
                    title={facingLocked ? 'Unlock facing direction' : 'Lock facing direction'}
                    onClick={() => {
                      updateInstance(instance.id, { directionLocked: !facingLocked });
                    }}
                  >
                    {facingLocked ? '\u{1F512}' : '\u{1F513}'}
                  </button>
                ) : facingLocked ? (
                  <span
                    className="facing-lock-btn locked"
                    title="Direction locked by admin"
                    style={{ cursor: 'default' }}
                  >
                    {'\u{1F512}'}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <div className="sign-card-map-wrap">
            <div
              ref={mapRef}
              className="sign-card-map"
              style={instance.lat && instance.lng ? { minHeight: 200 } : undefined}
            >
              {(!instance.lat || !instance.lng) && (
                <span style={{ color: 'var(--sosisu-border)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                  No coordinates
                </span>
              )}
            </div>
            {instance.lat && instance.lng && (
              <>
                <button
                  type="button"
                  className="map-focus-btn"
                  onClick={handleFocus}
                  title="Recenter on this sign"
                  aria-label="Recenter inset on this sign"
                >
                  {/* Inline SVG crosshair — avoids a new icon
                      dependency. Stroke uses currentColor so theme
                      tokens drive the colour. */}
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
                  </svg>
                </button>
                {/* Phase 5d v2: the standalone "Nearby" toggle is gone.
                    Neighborhood lives in its own section below the
                    destinations table — see <NeighborhoodPanel/>. */}
              </>
            )}
          </div>
        </div>

        {/* Diagnostic counter — surfaces accumulation bugs and bad
            policy dispatch directly in the reviewer's view.
            `splitSides()` may legitimately put a perpendicular row on
            both sides (~ +1 to each side), and the bulk generator
            caps at `policy.capacityPerSide` per face, so the safe
            upper bound is roughly 2× cap. We render in red beyond
            that. The cap and walk-distance filter are derived from
            this sign's type code via DEFAULTS_BY_CODE, with optional
            per-type overrides on the SignType record itself. */}
        {!editing && (() => {
          const sideACount = sideA.destinations.length;
          const sideBCount = sideB.destinations.length;
          const overThreshold = capacityPerSide * 2;
          const sideABad = sideACount > overThreshold;
          const sideBBad = sideBCount > overThreshold;
          // Suffix shows policy label, anchors-only flag, and walk-
          // minute cap. The walk-minute hint surfaces *why* a sign
          // might end up under-capacity (e.g. SD with 8 min cap and
          // no nearby destinations).
          const labelPart = policy.label ? ` · ${policy.label}` : '';
          const anchorPart = policy.anchorsOnly ? ' (anchors only)' : '';
          const walkPart =
            policy.maxWalkMinutes !== undefined
              ? ` · ≤${policy.maxWalkMinutes} min walk`
              : '';
          const suffix = `${labelPart}${anchorPart}${walkPart}`;
          return (
            <div
              className="dest-side-counts"
              title={`Cap: ${capacityPerSide} per side${suffix}`}
            >
              <span>Side A:</span>{' '}
              <span className={sideABad ? 'count-bad' : ''}>
                {sideACount} rows
              </span>
              {' · '}
              <span>Side B:</span>{' '}
              <span className={sideBBad ? 'count-bad' : ''}>
                {sideBCount} rows
              </span>
              <span className="count-cap">
                {' '}
                (cap: {capacityPerSide} per side{suffix})
              </span>
            </div>
          );
        })()}

        {/* Destination tables */}
        <div className={`sides-container${!editing ? ' two-sided' : ''}`}>
          {editing ? renderEditTable() : (
            <>
              {renderSide(sideA, 0)}
              {renderSide(sideB, 1)}
            </>
          )}
        </div>
        {!editing && (
          <div className="dest-legend" title="Auto vs manual indicator">
            <span className="dest-manual-mark">{'✎'}</span>
            <span> = manually edited · all others auto-generated</span>
          </div>
        )}

        {/* Notes */}
        {editing ? (
          <div className="notes-area">
            <div className="notes-label">Notes for SIGNALS</div>
            <textarea
              rows={2}
              placeholder="Any comments about this sign..."
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
            />
          </div>
        ) : instance.notes ? (
          <div className="notes-area">
            <div className="notes-label">Notes</div>
            <div className="notes-display">{instance.notes}</div>
          </div>
        ) : null}

        {/* Phase 5d v2: Neighborhood section lives INSIDE the SignCard
            below the destinations table. Replaces the right-rail-style
            NearbyPanel sibling. Overlap is the positive signal — chips
            celebrate destinations shared with nearby signs, the mini-
            map plots the spatial picture, and the nearby-signs list
            recenters the map without switching the SignCard view. */}
        <NeighborhoodPanel
          current={instance}
          analysis={neighborhoodAnalysis}
          signTypes={signTypes}
          destinations={destinations}
          isDark={isDark}
          basemapId={basemapId}
        />
      </div>

      {/* Action buttons */}
      <div className="actions">
        {!editing ? (
          <>
            <button className="action-btn btn-approve" onClick={handleApprove}>Approve</button>
            <button className="action-btn btn-edit" onClick={startEdit}>Edit destinations</button>
            <button className="action-btn btn-flag" onClick={handleFlag}>Flag for discussion</button>
            {onDeleteInstance && (
              <button
                className="action-btn btn-delete-instance"
                onClick={() => {
                  if (confirm(`Delete instance ${displayId(instance)}? This cannot be undone.`)) {
                    onDeleteInstance(instance.id);
                  }
                }}
                title="Delete this sign instance"
              >
                Delete
              </button>
            )}
            {signType && (
              <button
                className="action-btn btn-surface"
                onClick={() => {
                  // Phase 6 multi-instance — emit a v2 envelope with
                  // ALL instances of this sign type so Surface lands
                  // every placed sign as a separate Instance in the
                  // family, not just the currently-selected one. The
                  // currently-selected instance is included naturally
                  // since it's part of `allInstances`. Pre-Phase-6
                  // this passed only `instance` (the focused card's
                  // sign) so the other N-1 instances were silently
                  // dropped on the Surface side.
                  const siblings = allInstances.filter(
                    (i) => i.signTypeId === signType.id,
                  );
                  const url = buildHandoffUrl(
                    SURFACE_URL,
                    signType,
                    PROJECT_ID,
                    undefined,
                    siblings,
                  );
                  window.open(url, 'sosisu-surface');
                }}
                title="Open all placed signs of this type in Surface for layout"
              >
                Open in Surface →
              </button>
            )}
          </>
        ) : (
          <>
            <button className="action-btn btn-save" onClick={saveEdit}>Save edits</button>
            <button className="action-btn btn-cancel" onClick={cancelEdit}>Cancel</button>
          </>
        )}
        {!editing && (
          <button
            className="action-btn btn-next"
            onClick={canNext ? onNext : undefined}
            disabled={!canNext}
          >
            {canNext ? 'Next sign \u2192' : 'Review complete \u2713'}
          </button>
        )}
      </div>

    </>
  );
}
