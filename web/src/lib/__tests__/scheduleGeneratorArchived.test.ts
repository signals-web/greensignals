// ─── Archived-instance pass-through in the bulk generator ──────────────────
//
// SignInstance deletion is a soft delete (`archivedAt`), and App.tsx
// hands the generator the FULL instance ledger so the wholesale
// `setInstanceStore(result.updatedInstances)` replace afterwards keeps
// archived records. This suite pins the generator's side of that
// contract: archived instances pass through `updatedInstances`
// untouched — no rows generated, no `updatedAt` bump — and they don't
// appear in any summary count (including `signsSkipped`, which feeds
// the user-facing alert).

import { describe, expect, it } from 'vitest';
import { generateAllSignSchedules } from '../scheduleGenerator.ts';
import {
  DEFAULT_SCORING_CONFIG,
  type DestinationPlace,
  type SignInstance,
} from '../../platform/index.ts';

const NOW = new Date('2026-06-10T00:00:00.000Z');
const EARLIER = '2026-06-01T00:00:00.000Z';

function makeSign(id: string, overrides: Partial<SignInstance> = {}): SignInstance {
  return {
    id,
    signTypeId: 'st-PM',
    location: '',
    lat: 42.4075,
    lng: -71.119,
    facing: 'N',
    sides: [],
    reviewStatus: 'pending',
    createdAt: EARLIER,
    updatedAt: EARLIER,
    ...overrides,
  };
}

function makeDest(): DestinationPlace {
  return {
    id: 'dest-1',
    projectId: 'p-1',
    name: 'Library',
    lat: 42.4105, // due north — squarely scoreable from a N-facing sign
    lng: -71.119,
    district: 'Academic Quad',
    tier: 'building',
    createdAt: EARLIER,
    updatedAt: EARLIER,
    createdBy: 'test',
    updatedBy: 'test',
  };
}

describe('generateAllSignSchedules — archived instances', () => {
  it('passes archived instances through untouched and still in order', () => {
    const live = makeSign('PM-1');
    const archived = makeSign('PM-2', { archivedAt: EARLIER });

    const { updatedInstances } = generateAllSignSchedules({
      instances: [live, archived],
      destinations: [makeDest()],
      signTypes: [],
      config: DEFAULT_SCORING_CONFIG,
      mode: 'replace-auto',
      now: NOW,
    });

    // Full ledger out — same length, same order, archived record is the
    // exact same object (no rows written, no updatedAt bump).
    expect(updatedInstances).toHaveLength(2);
    expect(updatedInstances[1]).toBe(archived);
    expect(updatedInstances[1]!.updatedAt).toBe(EARLIER);
    expect(updatedInstances[1]!.sides).toHaveLength(0);

    // The live sign was scheduled normally.
    const liveOut = updatedInstances[0]!;
    expect(liveOut.updatedAt).toBe(NOW.toISOString());
    const liveRows = liveOut.sides.flatMap((s) => s.destinations);
    expect(liveRows.length).toBeGreaterThan(0);
  });

  it('excludes archived instances from every summary count', () => {
    // An archived sign with no coords would have counted as "skipped"
    // before the archive check — make sure it counts as nothing at all.
    const archivedNoCoords = makeSign('PM-3', {
      archivedAt: EARLIER,
      lat: undefined,
      lng: undefined,
    });
    const live = makeSign('PM-1');

    const { summary } = generateAllSignSchedules({
      instances: [archivedNoCoords, live],
      destinations: [makeDest()],
      signTypes: [],
      config: DEFAULT_SCORING_CONFIG,
      mode: 'replace-auto',
      now: NOW,
    });

    expect(summary.signsProcessed).toBe(1);
    expect(summary.signsSkipped).toBe(0);
  });
});
