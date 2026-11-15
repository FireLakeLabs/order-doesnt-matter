import type { ViewTheme } from '../views/types';

export interface StudioTheme extends ViewTheme {
  instrumentColours: string[];
}
export const themes: Record<string, StudioTheme> = {
  arcade: {
    name: 'arcade',
    ground: '#07060D',
    panel: '#12101F',
    line: '#2A2545',
    text: '#F4F1FF',
    muted: '#A49EC4',
    accent: '#FFD23F',
    fontDisplay: 'Space Grotesk',
    fontMono: 'JetBrains Mono',
    radius: 10,
    glow: true,
    instrumentColours: [
      '#FF4D8D',
      '#FFD23F',
      '#3DDCFF',
      '#5BFF8F',
      '#B388FF',
      '#FF8A3D',
      '#6FA0FF',
      '#E8A0D8',
    ],
  },
  sunset: {
    name: 'sunset',
    ground: '#1A0B2E',
    panel: '#2A1247',
    line: '#4A2470',
    text: '#FFE9F3',
    muted: '#D4A9D8',
    accent: '#FF9A56',
    fontDisplay: 'Bricolage Grotesque',
    fontMono: 'JetBrains Mono',
    radius: 12,
    glow: true,
    instrumentColours: [
      '#FF5E99',
      '#FF9A56',
      '#FFD166',
      '#6EE7E0',
      '#9B8CFF',
      '#FF7AD9',
      '#7BD3FF',
      '#C6F27A',
    ],
  },
  phosphor: {
    name: 'phosphor',
    ground: '#020A04',
    panel: '#06180B',
    line: '#0F3A1C',
    text: '#B8FFC8',
    muted: '#5FBF7A',
    accent: '#00FF66',
    fontDisplay: 'VT323',
    fontMono: 'VT323',
    radius: 0,
    glow: true,
    instrumentColours: [
      '#00FF66',
      '#9DFFB8',
      '#00B84A',
      '#FFB000',
      '#5CFF9D',
      '#C8FF5C',
      '#00E0A0',
      '#FFD27A',
    ],
  },
  riso: {
    name: 'riso',
    ground: '#F6F0E4',
    panel: '#EAE1CF',
    line: '#1D1B2F',
    text: '#1D1B2F',
    muted: '#4A4760',
    accent: '#FF4F7B',
    fontDisplay: 'Bricolage Grotesque',
    fontMono: 'JetBrains Mono',
    radius: 4,
    glow: false,
    instrumentColours: [
      '#FF4F7B',
      '#2F5BEA',
      '#FFC400',
      '#00A66C',
      '#FF7A1A',
      '#8A4FFF',
      '#00A0C6',
      '#C2185B',
    ],
  },
  pocket: {
    name: 'pocket',
    ground: '#C9DB8E',
    panel: '#B4C97A',
    line: '#2F5D3A',
    text: '#0F2A1D',
    muted: '#2F5D3A',
    accent: '#0F2A1D',
    fontDisplay: 'Silkscreen',
    fontMono: 'Silkscreen',
    radius: 0,
    glow: false,
    instrumentColours: ['#0F2A1D', '#2F5D3A', '#4E8046', '#6E9A4E'],
  },
};
export const themeNames = ['arcade', 'sunset', 'phosphor', 'riso', 'pocket'] as const;
export function resolveTheme(name: string | null): StudioTheme {
  return (name && Object.hasOwn(themes, name) ? themes[name] : undefined) ?? themes.arcade;
}
/** Each palette wrap mixes another 20% white; Pocket keeps its four exact shades. */
export function instrumentColour(name: string, index: number): string {
  const theme = resolveTheme(name);
  const palette = theme.instrumentColours;
  const base = palette[index % palette.length];
  const round = Math.floor(index / palette.length);
  if (round === 0 || name === 'pocket') return base;
  const amount = 1 - 0.8 ** round;
  return (
    '#' +
    [1, 3, 5]
      .map((offset) => {
        const channel = Number.parseInt(base.slice(offset, offset + 2), 16);
        return Math.round(channel + (255 - channel) * amount)
          .toString(16)
          .padStart(2, '0');
      })
      .join('')
      .toUpperCase()
  );
}

const viewThemes = new WeakMap<ViewTheme, ViewTheme>();
/** Pass exactly the public view contract, keeping Studio palette metadata in the host. */
export function viewTheme(theme: ViewTheme): ViewTheme {
  const cached = viewThemes.get(theme);
  if (cached) return cached;
  const { name, ground, panel, line, text, muted, accent, fontDisplay, fontMono, radius, glow } =
    theme;
  const resolved = {
    name,
    ground,
    panel,
    line,
    text,
    muted,
    accent,
    fontDisplay,
    fontMono,
    radius,
    glow,
  };
  viewThemes.set(theme, resolved);
  return resolved;
}
