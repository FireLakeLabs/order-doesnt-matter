import type { ViewFrame } from '../types';

/** Card: 960 px wide, 200 px radius (400 px circle), 12/17 px note/bass radii, 76 px root.
 * Side legends free the full height for the circle. Short host canvases cap only
 * the circle; note marks and text retain their width-scaled minimum. */
export function layout(frame: Pick<ViewFrame, 'width' | 'height'>) {
  const { width: w, height: h } = frame;
  const wide = w >= 900;
  const widthScale = w / 960;
  const chartHeight = wide ? h : h - 120;
  const desired = wide
    ? 200 * widthScale
    : Math.min(Math.max(200 * widthScale, h * 0.22), w * 0.28);
  const desiredScale = Math.max(widthScale, desired / 200);
  const labelPad = Math.max(24, 31 * desiredScale);
  const labelFont = Math.max(13, 17 * desiredScale);
  const r = Math.max(30, Math.min(desired, chartHeight / 2 - labelPad - labelFont / 2 - 6));
  const scale = Math.max(widthScale, r / 200);
  return {
    wide,
    widthScale,
    scale,
    r,
    cx: w / 2,
    cy: chartHeight / 2,
    chartHeight,
    dot: Math.max(7, 12 * scale),
    bass: Math.max(11, 17 * scale),
    rootFont: Math.max(36, 76 * scale),
    labelFont: Math.max(13, 17 * scale),
    labelRadius: r + Math.max(24, 31 * scale),
  };
}
