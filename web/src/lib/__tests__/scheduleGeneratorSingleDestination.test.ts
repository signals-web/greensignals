// ─── Single-destination regression — "Embrace ×N" (2026-05-29 triage) ───
//
// B1/B3 testing reported that entering ONE destination ("Embrace")
// populated ALL repeater rows on Side A and Side B instead of one row.
// The underlying duplication path was the splitSides() perpendicular
// branch fanning a row onto both faces, fixed by the bulk generator's
// post-splitSides dedup (see scheduleGeneratorDuplicates.test.ts for
// the multi-destination CU Boulder repro). This file pins the triage
// item's exact shape: with a single candidate destination, the
// generator must emit AT MOST ONE row for it — total, across both
// sides — including the perpendicular bearing that used to fan out,
// and including repeated regeneration (rows must not accumulate).
//
// Auto-population stays: the fix is dedup, not making rows manual.

import { describe, expect, it } from 'vitest';
import { generateAllSignSchedules } from '../scheduleGenerator.ts';
import {
  DEFAULT_SCORING_CONFIG,
  type DestinationPlace,
  type SignInstance,
} from '../../platform/index.ts';

const NOW = new Date('2026-06-10T00:00:00.000Z');

function makeSign(facing: 'N'): SignInstance {
  return {
    id: 'tufts-sign-PM-1',
    signTypeId: 'tufts-st-PM',
    location: '',
    lat: 42.4075,
    lng: -71.119,
    facing,
    sides: [],
    reviewStatus: 'pending',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

function makeEmbrace(input: { lat: number; lng: number }): DestinationPlace {
  return {
    id: 'tufts-dest-embrace',
    projectId: 'tufts-demo',
    name: 'Embrace',
    lat: input.lat,
    lng: input.lng,
    district: 'Academic Quad',
    tier: 'building',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    createdBy: 'test',
    updatedBy: 'test',
  };
}

/** Count rows across BOTH sides that reference the destination. */
function embraceRowCount(instance: SignInstance): number {
  return instance.sides
    .flatMap((s) => s.destinations)
    .filter((d) => d.destinationPlaceId === 'tufts-dest-embrace').length;
}

function generate(sign: SignInstance, dest: DestinationPlace) {
  return generateAllSignSchedules({
    instances: [sign],
    destinations: [dest],
    signTypes: [], // DEFAULT_POLICY — capacityPerSide 4, the "4 repeater rows"
    config: DEFAULT_SCORING_CONFIG,
    mode: 'replace-auto',
    now: NOW,
  });
}

describe('single destination ("Embrace") populates at most one repeater row', () => {
  it('destination ahead of a N-facing sign → exactly one row, one side', () => {
    const sign = makeSign('N');
    // Due north of the sign — squarely in the front sector.
    const dest = makeEmbrace({ lat: sign.lat! + 0.003, lng: sign.lng! });

    const { updatedInstances } = generate(sign, dest);
    const out = updatedInstances[0];

    expect(embraceRowCount(out)).toBe(1);
    const sidesWithIt = out.sides.filter((s) =>
      s.destinations.some((d) => d.destinationPlaceId === 'tufts-dest-embrace'),
    );
    expect(sidesWithIt).toHaveLength(1);
  });

  it('perpendicular destination (the historical fan-out trigger) → at most one row total', () => {
    const sign = makeSign('N');
    // Due east of the sign — ~90° off facing, the splitSides branch
    // that used to push the row onto BOTH faces.
    const dest = makeEmbrace({ lat: sign.lat!, lng: sign.lng! + 0.003 });

    const { updatedInstances } = generate(sign, dest);
    expect(embraceRowCount(updatedInstances[0])).toBeLessThanOrEqual(1);
  });

  it('regeneration is idempotent — rows never accumulate across runs', () => {
    const sign = makeSign('N');
    const dest = makeEmbrace({ lat: sign.lat! + 0.003, lng: sign.lng! });

    const first = generate(sign, dest);
    const second = generate(first.updatedInstances[0], dest);
    const third = generate(second.updatedInstances[0], dest);

    expect(embraceRowCount(third.updatedInstances[0])).toBe(1);
    // No side ever exceeds the policy cap.
    for (const side of third.updatedInstances[0].sides) {
      expect(side.destinations.length).toBeLessThanOrEqual(4);
    }
  });
});
