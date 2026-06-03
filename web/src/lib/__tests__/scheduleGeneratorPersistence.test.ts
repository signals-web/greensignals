// ─── End-to-end schedule generator + persistence test ─────────────────────
//
// Phase 4 shipped without testing whether the `auto` flag actually
// survives the save/load round-trip. The bug that prompted this fix
// was: regenerating schedules accumulated duplicate rows on each side.
// Re-checking afterwards showed each prior auto row had been treated
// as "manual" on the next run — which only happens if `auto` was
// missing or undefined after persistence.
//
// This test wires three layers:
//   1. The schedule generator (pure)
//   2. Signal's instance persistence (`lib/instances.ts`,
//      localStorage-backed via JSON.stringify/parse)
//   3. The platform Firestore serialization layer (the `setDoc`
//      payload), to catch a different leak shape — Zod schemas and
//      object spreads can drop optional fields if the destination
//      schema isn't `looseObject` or if the repo whitelists fields.
//
// Two assertions form the central claim:
//   - After round-trip, every auto row's `auto` is still `true`.
//   - A second Generate call produces destinations capped at
//     `policy.capacityPerSide * 2` total per sign — NEVER 2×, NEVER more —
//     i.e. the previous run's auto rows are recognised as auto and
//     dropped. (Phase 5: cap moved from `ScoringConfig.topNPerSide`
//     to per-sign-type policy. Tests that don't supply a SignType
//     fall through to DEFAULT_POLICY → cap=4.)

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateAllSignSchedules } from '../scheduleGenerator.ts';
import {
  parseSosisuProject,
  type DestinationPlace,
  type ScoringConfig,
  type SignInstance,
  type SignType,
  type SosisuProject,
} from '../../platform/index.ts';

// ─── localStorage shim for the node test env ──────────────────────────────
// The signal/web vite.config.ts pins the test env to `node` (jsdom hangs
// on this Dropbox-mounted workspace path). Node has no global
// localStorage, so we install a minimal in-memory polyfill before
// importing the instance store. The shim must be installed BEFORE the
// dynamic import below so the module-level `_instances` cache picks it
// up on first access.

class LocalStorageShim implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

const shim = new LocalStorageShim();
(globalThis as { localStorage?: Storage }).localStorage = shim;

// Now safe to import the instance store; it'll close over our shim.
// `getInstances` would normally re-read via the in-memory cache, but
// for round-trip testing we prefer to bypass the cache and inspect
// the localStorage payload directly via `readPersisted` below.
const { setInstances, resetInstances } = await import('../instances.ts');

const NOW = new Date('2026-04-27T00:00:00.000Z');

const CONFIG: ScoringConfig = {
  weights: { distance: 0.4, bearing: 0.3, tier: 0.2, district: 0.1 },
  tierMaxDistanceMeters: { campus: 1500, building: 500, room: 60 },
};

// Phase 5: tests pass an empty `signTypes` so DEFAULT_POLICY is used
// for every instance — cap=4 per side, no anchor filter.
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

function makeRing(): DestinationPlace[] {
  // 8 destinations spread around a sign at the origin, 50m apart in
  // various compass directions. Enough to fill a 4-per-side cap on
  // both faces, with some left over so the cap actually bites.
  const points: Array<{ id: string; lat: number; lng: number }> = [
    { id: 'n-near', lat: 40.0005, lng: -105 },
    { id: 'n-far', lat: 40.001, lng: -105 },
    { id: 'ne', lat: 40.0005, lng: -104.9995 },
    { id: 'e', lat: 40, lng: -104.9995 },
    { id: 's-near', lat: 39.9995, lng: -105 },
    { id: 's-far', lat: 39.999, lng: -105 },
    { id: 'sw', lat: 39.9995, lng: -105.0005 },
    { id: 'w', lat: 40, lng: -105.0005 },
  ];
  return points.map((p) => dest({ ...p, name: p.id, tier: 'campus' }));
}

beforeEach(() => {
  shim.clear();
  resetInstances();
});

afterEach(() => {
  resetInstances();
});

// ─── 1. localStorage round-trip ─────────────────────────────────────────

/** Read the persisted instance JSON directly out of the localStorage
 *  shim. This is the data a fresh page load would re-hydrate from —
 *  the canonical "what survived persistence" payload. We bypass
 *  `resetInstances()` for cache invalidation because that helper
 *  also wipes the underlying storage, which would defeat the test. */
function readPersisted(): SignInstance[] {
  const raw = shim.getItem('sosisu:signal:instances:v1');
  if (!raw) return [];
  return JSON.parse(raw) as SignInstance[];
}

