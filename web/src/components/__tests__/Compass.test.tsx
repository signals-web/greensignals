// ─── Compass icon tests — Phase 5c ───────────────────────────────────────
//
// Pins the snap-no-animation contract for the compass icon:
//
//   1. The SVG's transform-rotate matches FACING_DEG[facing].
//   2. There is no CSS transition on the SVG (snap, not ease).
//   3. There are no `<animateTransform>` SVG elements left from the
//      pre-Phase-5c animated-icon implementation.
//   4. With `facing` undefined, the needle is omitted and the icon
//      renders dimmed.
//
// Uses react-dom/server's static-markup renderer so the suite stays in
// vitest's default node environment — no jsdom needed.

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Compass } from '../Compass.tsx';

describe('Compass — snap-rotate transform', () => {
  it("rotates 0deg for facing 'N'", () => {
    const html = renderToStaticMarkup(<Compass facing="N" />);
    expect(html).toMatch(/transform:\s*rotate\(0deg\)/);
  });

  it("rotates 45deg for facing 'NE'", () => {
    const html = renderToStaticMarkup(<Compass facing="NE" />);
    expect(html).toMatch(/transform:\s*rotate\(45deg\)/);
  });

  it("rotates 90deg for facing 'E'", () => {
    const html = renderToStaticMarkup(<Compass facing="E" />);
    expect(html).toMatch(/transform:\s*rotate\(90deg\)/);
  });

  it("rotates 270deg for facing 'W'", () => {
    const html = renderToStaticMarkup(<Compass facing="W" />);
    expect(html).toMatch(/transform:\s*rotate\(270deg\)/);
  });
});

describe('Compass — no animation, no transition', () => {
  it('renders no <animateTransform> SVG elements', () => {
    // The pre-Phase-5c icon used three chained `<animateTransform>`
    // elements that produced visible drift between dial clicks.
    const html = renderToStaticMarkup(<Compass facing="N" />);
    expect(html).not.toMatch(/animateTransform/);
  });

  it('does not declare a CSS transition on the SVG', () => {
    // The pre-Phase-5c icon had a 0.4s cubic-bezier transition on
    // `transform`. Phase 5c removed it so consecutive dial clicks
    // register as discrete frames at the new bearing.
    const html = renderToStaticMarkup(<Compass facing="N" />);
    expect(html).not.toMatch(/transition/);
  });
});

describe('Compass — neutral state (undefined facing)', () => {
  it('omits the needle when facing is undefined', () => {
    const html = renderToStaticMarkup(<Compass facing={undefined} />);
    expect(html).not.toMatch(/data-testid="compass-needle"/);
  });

  it('renders the needle when facing is set', () => {
    const html = renderToStaticMarkup(<Compass facing="N" />);
    expect(html).toMatch(/data-testid="compass-needle"/);
  });

  it('dims the icon (opacity < 1) when facing is undefined', () => {
    const html = renderToStaticMarkup(<Compass facing={undefined} />);
    // Match either "opacity:0.35" or "opacity: 0.35".
    expect(html).toMatch(/opacity:\s*0\.35/);
  });

  it('renders at full opacity when facing is set', () => {
    const html = renderToStaticMarkup(<Compass facing="N" />);
    expect(html).toMatch(/opacity:\s*1\b/);
  });
});

describe('Compass — data attributes for live debug', () => {
  it('exposes data-facing matching the prop', () => {
    expect(renderToStaticMarkup(<Compass facing="SE" />)).toMatch(
      /data-facing="SE"/,
    );
    expect(renderToStaticMarkup(<Compass facing={undefined} />)).toMatch(
      /data-facing="none"/,
    );
  });
});
