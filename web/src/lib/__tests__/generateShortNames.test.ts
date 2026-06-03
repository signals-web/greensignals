// ─── Side-by-side regression test for the v1 short-name generator port ──
//
// The v1 Signal app's `generate-short-names.js` produced
// `short-names-payload.json` against a curated list of 120 CU Boulder
// buildings. The v2 TypeScript port (`generateShortNames.ts`) must
// produce the same output for every entry in that payload. Any
// divergence is a regression — either the port missed a rule or the
// payload was hand-tuned beyond what the algorithm could produce.
//
// The payload's stored shape is `shortName: string` where empty
// string means "passthrough or no-op suggestion." The v2 generator
// matches that convention: returns '' when the original is already
// short or when the algorithmic stripping yields the original
// unchanged.
//
// We also exercise a handful of representative cases directly to
// catch any future drift in the regex pipeline that the payload
// happens not to cover.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  generateShortName,
  suggestShortNames,
} from '../generateShortNames.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve from the test file up to the workspace root.
// __dirname = signal/web/src/lib/__tests__
// payload  = signal/scripts/short-names-payload.json
const PAYLOAD_PATH = resolve(
  __dirname,
  '../../../../../signal/scripts/short-names-payload.json',
);

interface PayloadEntry {
  originalName: string;
  shortName: string;
  status: string;
  updatedBy: string;
  updatedAt: number;
}

function loadPayload(): PayloadEntry[] {
  const raw = readFileSync(PAYLOAD_PATH, 'utf8');
  const obj = JSON.parse(raw) as Record<string, PayloadEntry>;
  return Object.values(obj);
}

describe('generateShortName — v1 payload regression', () => {
  const payload = loadPayload();

  it('payload loads with the expected ~120 buildings', () => {
    // Sanity-check the file is present and parsed. If this trips, the
    // path resolution is wrong and the rest of the suite is moot.
    expect(payload.length).toBeGreaterThan(100);
  });

  // Iterate every payload entry and assert the v2 port produces the
  // same shortName. This is the central regression contract — if the
  // port drifts even one row from v1, we want to see the offender.
  for (const entry of loadPayload()) {
    it(`matches v1 for "${entry.originalName}"`, () => {
      const v2 = generateShortName(entry.originalName);
      expect(v2).toBe(entry.shortName);
    });
  }
});

describe('generateShortName — direct cases (sanity)', () => {
  it('passthrough names return empty string', () => {
    expect(generateShortName('Norlin Library')).toBe('');
    expect(generateShortName('Old Main')).toBe('');
    expect(generateShortName('Hillside')).toBe('');
  });

  it('manual overrides produce the curated shortening', () => {
    expect(generateShortName('University Memorial Center')).toBe('UMC');
    expect(generateShortName('Center for Academic Success and Engagement')).toBe('CASE');
    expect(generateShortName('Administrative and Research Center- East Campus')).toBe('ARC East');
  });

  it('algorithmic fallback strips generic facility nouns', () => {
    // Not in MANUAL, not PASSTHROUGH — should fall through to regex.
    // "Building" gets stripped, "Library" doesn't (not in the list).
    // Our test name has to be an algorithmic-only case.
    const out = generateShortName('Frobnitz Research Building');
    expect(out).toBe('Frobnitz');
  });

  it('returns empty when algorithmic stripping equals the original', () => {
    // "Frobnitz" alone has no matches against the regexes; algorithmic
    // returns the original. Generator returns '' to signal "no
    // shortening to suggest, fall back to name."
    expect(generateShortName('Frobnitz')).toBe('');
  });

  it('handles empty / whitespace gracefully', () => {
    expect(generateShortName('')).toBe('');
    // Whitespace-only strings: not in passthrough/manual, algorithmic
    // pipeline collapses to '' which falls back to the original
    // (which is whitespace), comparison says they're equal → ''.
    expect(generateShortName('   ')).toBe('');
  });
});

describe('suggestShortNames — bulk action filter', () => {
  it('emits one suggestion per destination with no existing shortName', () => {
    const out = suggestShortNames([
      { id: 'a', name: 'University Memorial Center' },
      { id: 'b', name: 'Center for Academic Success and Engagement' },
    ]);
    expect(out.size).toBe(2);
    expect(out.get('a')).toBe('UMC');
    expect(out.get('b')).toBe('CASE');
  });

  it('skips destinations that already have a non-empty shortName', () => {
    // Reviewer edits are sacred — even if the generator would suggest
    // a different (or identical) shortName, skip rows with anything
    // already in shortName.
    const out = suggestShortNames([
      { id: 'a', name: 'University Memorial Center', shortName: 'My UMC' },
      { id: 'b', name: 'Center for Academic Success and Engagement' },
    ]);
    expect(out.size).toBe(1);
    expect(out.has('a')).toBe(false);
    expect(out.get('b')).toBe('CASE');
  });

  it('skips passthrough names (no suggestion to make)', () => {
    const out = suggestShortNames([
      { id: 'a', name: 'Norlin Library' }, // PASSTHROUGH → ''
      { id: 'b', name: 'Old Main' }, // PASSTHROUGH → ''
    ]);
    expect(out.size).toBe(0);
  });

  it('skips destinations whose generator output equals the original', () => {
    // The algorithmic path returns '' when stripping is a no-op,
    // suggestShortNames must filter those out — never emit a
    // suggestion that equals the original.
    const out = suggestShortNames([
      { id: 'a', name: 'Frobnitz' }, // no rules match
    ]);
    expect(out.size).toBe(0);
  });

  it('treats whitespace-only shortName as empty (i.e., generates a suggestion)', () => {
    // The bulk action's contract is "skip rows the reviewer has
    // touched." Whitespace-only doesn't count as a meaningful edit.
    const out = suggestShortNames([
      { id: 'a', name: 'University Memorial Center', shortName: '   ' },
    ]);
    expect(out.size).toBe(1);
    expect(out.get('a')).toBe('UMC');
  });
});
