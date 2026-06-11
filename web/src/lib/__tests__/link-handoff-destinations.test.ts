// DIAGNOSE-V2 — handoff-boundary destination linking helpers.

import { describe, it, expect } from 'vitest';
import type { SignInstance, SignSide } from '../../platform/index.ts';
import {
  collectUnlinkedNames,
  pickStubCoords,
  linkInstanceByName,
} from '../link-handoff-destinations.ts';

function inst(
  id: string,
  sides: SignSide[],
  coords?: { lat: number; lng: number },
): SignInstance {
  return {
    id,
    signTypeId: 'st',
    sides,
    reviewStatus: 'pending',
    createdAt: '2026-06-11T00:00:00.000Z',
    updatedAt: '2026-06-11T00:00:00.000Z',
    ...(coords ?? {}),
  } as unknown as SignInstance;
}

const side = (label: string, dests: { name: string; destinationPlaceId?: string }[]): SignSide =>
  ({ label, destinations: dests.map((d) => ({ arrow: 0, walkTime: '', ...d })) } as SignSide);

describe('collectUnlinkedNames', () => {
  it('returns distinct typed names that have no destinationPlaceId', () => {
    const a = inst('a', [
      side('FRONT', [{ name: 'Packard Hall' }, { name: 'Tisch Library', destinationPlaceId: 'dp-1' }]),
      side('BACK', [{ name: 'Goddard Chapel' }]),
    ]);
    const b = inst('b', [side('FRONT', [{ name: 'packard hall' }, { name: 'Eaton Hall' }])]);
    // Packard Hall appears twice (different case) → one entry; Tisch is linked → excluded.
    expect(collectUnlinkedNames([a, b])).toEqual(['Packard Hall', 'Goddard Chapel', 'Eaton Hall']);
  });
  it('ignores blank names and already-linked rows', () => {
    const a = inst('a', [side('FRONT', [{ name: '   ' }, { name: 'Linked', destinationPlaceId: 'dp-9' }])]);
    expect(collectUnlinkedNames([a])).toEqual([]);
  });
});

describe('pickStubCoords', () => {
  it('returns the first instance carrying both lat and lng', () => {
    const a = inst('a', []);
    const b = inst('b', [], { lat: 42.4, lng: -71.1 });
    expect(pickStubCoords([a, b])).toEqual({ lat: 42.4, lng: -71.1 });
  });
  it('returns null when no instance has coords', () => {
    expect(pickStubCoords([inst('a', []), inst('b', [])])).toBeNull();
  });
});

describe('linkInstanceByName', () => {
  const map = new Map<string, string>([
    ['packard hall', 'dp-packard'],
    ['goddard chapel', 'dp-goddard'],
  ]);

  it('stamps destinationPlaceId onto matching unlinked rows by name', () => {
    const a = inst('a', [
      side('FRONT', [{ name: 'Packard Hall' }, { name: 'Unknown Place' }]),
      side('BACK', [{ name: 'Goddard Chapel' }]),
    ]);
    const { instance, changed } = linkInstanceByName(a, map);
    expect(changed).toBe(true);
    expect(instance.sides[0].destinations[0].destinationPlaceId).toBe('dp-packard');
    expect(instance.sides[0].destinations[1].destinationPlaceId).toBeUndefined(); // no map entry
    expect(instance.sides[1].destinations[0].destinationPlaceId).toBe('dp-goddard');
  });

  it('preserves existing links and returns the same reference when nothing changes', () => {
    const a = inst('a', [side('FRONT', [{ name: 'Tisch', destinationPlaceId: 'dp-keep' }])]);
    const { instance, changed } = linkInstanceByName(a, map);
    expect(changed).toBe(false);
    expect(instance).toBe(a); // referentially identical → caller skips persist
  });
});
