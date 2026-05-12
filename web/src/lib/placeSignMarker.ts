// Phase 6 — Place-sign ghost marker DOM helper.
//
// Pre-Phase-6, sign placement put the dash glyph + animation + maplibre's
// position transform on the SAME element. MapLibre attaches its position
// via inline style (`transform: translate(-50%, -50%) translate(<X>px,
// <Y>px) rotate(...)`), but the element also carried the
// `.placement-ghost-marker` CSS rule with `transform: scale(0.5)` and a
// `ghost-appear` keyframe ending in `transform: scale(1)`. The CSS
// transform CLOBBERED MapLibre's inline-style transform → marker
// rendered at the map container's (0,0) origin regardless of click
// point. Result: click anywhere on the map, ghost dash flies to the
// top-left corner.
//
// Fix: split the element. Outer wrapper holds MapLibre's transform
// (nothing else applied). Inner element holds the dash + animation +
// CSS transform. The two layers don't fight.
//
// The helper returns the outer element (to hand to `new
// maplibregl.Marker({ element })`) plus the inner element (for tests
// that want to assert the structure). Production code only needs the
// outer ref.

export interface GhostMarkerElement {
  /** Outer wrapper — pass to `new maplibregl.Marker({ element })`. */
  outer: HTMLDivElement;
  /** Inner element carrying the dash glyph + CSS animation. Exposed
   *  for tests + accessibility hooks. */
  inner: HTMLDivElement;
}

/** Build the DOM structure for a placement ghost marker. The outer
 *  element has NO CSS transform-related styling — so MapLibre's inline-
 *  style transform survives unmolested. The inner element holds
 *  `.placement-ghost-marker` (which carries the scale animation). */
export function createPlacementGhostMarker(
  doc: Document = document,
): GhostMarkerElement {
  const outer = doc.createElement('div');
  outer.className = 'placement-ghost-wrap';
  const inner = doc.createElement('div');
  inner.className = 'placement-ghost-marker';
  inner.innerHTML = '—';
  outer.appendChild(inner);
  return { outer, inner };
}
