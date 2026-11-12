/** Display formatting only; exact fields retain the document's full precision. */
export const displayNumber = (value: number) => String(Number(value.toPrecision(6)));
export const withUnit = (value: string | number, unit = '') =>
  `${typeof value === 'number' ? displayNumber(value) : value}${unit ? ` ${unit}` : ''}`;

export function fieldLabel(text: string, input: HTMLElement, unit = '') {
  const label = document.createElement('label'),
    title = document.createElement('span'),
    value = document.createElement('span');
  label.className = 'editor-field';
  title.textContent = text;
  value.className = 'editor-input';
  value.append(input);
  if (unit) {
    const suffix = document.createElement('span');
    suffix.className = 'editor-unit';
    suffix.textContent = unit;
    value.append(suffix);
  }
  label.append(title, value);
  return label;
}
export function toggle(text: string) {
  const label = document.createElement('label'),
    input = document.createElement('input'),
    title = document.createElement('span'),
    state = document.createElement('span');
  label.className = 'editor-toggle';
  input.type = 'checkbox';
  input.setAttribute('aria-label', text);
  title.textContent = text;
  state.className = 'editor-toggle-state';
  state.setAttribute('aria-hidden', 'true');
  label.append(input, title, state);
  return { label, input };
}
