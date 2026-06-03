// ─── Phase 5: per-sign-type policy dispatch in the schedule generator ─────
//
// End-to-end behaviour test for the policy plumbing. The unit-level
// policy table tests live in @sosisu/platform/scoring/__tests__/
// policies.test.ts; this file pins the *generator's* contract:
//
//   - Map (M) signs filter candidates to `isAnchor === true` only.
//     Non-anchor destinations never appear on a Map sign's sides,
//     even when they outrank anchors on distance + bearing.
//   - Map signs ignore the walk-distance cap — anchors are anchors
//     regardless of distance.
//   - PM / SD / N sign types do NOT filter by anchor — the flag is
//     ignored. Anchors and non-anchors both rank.
//   - PM / SD / N sign types respect their per-type walk-distance
//     cap. The repro for cu-bldr-sign-SD-2 in Grandview is the
//     central failure mode: a SD sign should never surface 30-min
//     destinations.
//   - SignType field overrides flow through (capacityPerSide,
//     maxWalkMinutes, anchorsOnly each independently).
//   - When an instance references an unknown / archived sign type,
//     DEFAULT_POLICY is used.

import { describe, expect, it } from 'vitest';
import { generateAllSignSchedules } from '../scheduleGenerator.ts';
import {
  haversineDistance,
  type DestinationPlace,
  type ScoringConfig,
  type SignInstance,
  type SignType,
} from '../../platform/index.ts';

const NOW = new Date('2026-04-27T00:00:00.000Z');

const CONFIG: ScoringConfig = {
  weights: { distance: 0.4, bearing: 0.3, tier: 0.2, district: 0.1 },
  tierMaxDistanceMeters: { campus: 1500, building: 500, room: 60 },
};

function dest(overrides: Partial<DestinationPlace>): DestinationPlace {
  return {
    id: 'd',
    projectId: 'p',
    name: 'Dest',
    lat: 40,
    lng: -105,
    tier: 'building',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    createdBy: 't',
    updatedBy: 't',
    ...overrides,
  };
}

