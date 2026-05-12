// Phase 6 — coverage for the CU Boulder leftover-metadata detector.
// Pins the trip-wires so a later phase doesn't accidentally drop
// them and silently re-allow stale demo data to read as a live
// project.

import { describe, it, expect } from 'vitest';
import { hasLeftoverCuBoulderMetadata } from '../cuBoulderDetect';

describe('hasLeftoverCuBoulderMetadata', () => {
  it('returns true when project name matches the seed', () => {
    expect(
      hasLeftoverCuBoulderMetadata({
        name: 'CU Boulder Campus Wayfinding',
        client: '',
      }),
    ).toBe(true);
  });

  it('returns true when project client matches the seed', () => {
    expect(
      hasLeftoverCuBoulderMetadata({
        name: 'Untitled Project',
        client: 'University of Colorado Boulder',
      }),
    ).toBe(true);
  });

  it('returns true when both match the seed', () => {
    expect(
      hasLeftoverCuBoulderMetadata({
        name: 'CU Boulder Campus Wayfinding',
        client: 'University of Colorado Boulder',
      }),
    ).toBe(true);
  });

  it('returns false for a freshly-reset project (Untitled + empty client)', () => {
    expect(
      hasLeftoverCuBoulderMetadata({ name: 'Untitled Project', client: '' }),
    ).toBe(false);
  });

  it('returns false for a user-renamed project', () => {
    expect(
      hasLeftoverCuBoulderMetadata({
        name: 'Tufts Campus Wayfinding',
        client: 'Tufts University',
      }),
    ).toBe(false);
  });

  it('returns false when project is null / undefined', () => {
    expect(hasLeftoverCuBoulderMetadata(null)).toBe(false);
    expect(hasLeftoverCuBoulderMetadata(undefined)).toBe(false);
  });
});
