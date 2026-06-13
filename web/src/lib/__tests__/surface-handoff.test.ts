// DIAGNOSE-V2 (2026-06-13) — the "Open in Surface" envelope contract.
//
// Both entry points (SignCard's "Open in Surface →" and SignTypeEdit's
// "Open in Surface ↗") now route through `buildSurfaceHandoffUrl`. This is the
// Signal half of the cross-boundary net: it asserts the EMITTED envelope
// carries the placed instances with every destination linked
// (`destinationPlaceId` set). The Surface half
// (`surface/.../b1-cabinet-handoff-repro.test.ts`) takes such an envelope and
// proves the instance slots fill. Together they fence the seam where Chris saw
// empty slots.

import { describe, it, expect } from 'vitest';
import type { SignInstance, SignSide } from '../../platform/index.ts';
import { decodeSignTypeFromHandoff } from '../../platform/index.ts';
import {
  linkInstancesForHandoff,
  buildSurfaceHandoffUrl,
} from '../surface-handoff.ts';

const SURFACE_URL = 'http://localhost:5174';

const signType = {
  id: 'st-1',
  code: 'D-01',
  name: 'Wayfinding',
  category: 'directional',
  dimensionsMM: { w: 600, h: 1800, d: 200 },
  copy: [],
  materials: [],
  mountType: 'ground',
  createdAt: '2026-06-13T00:00:00.000Z',
  updatedAt: '2026-06-13T00:00:00.000Z',
} as unknown as Parameters<typeof buildSurfaceHandoffUrl>[0]['signType'];

const side = (
  label: string,
  dests: { name: string; destinationPlaceId?: string }[],
): SignSide =>
  ({
    label,
    destinations: dests.map((d) => ({ arrow: 0, walkTime: '~2 min', ...d })),
  }) as SignSide;

function inst(id: string, sides: SignSide[]): SignInstance {
  return {
    id,
    signTypeId: 'st-1',
    location: 'Quad',
    lat: 42.4,
    lng: -71.1,
    sides,
    reviewStatus: 'pending',
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:00:00.000Z',
  } as unknown as SignInstance;
}

/** All destinationPlaceIds across an instance, undefined included. */
const placeIds = (i: SignInstance) =>
  (i.sides ?? []).flatMap((s) => s.destinations.map((d) => d.destinationPlaceId));

describe('linkInstancesForHandoff', () => {
  it('links every still-unlinked destination via ensurePlaces (the gap that left Surface slots empty)', async () => {
    const a = inst('a', [
      side('A', [{ name: 'Eaton Hall' }, { name: 'Goddard Chapel' }]),
      side('B', [{ name: 'Tisch Library' }]),
    ]);
    const persisted: string[] = [];
    // ensurePlaces resolves names → existing places (Chris's case: every name
    // already exists among the imported buildings, so nothing is created).
    const linked = await linkInstancesForHandoff({
      instances: [a],
      ensurePlaces: async (names) =>
        names.map((n) => ({ id: `dp-${n.toLowerCase().replace(/\s+/g, '-')}` })) as never,
      persistInstance: (id) => persisted.push(id),
    });
    expect(placeIds(linked[0]!)).toEqual([
      'dp-eaton-hall',
      'dp-goddard-chapel',
      'dp-tisch-library',
    ]);
    expect(persisted).toEqual(['a']); // changed → persisted once
  });

  it('best-effort: no ensurePlaces callback leaves instances untouched (does not throw)', async () => {
    const a = inst('a', [side('A', [{ name: 'Eaton Hall' }])]);
    const linked = await linkInstancesForHandoff({ instances: [a] });
    expect(linked[0]).toBe(a);
  });

  it('preserves destinations already linked', async () => {
    const a = inst('a', [
      side('A', [{ name: 'Tisch Library', destinationPlaceId: 'dp-keep' }]),
    ]);
    const linked = await linkInstancesForHandoff({
      instances: [a],
      ensurePlaces: async () => [],
    });
    expect(placeIds(linked[0]!)).toEqual(['dp-keep']);
  });
});

describe('buildSurfaceHandoffUrl — emitted envelope', () => {
  it('carries the placed instances with destinations linked (decodes round-trip)', async () => {
    const a = inst('a', [
      side('A', [{ name: 'Eaton Hall' }, { name: 'Goddard Chapel' }]),
    ]);
    const url = await buildSurfaceHandoffUrl({
      surfaceUrl: SURFACE_URL,
      signType,
      projectId: 'proj-1',
      instances: [a],
      ensurePlaces: async (names) =>
        names.map((n) => ({ id: `dp-${n.toLowerCase().replace(/\s+/g, '-')}` })) as never,
      persistInstance: () => {},
    });

    const param = new URL(url).searchParams.get('fromSignal');
    expect(param).toBeTruthy();
    const decoded = decodeSignTypeFromHandoff(param!);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    // The whole point: the envelope is NOT empty (the old SignTypeEdit bug)
    // and every destination it carries is linked (the router requirement).
    expect(decoded.value.instances).toHaveLength(1);
    const ids = placeIds(decoded.value.instances[0]!);
    expect(ids).toEqual(['dp-eaton-hall', 'dp-goddard-chapel']);
    expect(ids.every((id) => typeof id === 'string')).toBe(true);
  });
});
