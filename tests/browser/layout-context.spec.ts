import { expect } from '@playwright/test';
import { test, openProgram, sharedProgram, selectNode, play, waitForPending } from './helpers';

test.describe('Kiln in-page workspace', () => {
  sharedProgram((page) => openProgram(page, { example: 'Kiln' }));

  test('enlargement preserves the stopped and playing editor; pinned editing has distinct live context', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Section 2', exact: true }).click();
    await selectNode(page, { breadcrumb: ['bass', 'lpf'] });
    const field = page.locator('#editor').getByRole('spinbutton');
    const original = await field.inputValue();
    const held = await page.evaluateHandle(() => ({
      canvas: document.querySelector('#spiral canvas'),
      planet: document.querySelector('[data-live-id]'),
      editor: document.querySelector('#editor'),
      field: document.querySelector('#editor input[type="number"]'),
      session: window.odmApp.editor,
      doc: JSON.stringify(window.odmApp.state.doc),
      selected: document
        .querySelector('[data-editor-selected="true"]')
        ?.getAttribute('data-editor-target'),
    }));
    for (const button of ['#now-enlarge', '#watch']) {
      await page.locator(button).press('Enter');
      await expect(page.locator('#preview-expanded')).toBeVisible();
      await expect(page.locator('#preview-expanded')).not.toHaveAttribute('aria-modal', 'true');
      await expect(page.locator('#editor')).toBeVisible();
      expect(
        await held.evaluate((s) => ({
          canvas: s.canvas === document.querySelector('#spiral canvas'),
          planet: s.planet === document.querySelector('[data-live-id]'),
          editor: s.editor === document.querySelector('#editor'),
          field: s.field === document.querySelector('#editor input[type="number"]'),
          session: s.session === window.odmApp.editor,
          doc: s.doc === JSON.stringify(window.odmApp.state.doc),
          selected:
            s.selected ===
            document
              .querySelector('[data-editor-selected="true"]')
              ?.getAttribute('data-editor-target'),
        })),
      ).toEqual({
        canvas: true,
        planet: true,
        editor: true,
        field: true,
        session: true,
        doc: true,
        selected: true,
      });
      await page.locator('#preview-close').press('Enter');
      await expect(page.locator(button)).toBeFocused();
    }
    await page.locator('#now-enlarge').press('Enter');
    await page.locator('#watch').press('Enter');
    await expect(page.locator('#preview-expanded #watch-preview')).toBeVisible();
    await expect(page.locator('#now-slot #now-preview')).toBeVisible();
    await page.locator('#follow').focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('#preview-expanded')).not.toBeVisible();
    await expect(page.locator('#editor')).toBeVisible();
    await expect(page.locator('#watch')).toBeFocused();
    await play(page);
    await expect(page.locator('#playback-context')).toContainText('Playing Section 2');
    await page.getByRole('button', { name: 'Section 3', exact: true }).click();
    await expect(page.locator('#editing-context')).toContainText('Editing Section 3');
    await expect(page.locator('#window')).toHaveText('Cycles 12–28');
    await expect(page.locator('#playback-context')).toContainText('Playing Section 2');
    await page.locator('#follow').click();
    await expect(page.locator('#editing-context')).toContainText('Editing Section 2');
    await page.locator('#now-enlarge').press('Enter');
    expect(
      await held.evaluate(
        (s) =>
          s.field === document.querySelector('#editor input[type="number"]') &&
          window.odmApp.state.playing,
      ),
    ).toBe(true);
    await page.locator('#preview-close').press('Enter');
    // Change and enlarge in one input turn: pending must survive the move before
    // the scheduler can acknowledge the edited instrument's next note.
    expect(
      await field.evaluate((input: HTMLInputElement) => {
        input.value = '900';
        input.dispatchEvent(new Event('change', { bubbles: true }));
        const before = document.querySelector('#editor-status')!.textContent;
        document.querySelector<HTMLButtonElement>('#watch')!.click();
        return {
          before,
          after: document.querySelector('#editor-status')!.textContent,
          field: input === document.querySelector('#editor input[type="number"]'),
          playing: window.odmApp.state.playing,
        };
      }),
    ).toEqual({
      before: "Changing… you will hear it on bass's next note",
      after: "Changing… you will hear it on bass's next note",
      field: true,
      playing: true,
    });
    await waitForPending(page);
    await expect(field).toHaveValue('900');
    await page.locator('#undo').click();
    await waitForPending(page);
    await expect(field).toHaveValue(original);
    expect(
      await held.evaluate((s) => ({
        doc: s.doc === JSON.stringify(window.odmApp.state.doc),
        canvas: s.canvas === document.querySelector('#spiral canvas'),
        field: s.field === document.querySelector('#editor input[type="number"]'),
        undo: window.odmApp.editor!.canUndo,
        redo: window.odmApp.editor!.canRedo,
        playing: window.odmApp.state.playing,
      })),
    ).toEqual({ doc: true, canvas: true, field: true, undo: false, redo: true, playing: true });
    await page.locator('#preview-close').press('Enter');
    await expect(page.locator('#watch')).toBeFocused();
    await page.locator('#stop').click();
    await expect(page.locator('#playback-context')).toContainText('paused');
    await held.dispose();
  });

  test('rhythm stays in page with focused input and reachable lower controls through desktop and phone resize', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Section 2', exact: true }).click();
    await selectNode(page, { breadcrumb: ['bass', 'Rhythm'] });
    const field = page.getByLabel('Note value', { exact: true });
    for (const size of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
      { width: 390, height: 667 },
    ]) {
      await field.focus();
      await page.setViewportSize(size);
      await expect(field).toBeFocused();
      const geometry = await page.locator('#editor').evaluate((editor) => ({
        inFlow: ['static', 'relative'].includes(getComputedStyle(editor).position),
        pageFits: document.documentElement.scrollWidth <= innerWidth,
        followsScore:
          editor.getBoundingClientRect().top >=
          document.querySelector('#score')!.getBoundingClientRect().bottom - 1,
        bodyFits:
          editor.querySelector('.editor-body')!.scrollHeight <=
          editor.querySelector('.editor-body')!.clientHeight + 1,
        targetsFit: Array.from(editor.querySelectorAll('button'))
          .filter((n) => n.checkVisibility())
          .every((n) => n.getBoundingClientRect().height >= (innerWidth <= 760 ? 44 : 20)),
      }));
      expect(geometry).toEqual({
        inFlow: true,
        pageFits: true,
        followsScore: true,
        bodyFits: true,
        targetsFit: true,
      });
      const lower = page.locator('#editor').getByRole('button', { name: 'Remove', exact: true });
      await lower.scrollIntoViewIfNeeded();
      await lower.focus();
      await expect(lower).toBeFocused();
      const bounds = await lower.boundingBox();
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(size.height);
      await expect(page.locator('#now-preview')).toBeVisible();
      await expect(page.locator('#watch-preview')).toBeVisible();
    }
  });
});

