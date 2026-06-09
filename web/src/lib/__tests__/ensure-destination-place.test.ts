// B4 — ensureDestinationPlace + namesMatch.

import { describe, it, expect } from 'vitest';
import { blankDestinationPlace, type DestinationPlace } from '../../platform/index.ts';
import { ensureDestinationPlace, namesMatch } from '../ensure-destination-place.ts';

function place(name: string, extra?: Partial<DestinationPlace>): DestinationPlace {
  return { ...blankDestinationPlace({ projectId: 'p', name, lat: 40, lng: -74, createdBy: 'tester' }), ...extra };
}

const STUB = { projectId: 'p', stubLat: 42.1, stubLng: -71.2, createdBy: 'tester' };

describe('namesMatch — case-insensitive, trimmed, exact', () => {
  it('matches across case', () => {
    expect(namesMatch('PACKARD HALL', 'packard hall')).toBe(true);
    expect(namesMatch('Packard Hall', 'packard hall')).toBe(true);
  });
  it('matches across surrounding whitespace', () => {
    expect(namesMatch('  Embrace  ', 'Embrace')).toBe(true);
  });
  it('does not fuzzy/prefix match', () => {
    expect(namesMatch('Packard Hall', 'Packard Halll')).toBe(false);
    expect(namesMatch('Embrace', 'Embracee')).toBe(false);
    expect(namesMatch('Pack', 'Packard Hall')).toBe(false);
  });
});

describe('ensureDestinationPlace', () => {
  it('creates a new place (stub coords + coordsStub) when none exists', () => {
    const r = ensureDestinationPlace({ name: 'Embrace', existingPlaces: [], ...STUB });
    expect(r.wasCreated).toBe(true);
    expect(r.place.name).toBe('Embrace');
    expect(r.place.lat).toBe(42.1);
    expect(r.place.lng).toBe(-71.2);
    expect(r.place.coordsStub).toBe(true);
  });

  it('links to an existing place on a case-insensitive name match', () => {
    const existing = place('Embrace');
    const r = ensureDestinationPlace({ name: 'embrace', existingPlaces: [existing], ...STUB });
    expect(r.wasCreated).toBe(false);
    expect(r.place.id).toBe(existing.id);
  });

  it('links across casing differences (PACKARD HALL → Packard Hall)', () => {
    const existing = place('Packard Hall');
    const r = ensureDestinationPlace({ name: 'PACKARD HALL', existingPlaces: [existing], ...STUB });
    expect(r.wasCreated).toBe(false);
    expect(r.place.id).toBe(existing.id);
  });

  it('treats a typo as a distinct place (no fuzzy match)', () => {
    const r = ensureDestinationPlace({ name: 'Embracee', existingPlaces: [place('Embrace')], ...STUB });
    expect(r.wasCreated).toBe(true);
    expect(r.place.name).toBe('Embracee');
  });

  it('trims whitespace before matching ("  Embrace  " → existing)', () => {
    const existing = place('Embrace');
    const r = ensureDestinationPlace({ name: '  Embrace  ', existingPlaces: [existing], ...STUB });
    expect(r.wasCreated).toBe(false);
    expect(r.place.id).toBe(existing.id);
  });

  it('ignores archived places when matching (re-creates)', () => {
    const archived = place('Embrace', { archivedAt: '2026-01-01' });
    const r = ensureDestinationPlace({ name: 'Embrace', existingPlaces: [archived], ...STUB });
    expect(r.wasCreated).toBe(true);
    expect(r.place.id).not.toBe(archived.id);
  });
});
