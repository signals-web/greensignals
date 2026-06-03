// ─── Side math — shared bearing / arrow / walk-time helpers ────────────────
//
// Three pure helpers extracted out of `DestinationSuggestions.tsx` so the
// Phase 4 bulk schedule generator and the (now-unrendered but still
// kept) inline Suggest panel can share the same conversion math. Single
// source of truth for the bearing → arrow rotation and the
// distance → walk-time estimate.

/** Map a real-world compass bearing (0=N, 90=E, 180=S, 270=W) to the
 *  arrow convention used by the sign face: 0=right/east, 90=down/south,
 *  270=up/north. The two systems differ by a 90° clockwise rotation
 *  (the arrow is laid out on a flat sign face, not a compass).
 *
 *  Round-trip: `splitSides` recovers the bearing as `(arrow + 90) % 360`,
 *  so storing `bearingToArrow(bearing)` and reading it back through
 *  `splitSides` produces the original bearing — that's how the bulk
 *  generator and the existing read-time front/back classifier
 *  reconcile. */
export function bearingToArrow(bearingDeg: number): number {
  return (bearingDeg - 90 + 360) % 360;
}

/** Snap a degree value to the nearest 45° increment (0/45/90/.../315).
 *  The arrow picker UI uses these 8 directions exclusively; the bulk
 *  schedule generator must produce arrow values that match the picker
 *  so auto-generated rows render with the same icons as manual ones. */
export function snapTo45(deg: number): number {
  return (((Math.round(deg / 45) * 45) % 360) + 360) % 360;
}

/** Format a straight-line distance as a rough pedestrian walk time.
 *  80 m/min is a conservative pace — overstates routed time on tight
 *  campuses but the reviewer can override the field manually. Returns
 *  undefined for negligible distances so the chip doesn't show "~0
 *  min" or "~1 min" for things essentially next to the sign. */
export function walkTimeEstimate(metres: number): string | undefined {
  if (metres < 40) return undefined;
  const mins = Math.max(1, Math.round(metres / 80));
  return `~${mins} min`;
}
