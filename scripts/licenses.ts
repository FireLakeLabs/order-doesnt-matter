import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';
import type { OutputBundle } from 'rollup';

const read = (path: string) => readFileSync(path, 'utf8');
const vendored = (name: string) => read(resolve('scripts/licenses', name));
export function deployedCommit(
  env = process.env,
  git = () =>
    execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
): string | null {
  try {
    const sha = (env.GITHUB_SHA || git()).trim();
    return /^[a-f\d]{40}$/i.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

export function packageNotice(directory: string) {
  const meta = JSON.parse(read(join(directory, 'package.json')));
  const files = readdirSync(directory).filter((name) =>
    /^(licen[cs]e|copying|notice)([.-]|$)/i.test(name),
  );
  if (!files.length && meta.name === '@tonaljs/progression' && meta.license === 'MIT')
    return `${meta.name}@${meta.version} — MIT\n${vendored('tonal-MIT.txt')}`;
  if (!files.length && meta.name === 'chord-voicings' && meta.version === '0.0.1')
    return `${meta.name}@${meta.version} — ISC\n${vendored('chord-voicings-ISC.txt')}`;
  if (!meta.license || !files.length) throw Error(`Missing licence text: ${meta.name}`);
  return `${meta.name}@${meta.version} — ${meta.license}\n${files
    .sort()
    .map((file) => `${file}\n${read(join(directory, file))}`)
    .join('\n')}`;
}

export function generateLicenses(moduleIds: Iterable<string>) {
  const directories = new Set<string>();
  for (const id of moduleIds) {
    if (!id.includes('/node_modules/')) continue;
    let directory = dirname(id.replace(/^\0/, '').split('?')[0]);
    while (directory.includes('/node_modules/')) {
      if (existsSync(join(directory, 'package.json'))) {
        const meta = JSON.parse(read(join(directory, 'package.json')));
        if (meta.name) {
          directories.add(directory);
          break;
        }
      }
      directory = dirname(directory);
    }
  }
  const notices = [...directories].map(packageNotice);
  // These published artifacts already contain dependencies invisible to Rollup.
  // Their audited inventories are tied to the exact artifact, not our lockfile.
  for (const directory of directories) {
    const { name, version } = JSON.parse(read(join(directory, 'package.json')));
    const file = resolve('scripts/licenses', `${name.replaceAll('/', '-')}-${version}.txt`);
    if (['@strudel/web', 'superdough', '@kabelsalat/web'].includes(name)) {
      if (!existsSync(file)) throw Error(`Missing embedded licence inventory: ${name}@${version}`);
      notices.push(readFileSync(file, 'utf8'));
    }
  }
  return (
    [
      "Order Doesn't Matter — licences and third-party notices",
      'Our source is MIT. The app as distributed includes AGPL-3.0-or-later software.\nNo warranty. See About for corresponding source and the deployed commit.',
      `Order Doesn't Matter — MIT\n${read(resolve('LICENSE'))}`,
      vendored('assets.txt'),
      vendored('Octicons.txt'),
      `AGPL-3.0 full text\n${vendored('AGPL-3.0.txt')}`,
      ...notices.sort(),
    ].join('\n\n============================================================\n\n') + '\n'
  );
}

export function licencePlugins() {
  const modules = new Set<string>();
  const collect = (bundle: OutputBundle) => {
    for (const chunk of Object.values(bundle))
      if (chunk.type === 'chunk')
        for (const [id, info] of Object.entries(chunk.modules))
          if (info.renderedLength > 0) modules.add(id);
  };
  return {
    worker: (): Plugin => ({
      name: 'worker-licences',
      generateBundle(_, bundle) {
        collect(bundle);
      },
    }),
    app: (): Plugin => ({
      name: 'app-licences',
      buildStart() {
        modules.clear();
      },
      generateBundle(_, bundle) {
        collect(bundle);
        this.emitFile({
          type: 'asset',
          fileName: 'licenses.txt',
          source: generateLicenses(modules),
        });
      },
    }),
  };
}
