// Pure viewport-math helpers for the machine-graph panel (machines-demo#110).
//
// - `computeCenterScroll` decides where to scroll a container so a target
//   element sits at the visible center, but only when the element has
//   drifted outside a "comfort zone" inset of the container's viewport.
//   Replaces the prior "fully off-screen by 16px" policy.
// - `computeFitZoom` picks the largest zoom ≤ 1 such that at least
//   `minVisibleAreaRatio` of the SVG's area fits inside the body. Used as
//   the initial zoom on each (re)render so big graphs (callable-subtree,
//   Brainfuck UTM) don't open as a sliver of the diagram.
//
// Lives next to other pure boot-time helpers (initialBoot.ts) so the math
// can be unit-tested without happy-dom layout (`getBoundingClientRect` in
// happy-dom returns zeros — no real layout engine — so the component-level
// scroll / zoom paths are not directly testable there).

export type Rect = {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
};

export type ScrollOffset = { left: number; top: number };

export type ScrollTarget = { left?: number; top?: number };

/**
 * Decide whether `el` needs to be scrolled within `container`, and if so,
 * to what absolute `scrollLeft` / `scrollTop` values.
 *
 * The element is considered "comfortable" on an axis when its bounding
 * rect on that axis sits fully inside the container rect minus
 * `comfortInsetRatio * size` on each side. With the default ratio of
 * `0.1`, the inner comfort zone is the middle 80% of the container's
 * width/height — so a node has to drift into the outer 10% band on
 * either side before we recenter it.
 *
 * The per-axis check is independent: a node that's drifted off the right
 * edge but is vertically centered gets a horizontal-only recentering
 * (the returned `ScrollTarget` omits `top` in that case). This matches
 * the prior `scrollIntoViewIfNeeded` shape so callers can fold the
 * result into a single `scrollTo({...target, behavior})`.
 *
 * Returns `null` when no scroll is needed (both axes comfortable). The
 * caller can short-circuit on that.
 */
export function computeCenterScroll(
  containerRect: Rect,
  scroll: ScrollOffset,
  elRect: Rect,
  comfortInsetRatio = 0.1,
): ScrollTarget | null {
  const insetV = containerRect.height * comfortInsetRatio;
  const insetH = containerRect.width * comfortInsetRatio;
  const comfortableV = elRect.top >= containerRect.top + insetV
    && elRect.bottom <= containerRect.bottom - insetV;
  const comfortableH = elRect.left >= containerRect.left + insetH
    && elRect.right <= containerRect.right - insetH;
  if (comfortableV && comfortableH) return null;
  const target: ScrollTarget = {};
  if (!comfortableV) {
    const elCenterY = elRect.top + elRect.height / 2;
    const containerCenterY = containerRect.top + containerRect.height / 2;
    target.top = scroll.top + (elCenterY - containerCenterY);
  }
  if (!comfortableH) {
    const elCenterX = elRect.left + elRect.width / 2;
    const containerCenterX = containerRect.left + containerRect.width / 2;
    target.left = scroll.left + (elCenterX - containerCenterX);
  }
  return target;
}

/**
 * Pick the largest zoom ≤ 1 such that at least `minVisibleAreaRatio` of the
 * SVG's intrinsic area fits inside the body's content box (machines-demo#110).
 * Returns `1` when the SVG already fits comfortably at full size.
 *
 * The visible-area ratio is a strictly decreasing function of zoom — larger
 * zoom shows a smaller fraction of the SVG — so a 30-step binary search
 * converges to ~1e-9 precision. Closed-form would need a piecewise case
 * analysis around the "one axis fits while the other overflows" transition;
 * the search keeps the math obvious.
 *
 * Caller is responsible for clamping the result to `ZOOM_MIN` — when even
 * the minimum zoom doesn't reach the target ratio, we accept "less than the
 * target visible" rather than zoom out further.
 */
export function computeFitZoom(
  svgWidth: number,
  svgHeight: number,
  bodyWidth: number,
  bodyHeight: number,
  minVisibleAreaRatio = 0.6,
): number {
  if (svgWidth <= 0 || svgHeight <= 0 || bodyWidth <= 0 || bodyHeight <= 0) return 1;
  if (minVisibleAreaRatio <= 0) return 1;
  const visibleRatio = (z: number): number => {
    const sw = svgWidth * z;
    const sh = svgHeight * z;
    return Math.min(1, bodyWidth / sw) * Math.min(1, bodyHeight / sh);
  };
  if (visibleRatio(1) >= minVisibleAreaRatio) return 1;
  let lo = 1e-6;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (visibleRatio(mid) >= minVisibleAreaRatio) lo = mid;
    else hi = mid;
  }
  return lo;
}
