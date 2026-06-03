import { describe, expect, it } from 'vitest';
import { generateAllSignSchedules } from '../scheduleGenerator.ts';
import type {
  DestinationPlace,
  ScoringConfig,
  SignInstance,
  SignType,
} from '../../platform/index.ts';

const NOW = new Date('2026-04-26T00:00:00.000Z');

const CONFIG: ScoringConfig = {
  weights: { distance: 0.4, bearing: 0.3, tier: 0.2, district: 0.1 },
  tierMaxDistanceMeters: { campus: 1500, building: 500, room: 60 },
};

// Phase 5: generator dispatches off SignType.code → SignTypePolicy.
// Tests that don't care about per-type behaviour pass an empty array
// (DEFAULT_POLICY is used for every sign — cap=4 per side, no anchor
// filter). Tests that *do* care construct a SignType with the code
// they want and match `instance.signTypeId`.
const NO_SIGN_TYPES: SignType[] = [];

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
    signTypeId: 'st',
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

describe('generateAllSignSchedules — replace-auto (default)', () => {
  it('populates all auto rows with arrow + name + destinationPlaceId + auto:true', () => {
    const result = generateAllSignSchedules({
      instances: [sign()],
      destinations: [
        dest({ id: 'a', name: 'Library', lat: 40.001, lng: -105 }),
        dest({ id: 'b', name: 'Hall', lat: 39.999, lng: -105 }),
      ],
      config: CONFIG,
      signTypes: NO_SIGN_TYPES,
      mode: 'replace-auto',
      now: NOW,
    });
    const updated = result.updatedInstances[0]!;
    const allRows = updated.sides.flatMap((s) => s.destinations);
    expect(allRows.length).toBeGreaterThan(0);
    for (const row of allRows) {
      expect(row.auto).toBe(true);
      expect(row.destinationPlaceId).toBeTruthy();
      expect(typeof row.arrow).toBe('number');
      expect(row.name).toBeTruthy();
    }
  });

  it('keeps manual rows untouched on regeneration', () => {
    const manualRow = {
      arrow: 90,
      name: 'Custom landmark',
      // explicitly NOT auto
    };
    const result = generateAllSignSchedules({
      instances: [
        sign({
          sides: [
            { label: 'FRONT · N', destinations: [manualRow] },
            { label: 'BACK · S', destinations: [] },
          ],
        }),
      ],
      destinations: [dest({ id: 'a', name: 'Library', lat: 40.001, lng: -105 })],
      config: CONFIG,
      signTypes: NO_SIGN_TYPES,
      mode: 'replace-auto',
      now: NOW,
    });
    const updated = result.updatedInstances[0]!;
    const allRows = updated.sides.flatMap((s) => s.destinations);
    const manuals = allRows.filter((r) => r.auto !== true);
    expect(manuals).toHaveLength(1);
    expect(manuals[0]!.name).toBe('Custom landmark');
    expect(result.summary.manualRowsPreserved).toBe(1);
  });

  it('drops previously-auto rows that no longer score', () => {
    // First generation produces auto rows; second generation gets a
    // smaller candidate set — the "stale" auto rows must drop, not
    // accumulate.
    const initial = generateAllSignSchedules({
      instances: [sign()],
      destinations: [
        dest({ id: 'a', name: 'A', lat: 40.001, lng: -105 }),
        dest({ id: 'b', name: 'B', lat: 39.999, lng: -105 }),
      ],
      config: CONFIG,
      signTypes: NO_SIGN_TYPES,
      mode: 'replace-auto',
      now: NOW,
    });
    const second = generateAllSignSchedules({
      instances: initial.updatedInstances,
      destinations: [dest({ id: 'a', name: 'A', lat: 40.001, lng: -105 })],
      config: CONFIG,
      signTypes: NO_SIGN_TYPES,
      mode: 'replace-auto',
      now: NOW,
    });
    const allRows = second.updatedInstances[0]!.sides.flatMap((s) => s.destinations);
    const ids = allRows.map((r) => r.destinationPlaceId);
    expect(ids).toContain('a');
    expect(ids).not.toContain('b');
  });
});

