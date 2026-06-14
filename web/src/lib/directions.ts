/**
 * Directional math utilities for the SOSISU Signal app.
 *
 * Screen degrees: 0=right, clockwise (standard math/CSS rotation).
 * Compass bearings: 0=N, clockwise.
 * Convert screen->compass: (screenDeg + 90) % 360
 * Convert compass->screen: (compassDeg - 90 + 360) % 360
 */

import type {
  SignInstance,
  SignSide,
  Destination,
  FacingDirection,
} from '../platform/index';

export type { FacingDirection, Destination };

// ---------------------------------------------------------------------------
// Split-side types
// ---------------------------------------------------------------------------

export interface SplitDest {
  /** Original screen degrees. */
  arrow: number | null;
  /** Adjusted for view (offset by facing direction). */
  displayArrow: number | null;
  name: string;
  walkTime?: string;
  /** True if the arrow was reflected for the back side. */
  reflected?: boolean;
  /** True if the display arrow was clamped because it pointed behind the sign. */
  clamped?: boolean;
  /** Carried through from the source `Destination` so renderers can show
   *  a link indicator and resolve live names from DestinationPlace. */
  destinationPlaceId?: string;
  /** Carried through from the source `Destination` so the auto/manual
   *  treatment survives the front/back split. The bulk generator writes
   *  `auto: true`; reviewer edits clear the flag. Display-mode reads
   *  flatten + re-split, so without this carry-through the indicator
   *  would be lost on every read. */
  auto?: boolean;
}

export interface SplitSide {
  /** "FRONT" or "BACK". */
  label: string;
  /** Compass direction label, e.g. "N" or "S". */
  compass: string;
  destinations: SplitDest[];
}

// ---------------------------------------------------------------------------
// FACING_DEG — maps FacingDirection to compass degrees
// ---------------------------------------------------------------------------

export const FACING_DEG: Record<FacingDirection, number> = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};

// ---------------------------------------------------------------------------
// Compass direction names by degree (for labelling sides)
// ---------------------------------------------------------------------------

const COMPASS_NAMES: Record<number, FacingDirection> = {
  0: 'N',
  45: 'NE',
  90: 'E',
  135: 'SE',
  180: 'S',
  225: 'SW',
  270: 'W',
  315: 'NW',
};

// ---------------------------------------------------------------------------
// facingToScreenDeg
// ---------------------------------------------------------------------------

/** Convert a facing direction to screen degrees for offset calculations. */
export function facingToScreenDeg(facing: FacingDirection): number {
  const compassDeg = FACING_DEG[facing];
  return (compassDeg - 90 + 360) % 360;
}

// ---------------------------------------------------------------------------
// getOppositeDir
// ---------------------------------------------------------------------------

/** Return the opposite compass direction. */
export function getOppositeDir(dir: FacingDirection): FacingDirection {
  const opp = (FACING_DEG[dir] + 180) % 360;
  return COMPASS_NAMES[opp];
}

// ---------------------------------------------------------------------------
// Arrow direction validation — prevent arrows pointing behind the sign
// ---------------------------------------------------------------------------

/**
 * Check whether an arrow (in screen degrees) falls within the forward
 * hemisphere of a sign's facing direction (i.e. within +-90 deg).
 *
 * Returns true if the arrow is valid (forward-facing), false if it points
 * behind the sign.
 */
export function isArrowInForwardHemisphere(
  arrowScreenDeg: number,
  facing: FacingDirection,
): boolean {
  const facingScreen = facingToScreenDeg(facing);
  const diff = ((arrowScreenDeg - facingScreen + 540) % 360) - 180;
  return Math.abs(diff) <= 90;
}

/**
 * Clamp an arrow angle to the forward hemisphere of the sign's facing
 * direction. If the arrow already points forward (within +-90 deg of the
 * facing direction in screen space), it is returned unchanged. Otherwise it
 * is snapped to the nearest edge of the forward hemisphere (+90 or -90).
 *
 * @returns The (possibly clamped) screen-degree angle.
 */
export function clampArrowToForwardHemisphere(
  arrowScreenDeg: number,
  facing: FacingDirection,
): number {
  const facingScreen = facingToScreenDeg(facing);
  // Signed angular difference, -180..+180
  const diff = ((arrowScreenDeg - facingScreen + 540) % 360) - 180;
  if (Math.abs(diff) <= 90) return arrowScreenDeg; // already forward
  // Clamp to nearest 90-degree edge
  const clamped = diff > 0 ? facingScreen + 90 : facingScreen - 90;
  return ((clamped % 360) + 360) % 360;
}

/**
 * Given a facing direction, return the set of DIRECTIONS grid indices (from
 * arrows.ts) that fall within the forward hemisphere. Useful for disabling
 * backward arrow buttons in the picker.
 */
