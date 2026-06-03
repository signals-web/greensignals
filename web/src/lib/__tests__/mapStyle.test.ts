// ─── MapTiler style URL helper tests — Phase 5c follow-up ────────────────
//
// Pins three properties of `getMapStyleUrl`:
//
//   1. Returns the dark style URL when isDark === true.
//   2. Returns the light style URL when isDark === false.
//   3. Both URLs include the API key (pulled from VITE_MAPTILER_KEY).
//
// The dev/prod base toggle is environment-dependent — `import.meta.env.DEV`
// is true under vitest, so the URLs we expect here go through the
// `/maptiler` proxy. Production smoke would surface a different prefix
// but the dark/light branch is what this test pins.

import { describe, expect, it } from 'vitest';
import { getMapStyleUrl, STYLE_NAMES } from '../mapStyle.ts';

describe('getMapStyleUrl', () => {
  it('returns the dark style URL when isDark is true', () => {
    const url = getMapStyleUrl(true);
    expect(url).toContain(`/maps/${STYLE_NAMES.dark}/style.json`);
  });

  it('returns the light style URL when isDark is false', () => {
    const url = getMapStyleUrl(false);
    expect(url).toContain(`/maps/${STYLE_NAMES.light}/style.json`);
  });

  it('includes the MapTiler API key as a query param in both modes', () => {
    // VITE_MAPTILER_KEY may be empty in test env, but the `key=` param
    // is still constructed. The contract is "the URL shape carries
    // the key" — value is environment-supplied.
    expect(getMapStyleUrl(true)).toMatch(/[?&]key=/);
    expect(getMapStyleUrl(false)).toMatch(/[?&]key=/);
  });

  it('dark and light URLs are distinct (no accidental aliasing)', () => {
    expect(getMapStyleUrl(true)).not.toBe(getMapStyleUrl(false));
  });

  it('STYLE_NAMES surfaces the canonical variant ids', () => {
    // Pinned so a future swap to a different MapTiler variant
    // (e.g., `bright-v2`) requires a deliberate edit, not a silent
    // rename.
    expect(STYLE_NAMES.dark).toBe('streets-v2-dark');
    expect(STYLE_NAMES.light).toBe('streets-v2-light');
  });
});