function sign(overrides: Partial<SignInstance> = {}): SignInstance {
  return {
    id: 's-1',
    signTypeId: 'st-M',
    location: '',
    lat: 40,
    lng: -105,
    facing: 'N',
    sides: [],
    reviewStatus: 'pending',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function signType(overrides: Partial<SignType> & { code: string }): SignType {
  return {
    id: `st-${overrides.code}`,
    name: overrides.code,
    category: overrides.code === 'M' ? 'informational' : 'directional',
    dimensionsMM: { w: 1500, h: 500, d: 60 },
    copy: [],
    materials: [],
    mountType: 'post',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

// Six destinations near (40, -105): three anchors, three non-anchors,
// all forward-hemisphere from an N-facing sign at the origin and all
// well within any per-type walk cap.
const ANCHORS: DestinationPlace[] = [
  dest({ id: 'anchor-1', name: 'Library', lat: 40.001, lng: -105, tier: 'campus', isAnchor: true }),
  dest({ id: 'anchor-2', name: 'Stadium', lat: 40.0015, lng: -105.0001, tier: 'campus', isAnchor: true }),
  dest({ id: 'anchor-3', name: 'Hospital', lat: 40.002, lng: -105.0002, tier: 'campus', isAnchor: true }),
];

const NON_ANCHORS: DestinationPlace[] = [
  // Closer than the anchors so they'd outrank without the filter.
  dest({ id: 'non-1', name: 'Closet', lat: 40.0001, lng: -105, tier: 'campus', isAnchor: false }),
  dest({ id: 'non-2', name: 'Loading Dock', lat: 40.00015, lng: -105.0001, tier: 'campus' }),
  dest({ id: 'non-3', name: 'IT Closet', lat: 40.0002, lng: -105.0002, tier: 'campus', isAnchor: false }),
];

const ALL_DESTINATIONS = [...ANCHORS, ...NON_ANCHORS];

function rowsOf(args: { instance: SignInstance; signTypes: SignType[]; destinations?: DestinationPlace[] }) {
  const result = generateAllSignSchedules({
    instances: [args.instance],
    destinations: args.destinations ?? ALL_DESTINATIONS,
    signTypes: args.signTypes,
    config: CONFIG,
    mode: 'replace-auto',
    now: NOW,
  });
  return result.updatedInstances[0]!.sides
    .flatMap((s) => s.destinations)
    .map((d) => d.destinationPlaceId)
    .filter((id): id is string => !!id);
}

describe('Phase 5 — Map signs filter to anchors-only', () => {
  it('only emits anchor destinations on a Map (M) sign', () => {
    const ids = rowsOf({
      instance: sign({ signTypeId: 'st-M' }),
      signTypes: [signType({ code: 'M' })],
    });
    for (const id of ids) {
      expect(id.startsWith('anchor-')).toBe(true);
    }
    expect(ids).toEqual(expect.arrayContaining(ANCHORS.map((a) => a.id)));
  });

  it('produces empty sides on a Map sign when no anchors exist', () => {
    const result = generateAllSignSchedules({
      instances: [sign({ signTypeId: 'st-M' })],
      destinations: NON_ANCHORS,
      signTypes: [signType({ code: 'M' })],
      config: CONFIG,
      mode: 'replace-auto',
      now: NOW,
    });
    const allRows = result.updatedInstances[0]!.sides.flatMap((s) => s.destinations);
    expect(allRows).toHaveLength(0);
  });

  it('Map signs IGNORE the walk-distance cap (anchors are anchors regardless)', () => {
    // Anchor at ~5 km north (well past any default cap).
    const farAnchor = dest({
      id: 'far-anchor',
      name: 'Far Anchor',
      lat: 40.045, // ~5 km north of (40, -105)
      lng: -105,
      tier: 'campus',
      isAnchor: true,
    });
    const ids = rowsOf({
      instance: sign({ signTypeId: 'st-M' }),
      signTypes: [signType({ code: 'M' })],
      destinations: [farAnchor, ...NON_ANCHORS],
    });
    expect(ids).toContain('far-anchor');
  });
});

describe('Phase 5 — directional signs ignore the anchor flag', () => {
  it('emits both anchor and non-anchor destinations on a PM sign', () => {
    const ids = rowsOf({
      instance: sign({ signTypeId: 'st-PM' }),
      signTypes: [signType({ code: 'PM' })],
    });
    expect(ids.some((id) => id.startsWith('anchor-'))).toBe(true);
    expect(ids.some((id) => id.startsWith('non-'))).toBe(true);
  });

  it('emits both anchor and non-anchor destinations on an SD sign', () => {
    const ids = rowsOf({
      instance: sign({ signTypeId: 'st-SD' }),
      signTypes: [signType({ code: 'SD' })],
    });
    expect(ids.some((id) => id.startsWith('anchor-'))).toBe(true);
    expect(ids.some((id) => id.startsWith('non-'))).toBe(true);
  });
});

describe('Phase 5 — fallback when SignType is missing', () => {
  it('uses DEFAULT_POLICY (no anchor filter, 10 min walk cap) when signTypeId is unknown', () => {
    const ids = rowsOf({
      instance: sign({ signTypeId: 'st-archived' }),
      signTypes: [signType({ code: 'M' })], // unrelated
    });
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.some((id) => id.startsWith('non-'))).toBe(true);
  });
});

describe('Phase 5 — walk-distance cap on directional signs', () => {
  // The repro that motivated this whole Phase. SD-2 in Grandview was
  // ranking destinations 30 minutes away. With SD's 8-min cap, those
  // are filtered out before scoring so they can't burn cap slots.
  const SD_2 = sign({
    id: 'cu-bldr-sign-SD-2',
    signTypeId: 'st-SD',
    lat: 40.01149515,
    lng: -105.2759416,
    facing: 'N',
    neighborhood: 'Grandview',
  });

  // A nearby SD-eligible destination (~50 m away).
  const SD_NEAR = dest({
    id: 'sd-near',
    name: 'Page Foundation Center',
    lat: 40.01080465,
    lng: -105.275711,
    tier: 'campus',
  });

  // The actual destination from the repro: Center for Innovation and
  // Creativity, ~2.5 km away straight-line. With SD's 8-min cap
  // (= 640 m), this MUST be excluded.
  const SD_FAR = dest({
    id: 'sd-far',
    name: 'Center for Innovation and Creativity',
    lat: 40.01774414,
    lng: -105.2470135,
    tier: 'campus',
  });

  it('SD policy excludes destinations beyond the walk-distance cap', () => {
    // Sanity-check distance so the test fails loudly if coordinates change.
    const farMetres = haversineDistance(SD_2 as { lat: number; lng: number }, SD_FAR);
    expect(farMetres).toBeGreaterThan(800); // beyond SD's 640m cap

    const ids = rowsOf({
      instance: SD_2,
      signTypes: [signType({ code: 'SD' })],
      destinations: [SD_NEAR, SD_FAR],
    });
    expect(ids).toContain('sd-near');
    expect(ids).not.toContain('sd-far');
  });

  it('PM policy admits destinations farther than SD allows', () => {
    // Place a destination at ~900 m. SD (640m cap) excludes it; PM
    // (1200m cap) includes it.
    const sd = sign({
      ...SD_2,
      id: 's-cap-test',
      signTypeId: 'st-SD',
    });
    const pm = sign({
      ...SD_2,
      id: 's-cap-test',
      signTypeId: 'st-PM',
    });
    const mid = dest({
      id: 'mid-distance',
      name: 'Mid',
      // ~900m east of SD_2 — outside SD's 640m cap, inside PM's 1200m cap.
      lat: SD_2.lat!,
      lng: SD_2.lng! + 0.0105,
      tier: 'campus',
    });
    // Sanity-check distance.
    const m = haversineDistance(SD_2 as { lat: number; lng: number }, mid);
    expect(m).toBeGreaterThan(640);
    expect(m).toBeLessThan(1200);

    const sdIds = rowsOf({
      instance: sd,
      signTypes: [signType({ code: 'SD' })],
      destinations: [SD_NEAR, mid],
    });
    expect(sdIds).not.toContain('mid-distance');

    const pmIds = rowsOf({
      instance: pm,
      signTypes: [signType({ code: 'PM' })],
      destinations: [SD_NEAR, mid],
    });
    expect(pmIds).toContain('mid-distance');
  });
});

describe('Phase 5 — SignType field overrides flow through', () => {
  // Each test pins one of the three override fields independently.

  it('SignType.maxWalkMinutes override tightens the cap below the code default', () => {
    // SD default is 8 min (640m). Override to 1 min (80m) — the
    // ~110m destination at (40.001, -105) should now be excluded.
    const tightSD = signType({ code: 'SD', maxWalkMinutes: 1 });
    const result = generateAllSignSchedules({
      instances: [sign({ signTypeId: 'st-SD' })],
      destinations: NON_ANCHORS, // ~10–25m away each
      signTypes: [tightSD],
      config: CONFIG,
      mode: 'replace-auto',
      now: NOW,
    });
    const ids = result.updatedInstances[0]!.sides
      .flatMap((s) => s.destinations)
      .map((d) => d.destinationPlaceId);
    // All non-anchors are within 25m, well inside the 80m override cap.
    expect(ids.length).toBeGreaterThan(0);

    // Now place a destination just outside the 80m override and
    // verify it's excluded.
    const just_outside = dest({
      id: 'just-outside',
      name: 'Just Past Cap',
      lat: 40.001, // ~111m away
      lng: -105,
      tier: 'campus',
    });
    const result2 = generateAllSignSchedules({
      instances: [sign({ signTypeId: 'st-SD' })],
      destinations: [just_outside],
      signTypes: [tightSD],
      config: CONFIG,
      mode: 'replace-auto',
      now: NOW,
    });
    const ids2 = result2.updatedInstances[0]!.sides
      .flatMap((s) => s.destinations)
      .map((d) => d.destinationPlaceId);
    expect(ids2).not.toContain('just-outside');
  });

  it('SignType.capacityPerSide override widens the cap above the code default', () => {
    // PM default is 4 per side. Override to 8.
    const widePM = signType({ code: 'PM', capacityPerSide: 8 });
    const candidates = Array.from({ length: 12 }, (_, i) =>
      dest({
        id: `f-${i}`,
        lat: 40.001 + i * 0.00001, // all within ~120m, forward
        lng: -105,
      }),
    );
    const result = generateAllSignSchedules({
      instances: [sign({ signTypeId: 'st-PM' })],
      destinations: candidates,
      signTypes: [widePM],
      config: CONFIG,
      mode: 'replace-auto',
      now: NOW,
    });
    const front = result.updatedInstances[0]!.sides[0]!.destinations.length;
    // Wider cap should yield more rows than the default of 4.
    expect(front).toBeGreaterThan(4);
    expect(front).toBeLessThanOrEqual(8);
  });

  it('SignType.anchorsOnly override forces a non-Map type into anchors-only mode', () => {
    // Per-project quirk: someone wants their PM signs to behave like
    // Map signs. Setting anchorsOnly: true on the SignType should
    // achieve that without code changes.
    const anchorPM = signType({ code: 'PM', anchorsOnly: true });
    const ids = rowsOf({
      instance: sign({ signTypeId: 'st-PM' }),
      signTypes: [anchorPM],
    });
    for (const id of ids) {
      expect(id.startsWith('anchor-')).toBe(true);
    }
  });

  it('Empty SignType field falls back to the code default', () => {
    // SignType for SD with all override fields undefined should
    // resolve identically to one with no overrides at all.
    const baseSD = signType({ code: 'SD' });
    const cleared = signType({
      code: 'SD',
      capacityPerSide: undefined,
      anchorsOnly: undefined,
      maxWalkMinutes: undefined,
    });
    // Run both, compare row identity.
    const baseIds = rowsOf({
      instance: sign({ signTypeId: 'st-SD' }),
      signTypes: [baseSD],
    }).sort();
    const clearedIds = rowsOf({
      instance: sign({ signTypeId: 'st-SD' }),
      signTypes: [cleared],
    }).sort();
    expect(clearedIds).toEqual(baseIds);
  });
});
