/* Log entry shape shared by the Log component and the formatters. */

export type LogKind = 'error' | 'warn' | 'ok';

export type LogRow = {
  text: string;
  /** CSS color string applied as inline `color`; falls back to entry kind/default. */
  color?: string;
};

export type LogEntry = {
  /** Header line — also the source for the mobile-status mirror. */
  text: string;
  /** Tints the header. Ignored when `kind` is set so error/warn/ok keep
   * their semantic color regardless of the per-tape palette. */
  color?: string;
  /** Optional structured per-tape rows, rendered below the header. */
  rows?: LogRow[];
  kind?: LogKind;
  /** Renders as a horizontal divider instead of a text row. Used to visually
   * group log activity per Build/Step/Run session. */
  separator?: boolean;
  /** Synthetic header injected at the top of the render view when the
   *  non-reactive buffer holds more entries than `LOG_RENDER_CAP`. Never
   *  stored in the buffer; recomputed on every render-view flush. */
  overflow?: boolean;
  /** Companion to `overflow`: how many buffer entries are not in the view. */
  hiddenCount?: number;
};
