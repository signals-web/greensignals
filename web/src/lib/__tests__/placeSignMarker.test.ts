// @vitest-environment jsdom
//
// Phase 6 — regression test for the place-sign ghost marker DOM
// structure. The bug pre-fix: ghost dash + animation + maplibre
// position transform all rode on the same element, so the CSS
// `transform: scale(...)` clobbered maplibre's inline-style
// transform and the marker rendered at (0,0) of the map container.
//
// Invariants pinned here:
//   1. The element passed to maplibre's Marker constructor is a
//      WRAPPER. Its className is NOT `.placement-ghost-marker` (the
//      class that carries the offending CSS transform).
//   2. The wrapper has exactly one child — the inner element — and
//      the inner element carries `.placement-ghost-marker`.
//   3. The dash glyph is in the inner element (— / em-dash).
//
// We can't unit-test the live MapLibre transform composition (no
// MapLibre in the jsdom env), but the structural invariant is what
// the fix turns on — if the outer ever picks up that class again,
// the bug returns.

import { describe, it, expect } from 'vitest';
import { createPlacementGhostMarker } from '../placeSignMarker';

describe('createPlacementGhostMarker', () => {
  it('produces a wrapper element whose className is NOT placement-ghost-marker', () => {
    const { outer } = createPlacementGhostMarker();
    expect(outer.className).not.toContain('placement-ghost-marker');
    expect(outer.className).toBe('placement-ghost-wrap');
  });

  it('puts the .placement-ghost-marker class on the inner element only', () => {
    const { outer, inner } = createPlacementGhostMarker();
    expect(inner.className).toBe('placement-ghost-marker');
    // Outer has no transform-bearing class
    expect(outer.querySelector('.placement-ghost-marker')).toBe(inner);
    expect(outer.children.length).toBe(1);
  });

  it('renders the em-dash glyph in the inner element', () => {
    const { inner } = createPlacementGhostMarker();
    expect(inner.innerHTML).toMatch(/^[——]$/);
  });

  it('the wrapper has no inline transform style', () => {
    // Locks the no-style-on-outer invariant — if a future change adds
    // a transform here, MapLibre's position transform gets clobbered
    // the same way the original bug did.
    const { outer } = createPlacementGhostMarker();
    expect(outer.style.transform).toBe('');
  });
});