test('dense phone List returns focus to its full-name origin; enlarged Watch has a read-only full legend', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 667 });
  const names = Array.from({ length: 14 }, (_, i) => `long_instrument_name_${i + 1}`);
  const source =
    names
      .map((name, i) => `const ${name}=note(${48 + i}).s("sine").room(.2).orbit(${i % 2});`)
      .join('\n') + `\nstack(${names.join(',')})`;
  await openProgram(page, { source });
  await page.locator('.live-panel > summary').click();
  await expect(page.locator('.live-list-disclosure')).toHaveAttribute('open');
  const list = page.locator('[data-list-id]');
  await expect(list).toHaveCount(14);
  expect(
    await list.evaluateAll((nodes) =>
      nodes.map((n) => n.querySelector('span:not(.live-dot)')!.textContent),
    ),
  ).toEqual(names);
  expect(
    await list.evaluateAll((nodes) => nodes.every((n) => n.getBoundingClientRect().height >= 44)),
  ).toBe(true);
  await list.first().press('Enter');
  await expect(page.locator('#editor')).toHaveAttribute('data-editor-kind', 'instrument');
  await page.keyboard.press('Escape');
  await expect(list.first()).toBeFocused();
  await page.locator('#watch').press('Enter');
  const legend = page.locator('#preview-expanded .spiral-legend li');
  await expect(legend).toHaveCount(14);
  for (const [i, name] of names.entries()) await expect(legend.nth(i)).toContainText(name);
  expect(
    await legend.evaluateAll((nodes) => nodes.every((n) => n.scrollWidth <= n.clientWidth)),
  ).toBe(true);
  await expect(
    page.locator('#preview-expanded [data-editor-target], #preview-expanded [data-list-id]'),
  ).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#preview-close').press('Enter');
  await expect(page.locator('#watch')).toBeFocused();
});
