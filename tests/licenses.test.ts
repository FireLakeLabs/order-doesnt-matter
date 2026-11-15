import { expect, test } from 'vitest';
import { resolve } from 'node:path';
import { deployedCommit, generateLicenses } from '../scripts/licenses';

test('bundle notices include Strudel and the AGPL, without installed dev dependencies', () => {
  const text = generateLicenses([
    resolve('node_modules/@strudel/core/dist/index.mjs'),
    resolve('node_modules/acorn/dist/acorn.mjs'),
    resolve('src/app/main.ts'),
  ]);
  expect(text).toContain('@strudel/core@1.2.6 — AGPL-3.0-or-later');
  expect(text).toContain('acorn@8.15.0 — MIT');
  expect(text).toContain('AGPL-3.0 full text\n');
  expect(text.match(/GNU AFFERO GENERAL PUBLIC LICENSE/g)).toHaveLength(2);
  expect(text).toContain('17. Interpretation of Sections 15 and 16.');
  expect(text).toContain('Primer Octicons');
  expect(text).toContain('Strudel logo');
  expect(text).not.toContain('webmidi@');
  for (const dev of ['vitest', 'playwright', 'eslint', 'typescript'])
    expect(text).not.toContain(dev);
});

test('source commit prefers Actions, uses local git, and tolerates unavailable metadata', () => {
  const sha = 'a'.repeat(40);
  expect(
    deployedCommit({ GITHUB_SHA: sha }, () => {
      throw Error('no git');
    }),
  ).toBe(sha);
  expect(deployedCommit({}, () => `${sha}\n`)).toBe(sha);
  expect(
    deployedCommit({}, () => {
      throw Error('no git');
    }),
  ).toBeNull();
  expect(deployedCommit({ GITHUB_SHA: '<invalid>' })).toBeNull();
});

test('published web prebundle retains its embedded versions and worklet notices', () => {
  const text = generateLicenses([resolve('node_modules/@strudel/web/dist/index.mjs')]);
  expect(text).toContain('fraction.js@5.2.1 — MIT');
  expect(text).toContain('acorn@8.14.0 — MIT');
  expect(text).toContain('@kabelsalat/lib@0.4.1 — AGPL-3.0-or-later');
  expect(text).not.toContain('webmidi@');
  expect(text).not.toContain('vitest@');
});

test('reviewed Driver runtime is exact, typed, and carries its complete MIT notice', () => {
  const text = generateLicenses([resolve('node_modules/driver.js/dist/driver.js.mjs')]);
  expect(text).toContain('driver.js@1.10.2 — MIT');
  expect(text).toContain('Copyright (c) Kamran Ahmed');
  expect(text).toContain('The above copyright notice and this permission notice shall be included');
  expect(text).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
});

test('Studio runtime, copied controls and all bundled fonts retain licence notices', () => {
  const fonts = ['space-grotesk', 'jetbrains-mono', 'bricolage-grotesque', 'vt323', 'silkscreen'];
  const text = generateLicenses([
    ...fonts.map((font) => resolve(`node_modules/@fontsource/${font}/package.json`)),
    resolve('node_modules/react/index.js'),
    resolve('node_modules/react-dom/client.js'),
    resolve('node_modules/@radix-ui/react-dialog/dist/index.mjs'),
    resolve('node_modules/lucide-react/dist/esm/lucide-react.js'),
    resolve('node_modules/react-remove-scroll-bar/dist/es2015/index.js'),
  ]);
  for (const font of fonts) expect(text).toContain(`@fontsource/${font}@5.3.0 — OFL-1.1`);
  expect(text).toContain('SIL OPEN FONT LICENSE');
  expect(text).toContain('react@19.3.1 — MIT');
  expect(text).toContain('react-dom@19.3.1 — MIT');
  expect(text).toContain('@radix-ui/react-dialog@1.3.1 — MIT');
  expect(text).toContain('lucide-react@1.73.0 — ISC');
  expect(text).toContain('react-remove-scroll-bar@2.3.8 — MIT');
  expect(text).toContain('shadcn');
});
