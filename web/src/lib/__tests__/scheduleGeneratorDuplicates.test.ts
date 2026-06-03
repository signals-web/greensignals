// ─── Duplicate-destinations bug hunt — Phase 4 follow-up ────────────────
//
// Captures Chris's deterministic repro: in a fresh private browser
// window with empty localStorage, loading the CU Boulder seed and
// clicking Generate produces 7 rows on Side A and 10 rows on Side B
// for sign cu-bldr-sign-SD-2 (Grandview, facing N). Three specific
// destinations — Center for Innovation and Creativity, the Pavilion
// next door, and Athens North Court — show up 4× total each (2× on
// each side). Five other destinations appear exactly 1×.
//
// The test reproduces that exact data scenario with hand-transcribed
// values from `code/signal/web/src/data/cuBoulder/destinations.csv`,
// then asserts four invariants:
//
//   1. No duplicate `destinationPlaceId` within a single side
//   2. No `destinationPlaceId` on more than one side
//   3. Each side's destination count ≤ policy.capacityPerSide for that sign type
//   4. Total destinations across both sides ≤ 2 × policy.capacityPerSide
//
// Phase 5: cap is now per-sign-type (DEFAULTS_BY_CODE). SD signs use
// policy.capacityPerSide = 4 — same upper bound this test originally checked.
//
// At least one of (1)/(2) MUST fail before the fix lands. The bug is
// in `splitSides()` — its "perpendicular" branch (67.5° to 112.5° off
// facing) pushes a row onto BOTH front and back, then SignCard's
// edit-save path or the bulk generator runs through it again and
// double-pushes. Fixing splitSides isn't in scope per the prompt
// (threshold changes are explicitly forbidden), so the fix is
// upstream: dedupe by `destinationPlaceId` after `splitSides()` runs
// inside the bulk generator.

import { describe, expect, it } from 'vitest';
import { generateAllSignSchedules } from '../scheduleGenerator.ts';
import {
  DEFAULT_SCORING_CONFIG,
  policyForSignType,
  type DestinationPlace,
  type SignInstance,
  type SignType,
} from '../../platform/index.ts';

const NOW = new Date('2026-04-27T00:00:00.000Z');