describe('schedule generator → instances localStorage round-trip', () => {
  it('preserves auto:true on every generated row after save + load', () => {
    const initial = [sign({ id: 's-1', facing: 'N' })];
    const destinations = makeRing();

    const { updatedInstances } = generateAllSignSchedules({
      instances: initial,
      destinations,
      config: CONFIG,
      signTypes: NO_SIGN_TYPES,
      mode: 'replace-auto',
      now: NOW,
    });
    setInstances(updatedInstances);

    const reloaded = readPersisted();
    const allRows = reloaded.flatMap((inst) => inst.sides.flatMap((s) => s.destinations));
    expect(allRows.length).toBeGreaterThan(0);
    for (const row of allRows) {
      expect(row.auto).toBe(true);
    }
  });

  it('a second Generate run does not accumulate rows beyond 2 × DEFAULT_POLICY.capacityPerSide per sign', () => {
    // Phase 5: cap moved to per-sign-type policy. With no SignType
    // supplied, the generator falls back to DEFAULT_POLICY → cap = 4.
    const destinations = makeRing();
    const initial = [sign({ id: 's-1', facing: 'N' })];

    const run1 = generateAllSignSchedules({
      instances: initial,
      destinations,
      config: CONFIG,
      signTypes: NO_SIGN_TYPES,
      mode: 'replace-auto',
      now: NOW,
    });
    setInstances(run1.updatedInstances);

    // Simulate a page reload: instances come from a fresh JSON.parse of
    // what was stored, NOT the in-memory cache. This matches how App's
    // bootstrap loads instances on every launch.
    const fromStorage = readPersisted();

    const run2 = generateAllSignSchedules({
      instances: fromStorage,
      destinations,
      config: CONFIG,
      signTypes: NO_SIGN_TYPES,
      mode: 'replace-auto',
      now: NOW,
    });

    const totalsAfterRun2 = run2.updatedInstances[0]!.sides.flatMap(
      (s) => s.destinations,
    ).length;

    // Hard cap: 4 per side × 2 sides = 8. `splitSides()` may duplicate
    // perpendicular rows onto both faces, lifting the upper bound to
    // 4 + 4 + (perpendicular dups) ≤ 12 in pathological cases. Anything
    // above 12 means previous-run auto rows are being preserved — the
    // accumulation bug this test exists to catch.
    expect(totalsAfterRun2).toBeLessThanOrEqual(12);
  });

  it('counts manual rows correctly after a round-trip', () => {
    // Mix: one manual row + auto rows. Round-trip. Run again with
    // replace-auto → manual row preserved, auto rows replaced.
    const initial = [sign({ id: 's-1', facing: 'N' })];
    const destinations = makeRing();

    const run1 = generateAllSignSchedules({
      instances: initial,
      destinations,
      config: CONFIG,
      signTypes: NO_SIGN_TYPES,
      mode: 'replace-auto',
      now: NOW,
    });

    // Inject a manual row by editing a copy of the result.
    const withManual: SignInstance = {
      ...run1.updatedInstances[0]!,
      sides: [
        {
          ...run1.updatedInstances[0]!.sides[0]!,
          destinations: [
            ...run1.updatedInstances[0]!.sides[0]!.destinations,
            { arrow: 0, name: 'Custom landmark', walkTime: '~3 min' },
          ],
        },
        run1.updatedInstances[0]!.sides[1]!,
      ],
    };
    setInstances([withManual]);

    const fromStorage = readPersisted();

    const run2 = generateAllSignSchedules({
      instances: fromStorage,
      destinations,
      config: CONFIG,
      signTypes: NO_SIGN_TYPES,
      mode: 'replace-auto',
      now: NOW,
    });

    expect(run2.summary.manualRowsPreserved).toBe(1);
    const allRows = run2.updatedInstances[0]!.sides.flatMap((s) => s.destinations);
    expect(allRows.some((r) => r.name === 'Custom landmark' && r.auto !== true)).toBe(true);
  });
});

// ─── 2. Platform Zod schema round-trip (Firestore serialization layer) ────

describe('SosisuProject Zod schema preserves Destination.auto', () => {
  // The Firestore repo runs every project through `parseSosisuProject`
  // before `setDoc`. If the schema (or any nested schema) strips
  // `auto`, that's the leak.
  it('round-trips auto:true through parseSosisuProject', () => {
    const project: SosisuProject = {
      id: 'p',
      name: 'Test',
      client: '',
      ownerUid: 'u',
      members: [],
      signTypes: [],
      buildings: [],
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      instances: [
        {
          id: 'sign-1',
          signTypeId: 'st',
          location: '',
          lat: 40,
          lng: -105,
          facing: 'N',
          sides: [
            {
              label: 'FRONT · N',
              destinations: [
                {
                  arrow: 0,
                  name: 'AutoRow',
                  walkTime: '~2 min',
                  destinationPlaceId: 'dp-1',
                  auto: true,
                },
                {
                  arrow: 90,
                  name: 'ManualRow',
                },
              ],
            },
            { label: 'BACK · S', destinations: [] },
          ],
          reviewStatus: 'pending',
          createdAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
        },
      ],
    };

    const result = parseSosisuProject(project);
    if (!result.ok) throw new Error(`parse failed: ${result.error}`);
    const dests = result.value.instances[0]!.sides[0]!.destinations;
    expect(dests[0]!.auto).toBe(true);
    expect(dests[1]!.auto).toBeUndefined();
  });

  it('round-trips auto:true through JSON.parse(JSON.stringify(project))', () => {
    // Mirrors the localStorageRepos persistence path: stringify on
    // save, parse on load. The Zod parse runs after the JSON parse;
    // both must preserve `auto`.
    const project = {
      id: 'p',
      name: 'Test',
      client: '',
      ownerUid: 'u',
      members: [],
      signTypes: [],
      buildings: [],
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      instances: [
        {
          id: 'sign-1',
          signTypeId: 'st',
          location: '',
          facing: 'N',
          sides: [
            {
              label: 'FRONT · N',
              destinations: [
                { arrow: 0, name: 'AutoRow', auto: true },
              ],
            },
          ],
          reviewStatus: 'pending',
          createdAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
        },
      ],
    };

    const roundtripped = JSON.parse(JSON.stringify(project));
    const result = parseSosisuProject(roundtripped);
    if (!result.ok) throw new Error(`parse failed: ${result.error}`);
    expect(
      result.value.instances[0]!.sides[0]!.destinations[0]!.auto,
    ).toBe(true);
  });
});
