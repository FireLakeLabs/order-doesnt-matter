export const themes = ['paper', 'fern', 'night'] as const;
type Theme = (typeof themes)[number];
const key = 'odm:theme';
const valid = (value: unknown): value is Theme => themes.some((theme) => theme === value);
export function readTheme(storage?: Pick<Storage, 'getItem'>): Theme {
  try {
    const value = (storage ?? localStorage).getItem(key);
    if (valid(value)) return value;
  } catch {
    // Optional preference: even accessing localStorage may be denied.
  }
  return 'paper';
}
export function mountTheme(host: HTMLElement) {
  const label = document.createElement('label');
  label.className = 'theme-picker';
  label.textContent = 'Theme ';
  const select = document.createElement('select');
  select.id = 'theme';
  for (const theme of themes)
    select.add(new Option(theme[0].toUpperCase() + theme.slice(1), theme));
  const apply = (theme: Theme) => {
    document.documentElement.dataset.theme = theme;
    select.value = theme;
  };
  apply(readTheme());
  select.onchange = () => {
    if (!valid(select.value)) return;
    apply(select.value);
    try {
      localStorage.setItem(key, select.value);
    } catch {
      // The in-page choice still works when persistence is unavailable.
    }
  };
  label.append(select);
  host.append(label);
}

/** Canvas cannot resolve CSS variables. Refresh only when the theme changes;
 * lane paints are cached too. No style resolution or colour allocation per frame. */
let cached: ReturnType<typeof readPaint> | undefined;
let paintedTheme: string | undefined;
function readPaint() {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(`--${name}`).trim();
  const saturation = token('lane-saturation'),
    lightness = token('lane-lightness');
  const lanes: string[] = [];
  return {
    canvas: token('panel'),
    text: token('text'),
    track: token('border'),
    unknown: token('warning'),
    danger: token('danger'),
    lane: (n: number) => (lanes[n] ??= `hsl(${(n * 67 + 155) % 360} ${saturation} ${lightness})`),
  };
}
export function themePaint() {
  const theme = document.documentElement.dataset.theme;
  if (!cached || paintedTheme !== theme) {
    cached = readPaint();
    paintedTheme = theme;
  }
  return cached;
}
export const laneColour = (n: number) =>
  `hsl(${(n * 67 + 155) % 360} var(--lane-saturation) var(--lane-lightness))`;
