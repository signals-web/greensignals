// ─── Soft-delete (archive) contract for the instance store ─────────────────
//
// SignInstance deletion used to be a hard delete — `deleteInstance`
// spliced the array and the record was gone from localStorage forever.
// Every other platform entity (SignType, DestinationPlace, Brand)
// soft-deletes via an optional `archivedAt` timestamp plus
// list-filtering. This suite pins the aligned behaviour:
//
//   - deleteInstance sets `archivedAt` (and bumps `updatedAt`) instead
//     of removing the record,
//   - the record survives in the store and in localStorage,
//   - deleting an unknown or already-archived id is a no-op returning
//     false,
//   - archived IDs stay reserved — addInstance's per-prefix numbering
//     never reuses them.
//
// localStorage shim baked in for the node test env (mirrors the
// pattern in instancesNotify.test.ts).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SignInstance } from '../../platform/index.ts';

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

const {
  setInstances,
  getInstances,
  deleteInstance,
  addInstance,
  updateInstance,
  resetInstances,
} = await import('../instances.ts');

const NOW = '2026-06-10T00:00:00.000Z';

function sign(overrides: Partial<SignInstance> = {}): SignInstance {
  return {
    id: 'MAP-01',
    signTypeId: 'st-map',
    location: '',
    lat: 40,
    lng: -105,
    facing: 'N',
    sides: [],
    reviewStatus: 'pending',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  shim.clear();
  resetInstances();
});

afterEach(() => {
  resetInstances();
});

describe('deleteInstance — soft delete via archivedAt', () => {
  it('sets archivedAt and updatedAt instead of removing the record', () => {
    setInstances([sign({ id: 'MAP-01' }), sign({ id: 'MAP-02' })]);

    expect(deleteInstance('MAP-01')).toBe(true);

    const all = getInstances();
    expect(all).toHaveLength(2);
    const archived = all.find((i) => i.id === 'MAP-01')!;
    expect(archived.archivedAt).toBeTruthy();
    expect(archived.updatedAt).toBe(archived.archivedAt);
    expect(archived.updatedAt).not.toBe(NOW);
    expect(all.find((i) => i.id === 'MAP-02')!.archivedAt).toBeUndefined();
  });

  it('persists the archived record to localStorage', () => {
    setInstances([sign({ id: 'MAP-01' })]);
    deleteInstance('MAP-01');

    const raw = shim.getItem('sosisu:signal:instances:v1');
    expect(raw).toBeTruthy();
    const persisted = JSON.parse(raw!) as SignInstance[];
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.id).toBe('MAP-01');
    expect(persisted[0]!.archivedAt).toBeTruthy();
  });

  it('returns false for an unknown id', () => {
    setInstances([sign({ id: 'MAP-01' })]);
    expect(deleteInstance('PED-99')).toBe(false);
  });

  it('is idempotent — re-deleting an archived instance is a no-op', () => {
    setInstances([sign({ id: 'MAP-01' })]);

    expect(deleteInstance('MAP-01')).toBe(true);
    const firstStamp = getInstances()[0]!.archivedAt;

    expect(deleteInstance('MAP-01')).toBe(false);
    expect(getInstances()[0]!.archivedAt).toBe(firstStamp);
  });

  it('updateInstance still reaches archived records (un-delete tooling path)', () => {
    setInstances([sign({ id: 'MAP-01' })]);
    deleteInstance('MAP-01');

    const updated = updateInstance('MAP-01', { notes: 'still editable' });
    expect(updated?.notes).toBe('still editable');
    expect(updated?.archivedAt).toBeTruthy();
  });
});

describe('addInstance — archived IDs stay reserved', () => {
  it('per-prefix numbering counts archived instances, never reusing their IDs', () => {
    setInstances([sign({ id: 'MAP-01' }), sign({ id: 'MAP-02' }), sign({ id: 'MAP-03' })]);
    deleteInstance('MAP-03');

    const next = addInstance('st-map', 40.1, -105.1, 'MAP');
    expect(next.id).toBe('MAP-04');

    // Exactly one record per ID — the archived MAP-03 was not replaced.
    const ids = getInstances().map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('MAP-03');
  });
});