describe('generateAllSignSchedules — replace-all', () => {
  it('wipes manual rows along with auto rows', () => {
    const result = generateAllSignSchedules({
      instances: [
        sign({
          sides: [
            {
              label: 'FRONT · N',
              destinations: [{ arrow: 90, name: 'Manual' }],
            },
            { label: 'BACK · S', destinations: [] },
          ],
        }),
      ],
      destinations: [dest({ id: 'a', name: 'A', lat: 40.001, lng: -105 })],
      config: CONFIG,
      signTypes: NO_SIGN_TYPES,
      mode: 'replace-all',
      now: NOW,
    });
    const allRows = result.updatedInstances[0]!.sides.flatMap((s) => s.destinations);
    const manuals = allRows.filter((r) => r.auto !== true);
    expect(manuals).toHaveLength(0);
    expect(result.summary.manualRowsPreserved).toBe(0);
  });
});

describe('generateAllSignSchedules — skipped signs', () => {
  it('leaves a sign with no facing untouched and counts it as skipped', () => {
    const before = sign({ id: 's-no-facing', facing: undefined });
    const result = generateAllSignSchedules({
      instances: [before],
      destinations: [dest({ id: 'a' })],
      config: CONFIG,
      signTypes: NO_SIGN_TYPES,
      mode: 'replace-auto',
      now: NOW,
    });
    expect(result.updatedInstances[0]).toBe(before);
    expect(result.summary.signsSkipped).toBe(1);
    expect(result.summary.signsProcessed).toBe(0);
  });

  it('skips signs without coords', () => {
    const result = generateAllSignSchedules({
      instances: [sign({ lat: undefined })],
      destinations: [dest({ id: 'a' })],
      config: CONFIG,
      signTypes: NO_SIGN_TYPES,
      mode: 'replace-auto',
      now: NOW,
    });
    expect(result.summary.signsSkipped).toBe(1);
  });
});

describe('generateAllSignSchedules — summary counts', () => {
  it('reports rows generated + signs processed', () => {
    const result = generateAllSignSchedules({
      instances: [
        sign({ id: 's-1' }),
        sign({ id: 's-2', lat: 40.0001, lng: -104.999 }),
      ],
      destinations: [
        dest({ id: 'a', name: 'A', lat: 40.001, lng: -105 }),
        dest({ id: 'b', name: 'B', lat: 39.999, lng: -105 }),
      ],
      config: CONFIG,
      signTypes: NO_SIGN_TYPES,
      mode: 'replace-auto',
      now: NOW,
    });
    expect(result.summary.signsProcessed).toBe(2);
    expect(result.summary.rowsGenerated).toBeGreaterThan(0);
  });

  it('respects per-policy cap when a SignType policy applies', () => {
    // Phase 5: cap moved from ScoringConfig to per-sign-type policy.
    // 'N' (Nudge) → cap=3 per side from DEFAULTS_BY_CODE. With cap × 2
    // sides = 6 and 12 forward-clustered candidates, we expect ≤ 6.
    const candidates = Array.from({ length: 12 }, (_, i) =>
      dest({ id: `f-${i}`, lat: 40.001 + i * 0.0001, lng: -105 + i * 0.0001 }),
    );
    const nudge: SignType = {
      id: 'st-N',
      code: 'N',
      name: 'Nudge',
      category: 'directional',
      dimensionsMM: { w: 1500, h: 450, d: 60 },
      copy: [],
      materials: [],
      mountType: 'post',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    };
    const result = generateAllSignSchedules({
      instances: [sign({ signTypeId: 'st-N' })],
      destinations: candidates,
      signTypes: [nudge],
      config: CONFIG,
      mode: 'replace-auto',
      now: NOW,
    });
    const allRows = result.updatedInstances[0]!.sides.flatMap(
      (s) => s.destinations,
    );
    expect(allRows.length).toBeLessThanOrEqual(6);
  });
});

describe('generateAllSignSchedules — idempotency', () => {
  it('produces the same destinations on a second run with identical inputs', () => {
    const args = {
      instances: [sign()],
      destinations: [
        dest({ id: 'a', name: 'A', lat: 40.001, lng: -105 }),
        dest({ id: 'b', name: 'B', lat: 40.0005, lng: -104.9999 }),
      ],
      config: CONFIG,
      signTypes: NO_SIGN_TYPES,
      mode: 'replace-auto' as const,
      now: NOW,
    };
    const first = generateAllSignSchedules(args);
    const second = generateAllSignSchedules({
      ...args,
      instances: first.updatedInstances,
    });
    const ids1 = first.updatedInstances[0]!.sides
      .flatMap((s) => s.destinations.map((d) => d.destinationPlaceId))
      .sort();
    const ids2 = second.updatedInstances[0]!.sides
      .flatMap((s) => s.destinations.map((d) => d.destinationPlaceId))
      .sort();
    expect(ids2).toEqual(ids1);
  });
});
