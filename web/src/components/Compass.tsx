// ─── Compass icon — Phase 5c ────────────────────────────────────────────
//
// Static compass-rose icon that snaps its needle to the sign's facing
// direction. Phase 5c removed the in-icon `<animateTransform>` SVG
// animations and the CSS easing transition that were causing visible
// drift on consecutive dial clicks — the rose now applies a single
// transform-rotate that matches the chosen direction the moment React
// commits the new facing.
//
// `facing === undefined` is a legitimate state (sign without a placed
// orientation yet); render dimmed without a needle so the reviewer can
// see "no facing set" at a glance.

import type { FacingDirection } from '../platform/index.ts';

/** Compass-degree value for each FacingDirection. Mirrors the same
 *  table used by `lib/directions.ts`'s `FACING_DEG` so the rest of
 *  the app and the icon stay in lockstep. */
const FACING_DEG: Record<FacingDirection, number> = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};

interface Props {
  facing: FacingDirection | undefined;
  size?: number;
}

/** Static compass icon that points to the sign's facing direction.
 *  No animation — the transform is applied directly so consecutive
 *  dial clicks register as discrete frames at the new bearing. */
export function Compass({ facing, size = 24 }: Props) {
  const deg = facing ? FACING_DEG[facing] : 0;
  const hasFacing = facing !== undefined;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      data-testid="compass-svg"
      data-facing={facing ?? 'none'}
      style={{
        // Snap-rotate. No transition / animation — see file header for
        // the Phase 5c rationale.
        transform: `rotate(${deg}deg)`,
        // Neutral state for unfaced signs: dim without a directional
        // wedge so the reviewer reads it as "no orientation set."
        opacity: hasFacing ? 1 : 0.35,
        overflow: 'visible',
      }}
    >
      {/* Compass face — outer ring + cardinal ticks. */}
      <circle
        cx={12}
        cy={12}
        r={9.5}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        opacity={0.55}
      />
      {/* Cardinal ticks at N/E/S/W. Slightly longer than the
          intercardinal ticks to give the rose a visual datum. */}
      <line x1={12} y1={2} x2={12} y2={4.5} stroke="currentColor" strokeWidth={1.5} />
      <line x1={22} y1={12} x2={19.5} y2={12} stroke="currentColor" strokeWidth={1} opacity={0.55} />
      <line x1={12} y1={22} x2={12} y2={19.5} stroke="currentColor" strokeWidth={1} opacity={0.55} />
      <line x1={2} y1={12} x2={4.5} y2={12} stroke="currentColor" strokeWidth={1} opacity={0.55} />

      {/* Needle — only rendered when a facing is set. Triangle pointing
          up (north) by default; the parent SVG's transform-rotate puts
          it at the right bearing. The base sits at the centre and the
          tip touches the cardinal-N tick. */}
      {hasFacing && (
        <polygon
          data-testid="compass-needle"
          points="12,3.5 10,12 14,12"
          fill="currentColor"
        />
      )}
      {/* Centre dot — anchors the eye whether or not the needle is shown. */}
      <circle cx={12} cy={12} r={1.5} fill="currentColor" />
    </svg>
  );
}
