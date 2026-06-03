// ─── Forward-hemisphere clamp + facing-live regen — Phase 4 follow-up ──
//
// Locks two cardinal invariants for the bulk schedule generator:
//
//   1. Every auto-generated row's `arrow` lies in the forward
//      hemisphere of the *face the row lives on*. I.e. front-side
//      arrows point forward of the sign's facing direction; back-side
//      arrows point forward of the opposite direction. Auto rows
//      never tell a pedestrian to walk back the way they came — a
//      cardinal EGD rule.
//
//   2. Re-running the generator with a different `facing` value on
//      the same sign produces a different (and still
//      forward-hemisphere-correct) schedule. The dial in SignCard's
//      edit mode relies on this: cycling N → NE re-shapes which
//      destinations land where.
//
// These tests originally failed before Phase 4's clamp-at-write-time
// fix. Keeping them as regression guards.

import { describe, expect, it } from 'vitest';
import { generateAllSignSchedules } from '../scheduleGenerator.ts';
import {
  isArrowInForwardHemisphere,
  getOppositeDir,
  splitSides,
} from '../directions.ts';
import {
  DEFAULT_SCORING_CONFIG,
  type DestinationPlace,
  type FacingDirection,
  type SignInstance,
} from '../../platform/index.ts';

const NOW = new Date('2026-04-27T00:00:00.000Z');

const M_1: SignInstance = {
  // Real CU Boulder M-1: a Map sign in Grandview, facing N. Surfaced
  // the bug originally — Side A had backward-pointing arrows (↘, ↙)
  // because some destinations were genuinely SE / SW of the sign and
  // the bearing-derived arrow was persisted unclamped.
  id: 'cu-bldr-sign-M-1',
  signTypeId: 'cu-bldr-st-M',
  location: '',
  lat: 40.01045155,
  lng: -105.2760595,
  facing: 'N',
  neighborhood: 'Grandview',
  sides: [],
  reviewStatus: 'pending',
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
};

function makeDest(input: {
  id: string;
  name: string;
  lat: number;
  lng: number;
  district: string;
  tier: 'campus' | 'building' | 'room';
}): DestinationPlace {
  return {
    id: `cu-bldr-dest-${input.id}`,
    projectId: 'cu-bldr-demo',
    name: input.name,
    lat: input.lat,
    lng: input.lng,
    district: input.district,
    tier: input.tier,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    createdBy: 'test',
    updatedBy: 'test',
  };
}

// Hand-crafted destinations spanning all 8 compass sectors around M-1.
// `n-*` family is north of the sign, `s-*` is south, `e-*` is east,
// `se-*` is southeast (key — these were the rows that surfaced the
// "backward arrow on front face" bug for an N-facing sign), etc.
const RING_AROUND_M1: DestinationPlace[] = [
  makeDest({ id: 'n-near', name: 'N-near', lat: 40.0115, lng: -105.27606, district: 'Grandview', tier: 'campus' }),
  makeDest({ id: 'n-far',  name: 'N-far',  lat: 40.0125, lng: -105.27606, district: 'Grandview', tier: 'campus' }),
  makeDest({ id: 'ne',     name: 'NE',     lat: 40.0115, lng: -105.275,   district: 'Grandview', tier: 'campus' }),
  makeDest({ id: 'e',      name: 'E',      lat: 40.01045, lng: -105.275,  district: 'Grandview', tier: 'building' }),
  makeDest({ id: 'se',     name: 'SE',     lat: 40.0095, lng: -105.275,   district: 'Grandview', tier: 'building' }),
  makeDest({ id: 's-near', name: 'S-near', lat: 40.0095, lng: -105.27606, district: 'Grandview', tier: 'building' }),
  makeDest({ id: 'sw',     name: 'SW',     lat: 40.0095, lng: -105.277,   district: 'Grandview', tier: 'building' }),
  makeDest({ id: 'w',      name: 'W',      lat: 40.01045, lng: -105.277,  district: 'Grandview', tier: 'campus' }),
];

function runGen(instance: SignInstance, facing: FacingDirection) {
  const result = generateAllSignSchedules({
    instances: [{ ...instance, facing }],
    destinations: RING_AROUND_M1,
    // Phase 5: empty signTypes → DEFAULT_POLICY for every sign.
    // M_1's M code isn't picked up here because we don't pass a
    // matching SignType — the test exercises the rendering invariant,
    // not policy dispatch.
    signTypes: [],
    config: DEFAULT_SCORING_CONFIG,
    mode: 'replace-auto',
    now: NOW,
  });
  return result.updatedInstances[0]!;
}