const SD_2: SignInstance = {
  id: 'cu-bldr-sign-SD-2',
  signTypeId: 'cu-bldr-st-SD',
  location: '',
  lat: 40.01149515,
  lng: -105.2759416,
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

// Hand-transcribed from destinations.csv. Tier mapping follows the
// seed's convention (1 → campus, 2 → building, 3 → building).
const DESTINATIONS: DestinationPlace[] = [
  // The three that get multiplied 4× each:
  makeDest({
    id: 'center-for-innovation-and',
    name: 'Center for Innovation and Creativity',
    lat: 40.01774414,
    lng: -105.2470135,
    district: 'East Campus',
    tier: 'campus',
  }),
  makeDest({
    id: 'center-for-innovation-and2',
    name: 'Center for Innovation and Creativity Pavilion',
    lat: 40.01765324,
    lng: -105.247734,
    district: 'East Campus',
    tier: 'campus',
  }),
  makeDest({
    id: 'athens-north-court',
    name: 'Athens North Court',
    lat: 40.01292433,
    lng: -105.2708403,
    district: 'North Boulder Creek',
    tier: 'building',
  }),
  // Close-by destinations that show up 1× each (these are the "clamped"
  // rows in the screenshot — destinations behind the sign that
  // splitSides reflects to the back face):
  makeDest({
    id: 'limelight-conference-center-and',
    name: 'Limelight Conference Center and Hotel',
    lat: 40.01112752,
    lng: -105.2765273,
    district: 'Grandview',
    tier: 'campus',
  }),
  makeDest({
    id: 'page-foundation-center',
    name: 'Page Foundation Center',
    lat: 40.01080465,
    lng: -105.275711,
    district: 'Grandview',
    tier: 'campus',
  }),
  makeDest({
    id: 'continuing-education-center',
    name: 'Continuing Education Center',
    lat: 40.01084701,
    lng: -105.274399,
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
    id: 'family-housing-expansion',
    name: 'Family Housing Expansion',
    lat: 40.01332163,
    lng: -105.2723158,
    district: 'North Boulder Creek',
    tier: 'building',
  }),
];

// Full-seed integration test — exercises the entire 152-destination set
// the dashboard's "Generate schedules" runs against. This is the test
// closest to Chris's deterministic repro (private browser window,
// empty localStorage). If only the 8-destination case above passes
// but this one fails, the bug shape changes with destination
// density — useful diagnostic.
import { buildCuBoulderSeed } from '../../data/cuBoulder/index.ts';

describe('generateAllSignSchedules — full CU Boulder seed integration', () => {
  const seed = buildCuBoulderSeed({ projectId: 'cu-bldr-demo' });
  const signTypeById = new Map(seed.signTypes.map((st) => [st.id, st]));

  it('produces no duplicate destinationPlaceIds within any single side across all signs', () => {
    const result = generateAllSignSchedules({
      instances: seed.instances,
      destinations: seed.destinations,
      signTypes: seed.signTypes,
      config: DEFAULT_SCORING_CONFIG,
      mode: 'replace-auto',
      now: NOW,
    });

    const offending: Array<{ sign: string; side: number; dup: string }> = [];
    for (const sign of result.updatedInstances) {
      sign.sides.forEach((side, sIdx) => {
        const seen = new Set<string>();
        for (const row of side.destinations) {
          if (!row.destinationPlaceId) continue;
          if (seen.has(row.destinationPlaceId)) {
            offending.push({
              sign: sign.id,
              side: sIdx,
              dup: row.destinationPlaceId,
            });
          }
          seen.add(row.destinationPlaceId);
        }
      });
    }
    expect(offending).toEqual([]);
  });

  it('produces no destinationPlaceId on more than one side across all signs', () => {
    const result = generateAllSignSchedules({
      instances: seed.instances,
      destinations: seed.destinations,
      signTypes: seed.signTypes,
      config: DEFAULT_SCORING_CONFIG,
      mode: 'replace-auto',
      now: NOW,
    });

    const offending: Array<{ sign: string; dup: string }> = [];
    for (const sign of result.updatedInstances) {
      const sideAIds = new Set(
        sign.sides[0]?.destinations
          .map((d) => d.destinationPlaceId)
          .filter((id): id is string => !!id) ?? [],
      );
      for (const row of sign.sides[1]?.destinations ?? []) {
        if (!row.destinationPlaceId) continue;
        if (sideAIds.has(row.destinationPlaceId)) {
          offending.push({ sign: sign.id, dup: row.destinationPlaceId });
        }
      }
    }
    expect(offending).toEqual([]);
  });

  it('respects per-sign-type policy cap on each side for every sign', () => {
    // Phase 5: cap is per-sign-type. Look up each sign's policy via
    // DEFAULTS_BY_CODE → capacityPerSide and assert per-instance, since Map
    // signs (M) have a wider cap than Nudge (N).
    const result = generateAllSignSchedules({
      instances: seed.instances,
      destinations: seed.destinations,
      signTypes: seed.signTypes,
      config: DEFAULT_SCORING_CONFIG,
      mode: 'replace-auto',
      now: NOW,
    });

    const offending: Array<{
      sign: string;
      side: number;
      count: number;
      cap: number;
    }> = [];
    for (const sign of result.updatedInstances) {
      const st = signTypeById.get(sign.signTypeId);
      const cap = policyForSignType(st).capacityPerSide;
      sign.sides.forEach((side, sIdx) => {
        if (side.destinations.length > cap) {
          offending.push({
            sign: sign.id,
            side: sIdx,
            count: side.destinations.length,
            cap,
          });
        }
      });
    }
    expect(offending).toEqual([]);
  });
});

// Stub sign type for SD-2 — code 'SD' so DEFAULTS_BY_CODE.SD picks up
// (capacityPerSide = 4, no anchor filter). Without it the generator would
// fall back to DEFAULT_POLICY (also cap=4) — same numbers but the
// dispatch would be silently bypassed.
const SD_SIGN_TYPE: SignType = {
  id: 'cu-bldr-st-SD',
  code: 'SD',
  name: 'Secondary Destination',
  category: 'directional',
  dimensionsMM: { w: 1800, h: 750, d: 60 },
  copy: [],
  materials: [],
  mountType: 'post',
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
};

const SD_POLICY_CAP = policyForSignType(SD_SIGN_TYPE).capacityPerSide;

describe('generateAllSignSchedules — duplicate hunt for SD-2', () => {
  it('produces no duplicate destinationPlaceIds within a single side', () => {
    const result = generateAllSignSchedules({
      instances: [SD_2],
      destinations: DESTINATIONS,
      signTypes: [SD_SIGN_TYPE],
      config: DEFAULT_SCORING_CONFIG,
      mode: 'replace-auto',
      now: NOW,
    });

    const sign = result.updatedInstances[0]!;
    for (const side of sign.sides) {
      const ids = side.destinations
        .map((d) => d.destinationPlaceId)
        .filter((id): id is string => !!id);
      const unique = new Set(ids);
      expect(ids.length).toBe(unique.size);
    }
  });

  it('produces no destinationPlaceId on more than one side', () => {
    const result = generateAllSignSchedules({
      instances: [SD_2],
      destinations: DESTINATIONS,
      signTypes: [SD_SIGN_TYPE],
      config: DEFAULT_SCORING_CONFIG,
      mode: 'replace-auto',
      now: NOW,
    });

    const sign = result.updatedInstances[0]!;
    const sideAIds = new Set(
      sign.sides[0]!.destinations
        .map((d) => d.destinationPlaceId)
        .filter((id): id is string => !!id),
    );
    const sideBIds = new Set(
      sign.sides[1]!.destinations
        .map((d) => d.destinationPlaceId)
        .filter((id): id is string => !!id),
    );
    const overlap = [...sideAIds].filter((id) => sideBIds.has(id));
    expect(overlap).toEqual([]);
  });

  it('respects SD policy cap on each side', () => {
    const result = generateAllSignSchedules({
      instances: [SD_2],
      destinations: DESTINATIONS,
      signTypes: [SD_SIGN_TYPE],
      config: DEFAULT_SCORING_CONFIG,
      mode: 'replace-auto',
      now: NOW,
    });

    const sign = result.updatedInstances[0]!;
    expect(sign.sides[0]!.destinations.length).toBeLessThanOrEqual(
      SD_POLICY_CAP,
    );
    expect(sign.sides[1]!.destinations.length).toBeLessThanOrEqual(
      SD_POLICY_CAP,
    );
  });

  it('total destinations across both sides ≤ 2 × policy cap', () => {
    const result = generateAllSignSchedules({
      instances: [SD_2],
      destinations: DESTINATIONS,
      signTypes: [SD_SIGN_TYPE],
      config: DEFAULT_SCORING_CONFIG,
      mode: 'replace-auto',
      now: NOW,
    });

    const sign = result.updatedInstances[0]!;
    const total = sign.sides.reduce((n, s) => n + s.destinations.length, 0);
    expect(total).toBeLessThanOrEqual(2 * SD_POLICY_CAP);
  });
});
