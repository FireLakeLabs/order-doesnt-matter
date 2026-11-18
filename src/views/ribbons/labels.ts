import type { ViewTheme } from '../types';

function luminance(hex: string) {
  const rgb = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

/** Labels sit on an opaque ground plate, independent of the ribbons behind it. */
export function labelColour(colour: string, theme: ViewTheme): string {
  const ink = luminance(colour),
    ground = luminance(theme.ground);
  const contrast = (Math.max(ink, ground) + 0.05) / (Math.min(ink, ground) + 0.05);
  return contrast >= 4.5 ? colour : theme.text;
}
