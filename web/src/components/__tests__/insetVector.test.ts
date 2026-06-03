// ─── Inset marker — rotation contract ────────────────────────────────────
//
// Pins the rotation lookup the SignCard inset map feeds into BOTH:
//
//   1. `marker.setRotation(deg)` with `rotationAlignment: 'map'` —
//      the marker's heading in WORLD frame.
//   2. `map.easeTo({ bearing: deg })` — the heads-up viewport
//      rotation, so the facing direction lands at screen-up.
//
// Both call sites take the same number, hence one shared helper.
// The marker's SVG baseline is laid out so the panel sits north of
// the post at rotation 0 ("front" of the sign points world-north),
// so rotation = `FACING_DEG[facing]` directly — no -90 offset like
// the earlier 5c experiment that defaulted to east-facing.
//
// The marker's *shape* (panel + post glyph rather than the previous
// arrow) is verified by the live preview: this test exists so a
// future edit to SignCard's rotation helper can't silently flip
// the directional convention without a CI signal.

import { describe, expect, it } from 'vitest';
import { insetVectorRotationDeg } from '../SignCard.tsx';

describe('insetVectorRotationDeg — line-points-up baseline', () => {
  it('returns 0 for undefined facing (no line; identity rotation)', () => {
    expect(insetVectorRotationDeg(undefined)).toBe(0);
  });

  it('returns 0 for N (line points up — same as the SVG default)', () => {
    expect(insetVectorRotationDeg('N')).toBe(0);
  });

  it('returns 45 for NE', () => {
    expect(insetVectorRotationDeg('NE')).toBe(45);
  });

  it('returns 90 for E (line points right)', () => {
    expect(insetVectorRotationDeg('E')).toBe(90);
  });

  it('returns 135 for SE', () => {
    expect(insetVectorRotationDeg('SE')).toBe(135);
  });

  it('returns 180 for S (line points down)', () => {
    expect(insetVectorRotationDeg('S')).toBe(180);
  });

  it('returns 225 for SW', () => {
    expect(insetVectorRotationDeg('SW')).toBe(225);
  });

  it('returns 270 for W (line points left)', () => {
    expect(insetVectorRotationDeg('W')).toBe(270);
  });

  it('returns 315 for NW', () => {
    expect(insetVectorRotationDeg('NW')).toBe(315);
  });
});
