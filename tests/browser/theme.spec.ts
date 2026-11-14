import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { test, openProgram, play, selectNode, waitForPending, appSignal } from './helpers';

test('keyboard theme preference validates persistence and tolerates denied storage during playback', async ({
  page,
}) => {
  await openProgram(page);
  const picker = page.getByRole('combobox', { name: 'Theme' });
  await expect(picker).toHaveValue('paper');
  await picker.focus();
  await picker.press('End');
  await picker.press('Enter');
  await expect(picker).toHaveValue('night');
  await page.reload();
  await expect(picker).toHaveValue('night');
  await page.evaluate(() => localStorage.setItem('odm:theme', 'invalid'));
  await page.reload();
  await expect(picker).toHaveValue('paper');
  await page.addInitScript(() =>
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Denied', 'SecurityError');
      },
    }),
  );
  await openProgram(page, { source: 'note("c3*4").s("sine")' });
  await expect(picker).toHaveValue('paper');
  await picker.selectOption('fern');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'fern');
  await play(page);
  await appSignal(page, () => window.odmApp.history.some((e) => e.type === 'trigger'));
});

test('Kiln cutoff 700→900→Undo survives theme and enlargement with exact instances, focus and triggers', async ({
  page,
}) => {
  await openProgram(page, { example: 'Kiln' });
  await page.getByRole('button', { name: 'Section 2', exact: true }).click();
  const origin = await selectNode(page, { breadcrumb: ['bass', 'lpf'] });
  const field = page.locator('#editor').getByRole('spinbutton');
  await expect(field).toHaveValue('700');
  const held = await page.evaluateHandle(() => ({
    doc: JSON.stringify(window.odmApp.state.doc),
    editor: window.odmApp.editor,
    field: document.querySelector('#editor input[type="number"]'),
    canvas: document.querySelector('#spiral canvas'),
    planet: document.querySelector('[data-live-id]'),
  }));
  await play(page);
  await field.fill('900');
  await field.press('Tab');
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('fern');
  await page.locator('#now-enlarge').press('Enter');
  await page.locator('#preview-close').press('Enter');
  await expect(page.locator('#now-enlarge')).toBeFocused();
  await waitForPending(page);
  await appSignal(page, () =>
    window.odmApp.history.some(
      (e) => e.type === 'trigger' && (e.value as { cutoff?: number }).cutoff === 900,
    ),
  );
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('night');
  await page.locator('#watch').press('Enter');
  await page.locator('#undo').click();
  await waitForPending(page);
  await expect(field).toHaveValue('700');
  await appSignal(page, () =>
    window.odmApp.history.some(
      (e) => e.type === 'trigger' && (e.value as { cutoff?: number }).cutoff === 700,
    ),
  );
  expect(
    await held.evaluate((s) => ({
      doc: s.doc === JSON.stringify(window.odmApp.state.doc),
      editor: s.editor === window.odmApp.editor,
      field: s.field === document.querySelector('#editor input[type="number"]'),
      canvas: s.canvas === document.querySelector('#spiral canvas'),
      planet: s.planet === document.querySelector('[data-live-id]'),
      playing: window.odmApp.state.playing,
    })),
  ).toEqual({ doc: true, editor: true, field: true, canvas: true, planet: true, playing: true });
  await page.locator('#preview-close').press('Enter');
  await expect(page.locator('#watch')).toBeFocused();
  await field.focus();
  await page.evaluate(() => {
    const picker = document.querySelector<HTMLSelectElement>('#theme')!;
    picker.value = 'paper';
    picker.dispatchEvent(new Event('change'));
  });
  await expect(field).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(origin).toBeFocused();
  await held.dispose();
});

