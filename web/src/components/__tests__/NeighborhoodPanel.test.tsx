// ─── NeighborhoodPanel tests — Phase 5d v2 ──────────────────────────────
//
// Pins the panel's structural contract:
//
//   1. Nearby-sign rows render with sign code + type + distance + bearing
//      caption. "shares N" badge appears when the row's sign covers ≥1
//      shared destination.
//   2. Shared-destination chips render with destination name + count
//      caption ("on N signs" — current + neighbours).
//   3. Empty state — no nearby signs within radius — shows the muted
//      caption and no map.
//   4. Sparse state — nearby signs exist but no shared destinations —
//      shows the map + nearby-signs list, with the muted "don't share
//      any destinations yet" message in place of chips.
//   5. Trace-route placeholder button is disabled with the Phase 5e
//      tooltip.
//
// Uses renderToStaticMarkup so React effects don't run — the mini-map's
// useEffect needs window.maplibregl which isn't available in jsdom.
// The map portion is verified visually on the live preview, not here.

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NeighborhoodPanel } from '../NeighborhoodPanel.tsx';
import type { NeighborhoodAnalysis } from '../../lib/nearbyOverlap.ts';
import type {
  DestinationPlace,
  SignInstance,
  SignType,
} from '../../platform/index.ts';

const NOW = '2026-04-30T00:00:00.000Z';

function dp(over: Partial<DestinationPlace> & {
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
    ...over,
  };
}

function sign(over: Partial<SignInstance> & { id: string }): SignInstance {
  return {
    signTypeId: 'st-nudge',
    location: '',
    facing: 'N',
    sides: [],
    reviewStatus: 'pending',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

const focal = sign({ id: 'self', lat: 40.0, lng: -105.0 });

const neighborSign = sign({
  id: 'si-cu-N-1',
  signTypeId: 'st-nudge',
  lat: 40.001,
  lng: -105.0,
});

const norlin = dp({
  id: 'dp-norlin',
  name: 'Norlin Library',
  lat: 40.005,
  lng: -105.0,
});

const signTypes: Record<string, SignType> = {
  'st-nudge': {
    id: 'st-nudge',
    code: 'NDG',
    name: 'Nudge',
    category: 'directional',
    dimensionsMM: { w: 600, h: 1800, d: 60 },
    copy: [],
    materials: [],
    mountType: 'ground',
    createdAt: NOW,
    updatedAt: NOW,
  },
};

const richAnalysis: NeighborhoodAnalysis = {
  nearbySigns: [
    {
      sign: neighborSign,
      distanceMeters: 111,
      bearingDegrees: 0,
    },
  ],
  sharedDestinations: [
    {
      destination: norlin,
      coveringNeighbors: [neighborSign],
    },
  ],
};

const emptyAnalysis: NeighborhoodAnalysis = {
  nearbySigns: [],
  sharedDestinations: [],
};

const sparseAnalysis: NeighborhoodAnalysis = {
  nearbySigns: [
    {
      sign: neighborSign,
      distanceMeters: 111,
      bearingDegrees: 0,
    },
  ],
  sharedDestinations: [],
};

// ─── 1. Nearby-sign list ─────────────────────────────────────────────────

describe('NeighborhoodPanel — nearby-signs list', () => {
  it('renders one row per nearby sign with id, type, distance + bearing', () => {
    const html = renderToStaticMarkup(
      <NeighborhoodPanel
        current={focal}
        analysis={richAnalysis}
        signTypes={signTypes}
        destinations={[norlin]}
      />,
    );
    // Sign code displayed via SD-NN convention.
    expect(html).toContain('SD-N-1');
    // Type label from signTypes lookup.
    expect(html).toContain('Nudge');
    // Distance + 8-point compass label.
    expect(html).toMatch(/364 ft N/); // 111 m → 364 ft, bearing 0 → N
    // "shares N" badge (this neighbour covers Norlin = 1 shared dest).
    expect(html).toContain('shares 1');
  });
});

// ─── 2. Shared chips ─────────────────────────────────────────────────────

describe('NeighborhoodPanel — shared destination chips', () => {
  it('renders a chip per shared destination with "on N signs" count', () => {
    const html = renderToStaticMarkup(
      <NeighborhoodPanel
        current={focal}
        analysis={richAnalysis}
        signTypes={signTypes}
        destinations={[norlin]}
      />,
    );
    expect(html).toContain('Norlin Library');
    // 1 covering neighbour + current = 2 signs.
    expect(html).toMatch(/on 2 signs/);
  });

  it('shared count caption updates the title-row pluralisation', () => {
    const html = renderToStaticMarkup(
      <NeighborhoodPanel
        current={focal}
        analysis={richAnalysis}
        signTypes={signTypes}
        destinations={[norlin]}
      />,
    );
    // 1 shared dest → singular "appears".
    expect(html).toContain('1 also appears on nearby signs');
  });
});

// ─── 3. Empty state ──────────────────────────────────────────────────────

describe('NeighborhoodPanel — empty state', () => {
  it('shows muted "no nearby signs" copy and no map when there are no neighbours', () => {
    const html = renderToStaticMarkup(
      <NeighborhoodPanel
        current={focal}
        analysis={emptyAnalysis}
        signTypes={signTypes}
        destinations={[norlin]}
      />,
    );
    expect(html).toContain('No nearby signs within');
    // No map container, no chip row.
    expect(html).not.toContain('class="nb-map"');
    expect(html).not.toContain('nb-chip-row');
  });
});

// ─── 4. Sparse state — neighbours exist but no shared dests ─────────────

describe('NeighborhoodPanel — sparse state', () => {
  it('renders the map + nearby list but a muted caption in place of chips', () => {
    const html = renderToStaticMarkup(
      <NeighborhoodPanel
        current={focal}
        analysis={sparseAnalysis}
        signTypes={signTypes}
        destinations={[norlin]}
      />,
    );
    // Map container present.
    expect(html).toContain('class="nb-map"');
    // Nearby-signs list present.
    expect(html).toContain('nb-nearby-list');
    // Muted message in place of chips, no chip row. (Source uses a
    // typographic apostrophe — match on a substring that doesn't
    // contain a quote.)
    expect(html).toContain('share any destinations');
    expect(html).not.toContain('nb-chip-row');
  });
});

// ─── 5. Connector-mode switcher ─────────────────────────────────────────

describe('NeighborhoodPanel — connector-mode switcher', () => {
  it('renders three radio buttons with Echoes (cooccurrence) active by default', () => {
    const html = renderToStaticMarkup(
      <NeighborhoodPanel
        current={focal}
        analysis={richAnalysis}
        signTypes={signTypes}
        destinations={[norlin]}
      />,
    );
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('>Echoes<');
    expect(html).toContain('>Approach<');
    expect(html).toContain('>Pivot<');
    // Default mode 'cooccurrence' → its button reads aria-checked="true".
    expect(html).toMatch(/aria-checked="true"[^>]*>Echoes</);
    expect(html).toMatch(/aria-checked="false"[^>]*>Approach</);
    expect(html).toMatch(/aria-checked="false"[^>]*>Pivot</);
  });
});
