import { describe, expect, it } from 'vitest';
import { computeCenterScroll, type Rect } from './scrollCenter.ts';

// Container is a 400×360 box pinned at viewport (0,0) — matches MachineGraph's
// fixed-height `.body` shape closely enough for the math to read like the
// real call site. Scroll origin (0,0) so all returned values are absolute
// pixel offsets, easy to read.
const CONTAINER: Rect = {
  top: 0, left: 0, bottom: 360, right: 400, width: 400, height: 360,
};
const ZERO_SCROLL = { left: 0, top: 0 };

function rect(top: number, left: number, height = 30, width = 60): Rect {
  return { top, left, height, width, bottom: top + height, right: left + width };
}

describe('computeCenterScroll', () => {
  it('S-scroll-comfortable: returns null when el sits inside the comfort zone on both axes', () => {
    // Default 10% inset on 400×360 → comfort zone is x∈[40,360], y∈[36,324].
    // A 60×30 el at (200, 180) is well inside.
    const result = computeCenterScroll(CONTAINER, ZERO_SCROLL, rect(180, 200));
    expect(result).toBeNull();
  });

  it('S-scroll-edge-band-vertical: el at top edge band triggers vertical recenter', () => {
    // Top edge of comfort zone is y=36. El at y=20 is in the upper 10% band
    // (still fully visible inside container, but past comfort).
    const el = rect(20, 200);
    const result = computeCenterScroll(CONTAINER, ZERO_SCROLL, el);
    expect(result).not.toBeNull();
    expect(result?.top).toBe((20 + 15) - 180); // el center 35, container center 180
    // Horizontal was fine — should not appear in target.
    expect(result).not.toHaveProperty('left');
  });

  it('S-scroll-edge-band-horizontal: el at right edge band triggers horizontal recenter only', () => {
    // Right edge of comfort zone is x=360. El.right=370 → past comfort.
    const el = rect(180, 310, 30, 60);
    const result = computeCenterScroll(CONTAINER, ZERO_SCROLL, el);
    expect(result).not.toBeNull();
    expect(result?.left).toBe((310 + 30) - 200); // el center 340, container center 200
    expect(result).not.toHaveProperty('top');
  });

  it('S-scroll-both-axes: el clipped on both axes returns left + top', () => {
    // El's top-left corner is at (-20, -10) — overlaps the upper-left corner.
    const el = rect(-10, -20);
    const result = computeCenterScroll(CONTAINER, ZERO_SCROLL, el);
    expect(result).not.toBeNull();
    expect(result?.left).toBe((-20 + 30) - 200);
    expect(result?.top).toBe((-10 + 15) - 180);
  });

  it('S-scroll-respects-current-scroll: deltas add to the existing scrollLeft/scrollTop', () => {
    // Container is conceptually scrolled (250, 80). El's rect is in viewport
    // coords (so it already reflects the current scroll). The target value
    // is the absolute new scrollLeft / scrollTop — old + delta.
    const result = computeCenterScroll(
      CONTAINER,
      { left: 250, top: 80 },
      rect(-10, -20),
    );
    expect(result?.left).toBe(250 + ((-20 + 30) - 200));
    expect(result?.top).toBe(80 + ((-10 + 15) - 180));
  });

  it('S-scroll-custom-inset-ratio: a 25% inset shrinks the comfort zone', () => {
    // At ratio 0.25, comfort zone on 400×360 is x∈[100,300], y∈[90,270]. A
    // node at (50, 50) — comfortable under the 10% default — now triggers.
    const el = rect(50, 50);
    const defaultResult = computeCenterScroll(CONTAINER, ZERO_SCROLL, el);
    expect(defaultResult).toBeNull();
    const tightResult = computeCenterScroll(CONTAINER, ZERO_SCROLL, el, 0.25);
    expect(tightResult).not.toBeNull();
  });

  it('S-scroll-larger-than-comfort-zone: huge el always returns a center target', () => {
    // El is wider than the comfort zone (400 wide). By the "fully inside"
    // rule it can never be comfortable horizontally, so we always emit a
    // horizontal target that puts its center at container center.
    const huge: Rect = { top: 180, left: -20, height: 30, width: 400, bottom: 210, right: 380 };
    const result = computeCenterScroll(CONTAINER, ZERO_SCROLL, huge);
    expect(result).not.toBeNull();
    // El center is at x=180, container center at x=200 → delta -20.
    expect(result?.left).toBe(-20);
  });

  it('S-scroll-non-zero-container-origin: rects in viewport coords still produce correct deltas', () => {
    // Container is shifted in the viewport (e.g., MachineGraph's body lives
    // below a header). Math should be coord-system-agnostic since we only
    // use rect coords relative to each other.
    const offsetContainer: Rect = {
      top: 100, left: 50, bottom: 460, right: 450, width: 400, height: 360,
    };
    const el: Rect = {
      top: 110, left: 60, height: 30, width: 60, bottom: 140, right: 120,
    };
    const result = computeCenterScroll(offsetContainer, ZERO_SCROLL, el);
    expect(result).not.toBeNull();
    // El center (125, 90), container center (250, 280) → deltas (-125, -190).
    // El is in the top-left corner of the container's viewport.
    expect(result?.left).toBeCloseTo(60 + 30 - 250);
    expect(result?.top).toBeCloseTo(110 + 15 - 280);
  });
});