test('three palettes keep measured text/control contrast and dense numbered Watch geometry', async ({
  page,
}, info) => {
  // Original generated fixture: tiny spans, cross-turn notes, >128 starts, long names.
  const names = Array.from({ length: 14 }, (_, n) => `long_original_instrument_${n + 1}`);
  await openProgram(page, {
    source:
      names
        .map(
          (name, n) =>
            `const ${name}=${n === 0 ? 'note("48*129")' : n === 1 ? 'note(49).slow(3)' : `note("${48 + n} ~@99").fast(8)`}.s("sine");`,
        )
        .join('\n') + `\nstack(${names.join(',')})`,
  });
  const evidence = [];
  const geometry = new Map<string, unknown>();
  for (const theme of ['paper', 'fern', 'night']) {
    await page.getByRole('combobox', { name: 'Theme' }).selectOption(theme);
    const ratios = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const rgb = (token: string) => {
        const value = style.getPropertyValue(`--${token}`).trim().slice(1);
        const hex = value.length === 3 ? [...value].map((c) => c + c).join('') : value;
        return [0, 2, 4].map((n) => parseInt(hex.slice(n, n + 2), 16) / 255);
      };
      const luminance = (token: string) =>
        rgb(token).reduce(
          (sum, c, n) =>
            sum +
            (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][n],
          0,
        );
      return ['text', 'muted', 'accent', 'warning', 'danger', 'selection', 'border'].map(
        (token) => {
          const a = luminance(token),
            b = luminance('panel');
          return { token, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
        },
      );
    });
    for (const { token, ratio } of ratios)
      expect(ratio, `${theme} ${token}/panel`).toBeGreaterThanOrEqual(token === 'border' ? 3 : 4.5);
    for (const size of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
      { width: 390, height: 667 },
    ]) {
      await page.setViewportSize(size);
      await page.locator('#watch').press('Enter');
      const result = await page.evaluate(() => {
        const input = window.odmApp.watchInput(0.25),
          view = window.odmSpiral;
        view.update(input);
        const before = view.marks.map(
          ({ start, from, to, bodyTo, startAngle, endAngle, radius, endRadius, onset, dense }) => ({
            start,
            from,
            to,
            bodyTo,
            startAngle,
            endAngle,
            radius,
            endRadius,
            onset,
            dense,
          }),
        );
        const times = [];
        for (let n = 0; n < 30; n++) {
          view.update(input);
          times.push(view.drawMs);
        }
        return {
          before,
          after: view.marks.map(
            ({
              start,
              from,
              to,
              bodyTo,
              startAngle,
              endAngle,
              radius,
              endRadius,
              onset,
              dense,
            }) => ({
              start,
              from,
              to,
              bodyTo,
              startAngle,
              endAngle,
              radius,
              endRadius,
              onset,
              dense,
            }),
          ),
          fits: document.documentElement.scrollWidth <= innerWidth,
          times,
        };
      });
      expect(result.before).toEqual(result.after);
      const sizeKey = JSON.stringify(size);
      if (geometry.has(sizeKey)) {
        const previous = geometry.get(sizeKey) as typeof result.before;
        expect(result.before).toHaveLength(previous.length);
        // Compare the complete drawing at once, retaining exact scored spans
        // and the same ten-digit tolerance for derived canvas coordinates.
        expect(result.before).toEqual(
          previous.map((mark) => ({
            ...mark,
            startAngle: expect.closeTo(mark.startAngle, 10),
            endAngle: expect.closeTo(mark.endAngle, 10),
            radius: expect.closeTo(mark.radius, 10),
            endRadius: expect.closeTo(mark.endRadius, 10),
          })),
        );
      } else geometry.set(sizeKey, result.before);
      expect(result.before.some((m) => m.dense)).toBe(true);
      expect(result.before.some((m) => m.onset && m.to - m.from < 0.002)).toBe(true);
      expect(result.fits).toBe(true);
      const legend = page.locator('.spiral-legend li');
      await expect(legend).toHaveCount(14);
      // Read all lanes together rather than crossing the browser boundary per label.
      await expect(legend).toContainText(names.map((name, n) => `${n + 1}. ${name}`));
      await legend.last().scrollIntoViewIfNeeded();
      if (process.env.ODM_THEME_SHOTS)
        await page.locator('#watch-preview').screenshot({
          path: `${process.env.ODM_THEME_SHOTS}/${theme}-${size.width}-${size.height}.png`,
        });
      evidence.push({ theme, size, ratios, drawSubmissionMs: result.times });
      await page.locator('#preview-close').press('Enter');
    }
  }
  if (process.env.ODM_THEME_SHOTS)
    await writeFile(
      `${process.env.ODM_THEME_SHOTS}/measurement.json`,
      JSON.stringify(evidence, null, 2),
    );
  await info.attach('theme-watch-measurement', {
    body: JSON.stringify(evidence),
    contentType: 'application/json',
  });
});
