// ─── Inset map bounds tests — Phase 5c follow-up ─────────────────────────
//
// Pins the auto-fit bounding-box helper SignCard hands to maplibre's
// `fitBounds`. The contract is straightforward: include the sign's
// coords + every linked destination's canonical coords; widen as
// destinations spread further; collapse to the sign when none match.
//
// Pure-function tests against fixtures, no DOM / map needed.

import { describe, expect, it } from 'vitest';
import { computeInsetBounds } from '../insetMapBounds.ts';
import type { DestinationPlace } from '../../platform/index.ts';

const NOW = '2026-04-29T00:00:00.000Z';

function dp(overrides: Partial<DestinationPlace> & {
  id: string;
  name: string;
  lat: number;
  lng: number;
}): DestinationPlace {
  return {
    projectId: 'p',
    tier: 'building',
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: 't',
    updatedBy: 't',
    ...overrides,
  } satisfies DestinationPlace;
}

describe('computeInsetBounds — covers sign + every destination', () => {
  it('expands box to include destinations spread NE and SW of the sign', () => {
    const sign = { lat: 40.0, lng: -105.0 };
    const ne = dp({
      id: 'dp-ne',
      name: 'NE',
      lat: 40.01,
      lng: -104.99,
    });
    const sw = dp({
      id: 'dp-sw',
      name: 'SW',
      lat: 39.99,
      lng: -105.01,
    });
    const [[swLng, swLat], [neLng, neLat]] = computeInsetBounds(
      sign,
      [
        { destinationPlaceId: 'dp-ne' },
        { destinationPlaceId: 'dp-sw' },
      ],
      [ne, sw],
    );
    expect(swLat).toBe(39.99);
    expect(swLng).toBe(-105.01);
    expect(neLat).toBe(40.01);
    expect(neLng).toBe(-104.99);
  });

  it('worst-case Map sign: anchors campus-wide expand the box accordingly', () => {
    // Mimics M-1: anchors ~4-10 min walk away in different directions.
    const sign = { lat: 40.0114, lng: -105.276 };
    const macky = dp({ id: 'dp-macky', name: 'Macky', lat: 40.0099, lng: -105.2706 });
    const oldMain = dp({ id: 'dp-old', name: 'Old Main', lat: 40.008, lng: -105.272 });
    const ekeley = dp({ id: 'dp-ekeley', name: 'Ekeley', lat: 40.012, lng: -105.265 });
    const imig = dp({ id: 'dp-imig', name: 'Imig', lat: 40.014, lng: -105.273 });

    const [sw, ne] = computeInsetBounds(
      sign,
      [
        { destinationPlaceId: 'dp-macky' },
        { destinationPlaceId: 'dp-old' },
        { destinationPlaceId: 'dp-ekeley' },
        { destinationPlaceId: 'dp-imig' },
      ],
      [macky, oldMain, ekeley, imig],
    );
    // Box must contain every dp + the sign. Anything tighter would
    // clip a dot outside the inset.
    expect(sw[1]).toBeLessThanOrEqual(40.008); // min lat = oldMain
    expect(ne[1]).toBeGreaterThanOrEqual(40.014); // max lat = imig
    expect(sw[0]).toBeLessThanOrEqual(-105.276); // min lng = sign
    expect(ne[0]).toBeGreaterThanOrEqual(-105.265); // max lng = ekeley
  });

  it('Nudge-style tight cluster: small box just around the cluster', () => {
    const sign = { lat: 40.01149515, lng: -105.2759416 };
    const near1 = dp({ id: 'dp-1', name: 'Near 1', lat: 40.01155, lng: -105.27595 });
    const near2 = dp({ id: 'dp-2', name: 'Near 2', lat: 40.01140, lng: -105.27580 });
    const [sw, ne] = computeInsetBounds(
      sign,
      [
        { destinationPlaceId: 'dp-1' },
        { destinationPlaceId: 'dp-2' },
      ],
      [near1, near2],
    );
    // Spread is well under 0.001 deg in any direction — same order
    // of magnitude for both axes (tight cluster).
    const dLat = ne[1] - sw[1];
    const dLng = ne[0] - sw[0];
    expect(dLat).toBeLessThan(0.001);
    expect(dLng).toBeLessThan(0.001);
  });
});

describe('computeInsetBounds — degenerate / edge cases', () => {
  it('collapses to the sign coords when no rows resolve', () => {
    const sign = { lat: 40.0, lng: -105.0 };
    const [[swLng, swLat], [neLng, neLat]] = computeInsetBounds(
      sign,
      [{ name: 'Bogus' }, { destinationPlaceId: 'dp-missing' }],
      [],
    );
    expect(swLat).toBe(40.0);
    expect(neLat).toBe(40.0);
    expect(swLng).toBe(-105.0);
    expect(neLng).toBe(-105.0);
  });

  it('collapses to the sign coords when destinations all sit AT the sign', () => {
    const sign = { lat: 40.0, lng: -105.0 };
    const same = dp({
      id: 'dp-same',
      name: 'Same',
      lat: 40.0,
      lng: -105.0,
    });
    const [sw, ne] = computeInsetBounds(
      sign,
      [{ destinationPlaceId: 'dp-same' }],
      [same],
    );
    expect(sw).toEqual([-105.0, 40.0]);
    expect(ne).toEqual([-105.0, 40.0]);
  });

  it('dedupes the same destination appearing on both sides of a sign', () => {
    const sign = { lat: 40.0, lng: -105.0 };
    const d = dp({
      id: 'dp-only',
      name: 'D',
      lat: 40.005,
      lng: -105.005,
    });
    const [sw1, ne1] = computeInsetBounds(
      sign,
      [{ destinationPlaceId: 'dp-only' }],
      [d],
    );
    const [sw2, ne2] = computeInsetBounds(
      sign,
      [
        { destinationPlaceId: 'dp-only' }, // front face
        { destinationPlaceId: 'dp-only' }, // back face
      ],
      [d],
    );
    // Same bounds either way — dedupe doesn't change the output.
    expect(sw1).toEqual(sw2);
    expect(ne1).toEqual(ne2);
  });

  it('skips archived destinations (treated as missing)', () => {
    const sign = { lat: 40.0, lng: -105.0 };
    const archived = dp({
      id: 'dp-archived',
      name: 'Archived',
      lat: 40.5,
      lng: -105.5,
      archivedAt: NOW,
    });
    const [sw, ne] = computeInsetBounds(
      sign,
      [{ destinationPlaceId: 'dp-archived' }],
      [archived],
    );
    // Archived dp must NOT widen the box.
    expect(sw).toEqual([-105.0, 40.0]);
    expect(ne).toEqual([-105.0, 40.0]);
  });
});