describe('forward-hemisphere invariant — front face', () => {
  it('every front-side auto row points forward of the facing direction', () => {
    const facings: FacingDirection[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const offending: Array<{ facing: FacingDirection; arrow: number; name: string }> = [];

    for (const f of facings) {
      const sign = runGen(M_1, f);
      for (const row of sign.sides[0]!.destinations) {
        if (row.arrow == null) continue;
        if (!isArrowInForwardHemisphere(row.arrow, f)) {
          offending.push({ facing: f, arrow: row.arrow, name: row.name });
        }
      }
    }
    expect(offending).toEqual([]);
  });
});

describe('forward-hemisphere invariant — back face', () => {
  it('every back-side auto row points forward of the OPPOSITE direction', () => {
    const facings: FacingDirection[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const offending: Array<{ facing: FacingDirection; arrow: number; name: string }> = [];

    for (const f of facings) {
      const sign = runGen(M_1, f);
      const back = getOppositeDir(f);
      for (const row of sign.sides[1]!.destinations) {
        if (row.arrow == null) continue;
        if (!isArrowInForwardHemisphere(row.arrow, back)) {
          offending.push({ facing: f, arrow: row.arrow, name: row.name });
        }
      }
    }
    expect(offending).toEqual([]);
  });
});

describe('M-1 specific case — no SE/SW arrows on a N-facing front side', () => {
  it('no front-side row has an arrow with a downward (south) component on a N-facing sign', () => {
    const sign = runGen(M_1, 'N');
    // N-facing screen-degree convention: forward = upper hemisphere
    // (arrows 180° to 360°/0°). Backward arrows (anything from 0°
    // exclusive to 180° exclusive in screen-degree space) include
    // ↓, ↘, ↙ — the arrows Chris saw on the Side A. None of these
    // should appear on the front face of a N-facing sign.
    const backwardScreenDegrees = [45, 90, 135]; // ↘, ↓, ↙ in the 8-direction grid
    const offending = sign.sides[0]!.destinations
      .map((r) => r.arrow)
      .filter((a): a is number => a != null && backwardScreenDegrees.includes(a));
    expect(offending).toEqual([]);
  });
});

// ─── Display-frame invariant ───────────────────────────────────────────
// The persisted-arrow tests above prove the data invariant. The visual
// is what reviewers actually see, though, and the EGD rule is "no
// backward arrow rendered on a front face." This block runs the
// generated rows through splitSides (the same renderer SignCard uses
// at view time) and asserts the post-snap displayArrow on each face
// is not in the forbidden set:
//
//   Front: forbidden = {45, 90, 135}  → ↘, ↓, ↙
//   Back:  forbidden = {225, 270, 315} → ↖, ↑, ↗  (back face is upside-
//                                                  down vs front)
//
// Allowed front: {0, 180, 225, 270, 315} → →, ←, ↖, ↑, ↗.
// Allowed back:  {0, 45, 90, 135, 180}   → →, ↘, ↓, ↙, ←.

const FORBIDDEN_FRONT_DISPLAY = new Set([45, 90, 135]);
// Both faces render with up=forward (just for different real-world
// directions). The forbidden visual set is therefore the same on
// each — anything pointing "below the horizon" reads as backward to
// the pedestrian standing in front of that face.
const FORBIDDEN_BACK_DISPLAY = new Set([45, 90, 135]);

describe('display-frame invariant — front face', () => {
  it("M-1 facing N: zero front-side rows render in the forbidden display set", () => {
    const sign = runGen(M_1, 'N');
    const [front] = splitSides(
      sign.sides.flatMap((s) => s.destinations),
      'N',
    );
    const offending = front.destinations
      .map((r) => r.displayArrow)
      .filter(
        (deg): deg is number => deg !== null && FORBIDDEN_FRONT_DISPLAY.has(deg),
      );
    expect(offending).toEqual([]);
  });

  it('every front-side row across all 8 facings renders in the allowed display set', () => {
    const facings: FacingDirection[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const offending: Array<{ facing: FacingDirection; deg: number }> = [];
    for (const f of facings) {
      const sign = runGen(M_1, f);
      const [front] = splitSides(
        sign.sides.flatMap((s) => s.destinations),
        f,
      );
      for (const row of front.destinations) {
        if (row.displayArrow != null && FORBIDDEN_FRONT_DISPLAY.has(row.displayArrow)) {
          offending.push({ facing: f, deg: row.displayArrow });
        }
      }
    }
    expect(offending).toEqual([]);
  });
});

describe('display-frame invariant — back face', () => {
  it('every back-side row across all 8 facings renders in the allowed display set', () => {
    const facings: FacingDirection[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const offending: Array<{ facing: FacingDirection; deg: number }> = [];
    for (const f of facings) {
      const sign = runGen(M_1, f);
      const [, back] = splitSides(
        sign.sides.flatMap((s) => s.destinations),
        f,
      );
      for (const row of back.destinations) {
        if (row.displayArrow != null && FORBIDDEN_BACK_DISPLAY.has(row.displayArrow)) {
          offending.push({ facing: f, deg: row.displayArrow });
        }
      }
    }
    expect(offending).toEqual([]);
  });
});

describe('M-1 specific case — Page Foundation / Grandview Cottage / 1330 Grandview', () => {
  // Hand-crafted destinations that surfaced ↘ on Side A in Chris's
  // screenshot. All three are NE-of-M-1 — pedestrian-forward + right
  // for an N-facing sign. The right rendering is ↗ (315), not ↘ (45).
  const M_1_REAL_NEIGHBOURS: DestinationPlace[] = [
    makeDest({
      id: 'page-foundation-center',
      name: 'Page Foundation Center',
      lat: 40.01080465,
      lng: -105.275711,
      district: 'Grandview',
      tier: 'campus',
    }),
    makeDest({
      id: 'the-grandview-cottage',
      name: 'The Grandview Cottage',
      lat: 40.01130736,
      lng: -105.2754662,
      district: 'Grandview',
      tier: 'building',
    }),
    makeDest({
      id: '1330-1332-grandview',
      name: '1330/1332 Grandview',
      lat: 40.01132578,
      lng: -105.2752737,
      district: 'Grandview',
      tier: 'building',
    }),
    makeDest({
      id: 'limelight-conference-center-and',
      name: 'Limelight Conference Center and Hotel',
      lat: 40.01112752,
      lng: -105.2765273,
      district: 'Grandview',
      tier: 'campus',
    }),
  ];

  it('no row on M-1 facing N renders ↘ ↓ ↙ on Side A', () => {
    const result = generateAllSignSchedules({
      instances: [{ ...M_1, facing: 'N' as const }],
      destinations: M_1_REAL_NEIGHBOURS,
      signTypes: [],
      config: DEFAULT_SCORING_CONFIG,
      mode: 'replace-auto',
      now: NOW,
    });
    const sign = result.updatedInstances[0]!;
    const [front] = splitSides(
      sign.sides.flatMap((s) => s.destinations),
      'N',
    );
    const offending = front.destinations
      .filter(
        (r) =>
          r.displayArrow != null && FORBIDDEN_FRONT_DISPLAY.has(r.displayArrow),
      )
      .map((r) => ({ name: r.name, deg: r.displayArrow }));
    expect(offending).toEqual([]);
  });
});

describe('idempotency under facing change', () => {
  it('changing facing N → NE yields a different schedule but the invariant still holds', () => {
    const signN = runGen(M_1, 'N');
    const signNE = runGen(M_1, 'NE');

    // Sanity: at least one of the front sides differs between the two
    // facings — otherwise the dial would feel dead in the editor.
    const namesN = signN.sides[0]!.destinations.map((r) => r.name).sort().join('|');
    const namesNE = signNE.sides[0]!.destinations.map((r) => r.name).sort().join('|');
    // Either the destination set or the arrow values must differ.
    const arrowsN = signN.sides[0]!.destinations.map((r) => r.arrow).join('|');
    const arrowsNE = signNE.sides[0]!.destinations.map((r) => r.arrow).join('|');
    expect(namesN !== namesNE || arrowsN !== arrowsNE).toBe(true);

    // Forward-hemisphere invariant survives the new facing.
    for (const row of signNE.sides[0]!.destinations) {
      if (row.arrow == null) continue;
      expect(isArrowInForwardHemisphere(row.arrow, 'NE')).toBe(true);
    }
    for (const row of signNE.sides[1]!.destinations) {
      if (row.arrow == null) continue;
      expect(isArrowInForwardHemisphere(row.arrow, getOppositeDir('NE'))).toBe(true);
    }
  });
});
