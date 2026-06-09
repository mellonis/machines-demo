// Pure scroll-math helper for the machine-graph "follow the highlight"
// behaviour (machines-demo#110). Computes where to scroll a container so a
// target element sits at the visible center, but only when the element has
// drifted outside a "comfort zone" inset of the container's viewport. Lets
// the previous "fully off-screen by 16px" policy go — a target sitting at
// the edge band counts as needing recentering.
//
// Lives next to other pure boot-time helpers (initialBoot.ts) so the math
// can be unit-tested without happy-dom layout (`getBoundingClientRect` in
// happy-dom returns zeros — no real layout engine — so the component-level
// scrollIntoView path is not directly testable there).

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