export function getAllowedArrowDegs(facing: FacingDirection): Set<number> {
  const allowed = new Set<number>();
  // The 8 compass arrows in screen degrees: 0, 45, 90, 135, 180, 225, 270, 315
  for (let deg = 0; deg < 360; deg += 45) {
    if (isArrowInForwardHemisphere(deg, facing)) {
      allowed.add(deg);
    }
  }
  return allowed;
}

// ---------------------------------------------------------------------------
// splitSides
// ---------------------------------------------------------------------------

/**
 * Split a flat array of destinations into front (Side A) and back (Side B).
 *
 * When `facing` is provided, destinations are classified by their angular
 * relationship to the facing bearing. Without facing, a simple screen-space
 * heuristic is used.
 */
export function splitSides(
  dests: Destination[],
  facing?: FacingDirection,
): [SplitSide, SplitSide] {
  const front: SplitDest[] = [];
  const back: SplitDest[] = [];

  if (facing) {
    const facingBearing = FACING_DEG[facing];
    const oppBearing = (facingBearing + 180) % 360;
    const facingScreen = facingToScreenDeg(facing);

    for (const d of dests) {
      if (d.arrow == null) {
        // No arrow -> front side
        front.push({
          arrow: d.arrow,
          displayArrow: null,
          name: d.name,
          walkTime: d.walkTime,
          destinationPlaceId: d.destinationPlaceId,
          auto: d.auto,
        });
        continue;
      }

      const compassBearing = (d.arrow + 90) % 360;
      const diff = ((compassBearing - facingBearing + 540) % 360) - 180;
      const absDiff = Math.abs(diff);

      // View-frame display rotation. The +270 offset is the "up=forward"
      // convention correction: rotating a world-frame arrow by
      // (-facingScreen + 270) maps the sign's facing direction onto
      // the rendered "up" position (270 in screen-degrees), which is
      // what the EGD reading expects.
      //
      // For a long time this lacked the +270 and rendered N-facing
      // signs with NE destinations as ↘ — backward visually. The
      // forward-hemisphere clamp at render time used to paper over
      // that for the worst cases; now that the formula is correct,
      // the clamp is unnecessary and would over-rotate boundary
      // perpendicular rows away from their natural ↖ / ↗ display.
      const frontDisplay = (d.arrow - facingScreen + 270 + 360) % 360;
      const reflectedFor = (a: number) =>
        ((a + 180) % 360 - facingScreen + 270 + 360) % 360;

      if (absDiff <= 67.5) {
        // Front side
        front.push({
          arrow: d.arrow,
          displayArrow: frontDisplay,
          name: d.name,
          walkTime: d.walkTime,
          destinationPlaceId: d.destinationPlaceId,
          auto: d.auto,
        });
      } else if (absDiff >= 112.5) {
        // Back side — reflect arrow into back-face viewer's frame.
        back.push({
          arrow: d.arrow,
          displayArrow: reflectedFor(d.arrow),
          name: d.name,
          walkTime: d.walkTime,
          destinationPlaceId: d.destinationPlaceId,
          auto: d.auto,
          reflected: true,
        });
      } else {
        // Perpendicular — both sides. Cross-side dedup in the bulk
        // generator decides which face wins for auto rows; manual
        // rows are visible from both directions on purpose.
        front.push({
          arrow: d.arrow,
          displayArrow: frontDisplay,
          name: d.name,
          walkTime: d.walkTime,
          destinationPlaceId: d.destinationPlaceId,
          auto: d.auto,
        });
        back.push({
          arrow: d.arrow,
          displayArrow: reflectedFor(d.arrow),
          name: d.name,
          walkTime: d.walkTime,
          destinationPlaceId: d.destinationPlaceId,
          auto: d.auto,
          reflected: true,
        });
      }
    }

    const facingLabel = COMPASS_NAMES[facingBearing] ?? 'N';
    const oppLabel = COMPASS_NAMES[oppBearing] ?? 'S';

    return [
      { label: 'FRONT', compass: facingLabel, destinations: front },
      { label: 'BACK', compass: oppLabel, destinations: back },
    ];
  }

  // --- No facing: screen-space heuristic ---
  for (const d of dests) {
    if (d.arrow == null) {
      front.push({
        arrow: d.arrow,
        displayArrow: null,
        name: d.name,
        walkTime: d.walkTime,
        destinationPlaceId: d.destinationPlaceId,
          auto: d.auto,
      });
      continue;
    }

    const arrow = d.arrow;

    // Up (270), upper diagonals (225, 315) -> front only — handled by the
    //   catch-all `else` branch below (front = anything not back/both),
    //   so no explicit `isFront` flag is needed.
    // Down (90), lower diagonals (45, 135) -> back only (reflected)
    // Exactly left (180) or right (0/360) -> both sides
    const isBack =
      arrow === 90 || arrow === 45 || arrow === 135;
    const isBoth =
      arrow === 180 || arrow === 0;

    if (isBoth) {
      front.push({
        arrow,
        displayArrow: arrow,
        name: d.name,
        walkTime: d.walkTime,
        destinationPlaceId: d.destinationPlaceId,
          auto: d.auto,
      });
      const reflected = (arrow + 180) % 360;
      back.push({
        arrow,
        displayArrow: reflected,
        name: d.name,
        walkTime: d.walkTime,
        destinationPlaceId: d.destinationPlaceId,
          auto: d.auto,
        reflected: true,
      });
    } else if (isBack) {
      const reflected = (arrow + 180) % 360;
      back.push({
        arrow,
        displayArrow: reflected,
        name: d.name,
        walkTime: d.walkTime,
        destinationPlaceId: d.destinationPlaceId,
          auto: d.auto,
        reflected: true,
      });
    } else {
      // Front (including any non-standard angles that aren't explicitly back)
      front.push({
        arrow,
        displayArrow: arrow,
        name: d.name,
        walkTime: d.walkTime,
        destinationPlaceId: d.destinationPlaceId,
          auto: d.auto,
      });
    }
  }

  return [
    { label: 'FRONT', compass: 'N', destinations: front },
    { label: 'BACK', compass: 'S', destinations: back },
  ];
}

