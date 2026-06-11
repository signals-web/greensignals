// Regression test for the lock-toggle bug: clicking the SignCard
// padlock persisted `directionLocked` to localStorage but the icon
// never re-rendered. Root cause was in `lib/instances.ts` —
// `updateInstance` mutates the cached `_instances` array in place,
// then `notify()` passed the same array reference to every
// subscriber. App.tsx's React state setter (`setInstances`) bails
// out on identity (`Object.is(prev, next)`), so the re-render never
// happened.
//
// The fix: `notify()` emits a fresh array snapshot. This test pins
// that contract — every subscriber callback must receive a NEW array
// reference after a mutating helper runs. Apply to `addInstance`,
// `updateInstance`, and `deleteInstance`. (`resetInstances` and
// `setInstances` already replace `_instances` outright, so they
// inherit the fix for free.)
//
// localStorage shim baked in for the node test env (mirrors the
// pattern in scheduleGeneratorPersistence.test.ts).

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
  updateInstance,
  addInstance,
  deleteInstance,
  resetInstances,
  subscribeInstances,
} = await import('../instances.ts');

const NOW = '2026-04-27T00:00:00.000Z';

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
    createdAt: NOW,
    updatedAt: NOW,
    directionLocked: false,
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

describe('subscribeInstances — fresh array reference on every notify', () => {
  it('updateInstance fires subscribers with a NEW array reference', () => {
    setInstances([sign({ id: 's-1', directionLocked: false })]);

    const seen: SignInstance[][] = [];
    const unsub = subscribeInstances((insts) => {
      seen.push(insts);
    });
    // First emission is the initial sync call inside subscribeInstances.
    expect(seen).toHaveLength(1);
    const initialRef = seen[0]!;

    updateInstance('s-1', { directionLocked: true });

    expect(seen).toHaveLength(2);
    // The second emission MUST be a different array reference, otherwise
    // React's setState bails on identity and the UI never re-renders.
    // This is the bug Chris hit with the padlock toggle.
    expect(seen[1]).not.toBe(initialRef);
    expect(seen[1]![0]!.directionLocked).toBe(true);
    unsub();
  });

  it('addInstance fires subscribers with a NEW array reference', () => {
    setInstances([sign({ id: 's-1' })]);

    const seen: SignInstance[][] = [];
    subscribeInstances((insts) => {
      seen.push(insts);
    });
    const initialRef = seen[0]!;

    addInstance('st', 40.1, -105.1, 'PM');

    expect(seen).toHaveLength(2);
    expect(seen[1]).not.toBe(initialRef);
    expect(seen[1]).toHaveLength(2);
  });

  it('deleteInstance fires subscribers with a NEW array reference', () => {
    setInstances([sign({ id: 's-1' }), sign({ id: 's-2' })]);

    const seen: SignInstance[][] = [];
    subscribeInstances((insts) => {
      seen.push(insts);
    });
    const initialRef = seen[0]!;

    deleteInstance('s-1');

    expect(seen).toHaveLength(2);
    expect(seen[1]).not.toBe(initialRef);
    // Soft delete — the record stays in the ledger with `archivedAt`
    // set; consumers filter it out of user-facing views. See
    // instancesArchive.test.ts for the full archive contract.
    expect(seen[1]).toHaveLength(2);
    expect(seen[1]!.find((i) => i.id === 's-1')!.archivedAt).toBeTruthy();
    expect(seen[1]!.find((i) => i.id === 's-2')!.archivedAt).toBeUndefined();
  });

  it('the directionLocked toggle scenario specifically — flips and notifies', () => {
    // Mirrors what happens when Chris clicks the padlock in SignCard:
    //   1. SignCard's onClick calls updateInstance(id, { directionLocked: !current }).
    //   2. updateInstance mutates the store and calls notify().
    //   3. App.tsx's setInstances runs with the new array.
    //   4. SignCard re-renders with the updated instance, showing the
    //      flipped icon.
    //
    // Step 3 was silently bailing out before the fix.
    setInstances([sign({ id: 's-1', directionLocked: false })]);

    const seen: boolean[] = [];
    subscribeInstances((insts) => {
      const inst = insts.find((i) => i.id === 's-1');
      if (inst) seen.push(inst.directionLocked ?? false);
    });

    updateInstance('s-1', { directionLocked: true });
    updateInstance('s-1', { directionLocked: false });

    expect(seen).toEqual([false, true, false]);
  });
});