// ---------------------------------------------------------------------------
// haversine — great-circle distance in FEET
// ---------------------------------------------------------------------------

const EARTH_RADIUS_FT = 20_902_231;

/** Great-circle distance between two lat/lng pairs, in feet. */
export function haversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_FT * c;
}

// ---------------------------------------------------------------------------
// getNearbySignData
// ---------------------------------------------------------------------------

export interface NearbySign {
  sign: SignInstance;
  distFt: number;
  sharedCount: number;
}

/**
 * Find nearby signs that share destination names with the current sign.
 * Returns results sorted by shared destination count (desc), then distance (asc).
 */
export function getNearbySignData(
  currentSign: SignInstance,
  allSigns: SignInstance[],
  maxDistFt = 400,
  maxResults = 6,
): NearbySign[] {
  // Build a lowercase Set of the current sign's destination names
  const currentNames = new Set<string>();
  const sides = (currentSign as any).sides as SignSide[] | undefined;
  if (sides) {
    for (const side of sides) {
      for (const dest of side.destinations) {
        currentNames.add(dest.name.toLowerCase());
      }
    }
  }

  if (currentSign.lat == null || currentSign.lng == null) return [];

  const candidates: NearbySign[] = [];

  for (const sign of allSigns) {
    if (sign.id === currentSign.id) continue;
    if (sign.lat == null || sign.lng == null) continue;

    const distFt = haversine(
      currentSign.lat,
      currentSign.lng,
      sign.lat,
      sign.lng,
    );

    if (distFt > maxDistFt) continue;

    // Count shared destination names
    let sharedCount = 0;
    const candidateSides = (sign as any).sides as SignSide[] | undefined;
    if (candidateSides) {
      for (const side of candidateSides) {
        for (const dest of side.destinations) {
          if (currentNames.has(dest.name.toLowerCase())) {
            sharedCount++;
          }
        }
      }
    }

    candidates.push({ sign, distFt, sharedCount });
  }

  // Sort: shared count DESC, then distance ASC
  candidates.sort((a, b) => {
    if (b.sharedCount !== a.sharedCount) return b.sharedCount - a.sharedCount;
    return a.distFt - b.distFt;
  });

  return candidates.slice(0, maxResults);
}

// ---------------------------------------------------------------------------
// estimateDestPos
// ---------------------------------------------------------------------------

/**
 * Estimate a destination's map position by projecting outward from the sign
 * location using the arrow direction and walk time.
 *
 * Returns [lat, lng].
 */
export function estimateDestPos(
  lat: number,
  lng: number,
  arrowScreenDeg: number,
  walkTime?: string,
): [number, number] {
  // Parse walk time to minutes (default 1)
  let minutes = 1;
  if (walkTime) {
    const match = walkTime.match(/(\d+)/);
    if (match) {
      minutes = parseInt(match[1], 10) || 1;
    }
  }

  // Walking speed ~80 m/min
  const distMeters = minutes * 80;

  // Convert screen degrees to compass bearing
  const compassBearing = (arrowScreenDeg + 90) % 360;

  // Convert compass bearing to radians (0=N, clockwise)
  const bearingRad = (compassBearing * Math.PI) / 180;

  const latRad = (lat * Math.PI) / 180;

  // Project
  const destLat = lat + (distMeters / 111320) * Math.cos(bearingRad);
  const destLng =
    lng + (distMeters / (111320 * Math.cos(latRad))) * Math.sin(bearingRad);

  return [destLat, destLng];
}
