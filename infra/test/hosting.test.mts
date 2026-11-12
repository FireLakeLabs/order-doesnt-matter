import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hosting } from '../config.mts';
import {
  cacheControl,
  contentType,
  createManifest,
  parseManifest,
  publicationOrder,
  publish,
  releaseId,
  resolveTargets,
  restore,
  safePath,
  verifyHomepage,
} from '../scripts/hosting.mts';

const outputs = {
  [hosting.stackName]: {
    StackId: `arn:aws:cloudformation:${hosting.region}:${hosting.account}:stack/${hosting.stackName}/12345678-abcd-1234-abcd-123456789abc`,
    WebsiteBucketName: hosting.websiteBucketName,
    ReleasesBucketName: hosting.releasesBucketName,
    DistributionId: 'E123ABC',
    WebsiteUrl: `https://${hosting.hostname}`,
  },
};
function distribution() {
  return {
    Distribution: {
      ARN: `arn:aws:cloudfront::${hosting.account}:distribution/E123ABC`,
      DistributionConfig: {
        Enabled: true,
        DefaultRootObject: 'index.html',
        ViewerCertificate: { ACMCertificateArn: hosting.certificateArn },
        Aliases: { Items: [hosting.hostname] },
        Origins: {
          Items: [
            {
              Id: 'website',
              DomainName: `${hosting.websiteBucketName}.s3.${hosting.region}.amazonaws.com`,
              OriginAccessControlId: 'E456OAC',
            },
          ],
        },
        DefaultCacheBehavior: {
          TargetOriginId: 'website',
          ViewerProtocolPolicy: 'redirect-to-https',
        },
        CacheBehaviors: {
          Items: [{ TargetOriginId: 'website', ViewerProtocolPolicy: 'redirect-to-https' }],
        },
      },
    },
  };
}
function fake() {
  const calls: string[][] = [];
  const objects = new Map<string, Buffer>();
  const live = distribution();
  const run = (args: string[]): unknown => {
    calls.push(args);
    if (args[0] === 'sts') return { Account: hosting.account };
    if (args[1] === 'get-distribution') return live;
    if (args[1] === 'list-objects-v2')
      return {
        KeyCount: [...objects.keys()].filter((k) =>
          k.startsWith(`s3://${hosting.releasesBucketName}/${args[args.indexOf('--prefix') + 1]}`),
        ).length,
      };
    if (args[1] === 'create-invalidation') return { Invalidation: { Id: 'I123' } };
    if (args[1] === 'wait') return {};
    throw new Error(`Unexpected fake call: ${args}`);
  };
  return { calls, objects, live, run };
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'odm-artifact-'));
  await mkdir(join(directory, 'assets'));
  await mkdir(join(directory, 'harness'));
  await writeFile(
    join(directory, 'index.html'),
    '<script src="/assets/worker-12345678.js"></script>',
  );
  await writeFile(join(directory, 'assets/worker-12345678.js'), 'self.onmessage = () => {}');
  await writeFile(
    join(directory, 'assets/worklet-abcdefgh.js'),
    'registerProcessor("test", class {})',
  );
  await writeFile(join(directory, 'harness/engine.html'), 'test only');
  return directory;
}

test('manifest hashes files, excludes harness, rejects symlinks and unsafe or duplicate paths', async () => {
  const directory = await fixture();
  try {
    const manifest = await createManifest(directory, 'abc-1-1');
    assert.equal(manifest.files.length, 3);
    for (const file of manifest.files)
      assert.equal(
        file.sha256,
        createHash('sha256')
          .update(await readFile(join(directory, file.path)))
          .digest('hex'),
      );
    for (const path of [
      '../index.html',
      '/index.html',
      'a//b',
      'a/./b',
      'a/../b',
      'a\\b',
      'a%2fb',
      '',
    ]) {
      assert.equal(safePath(path), false, path);
    }
    for (const path of ['../x', 'harness/engine.html', 'harness', 'release.json']) {
      assert.throws(() =>
        parseManifest(
          { ...manifest, files: [...manifest.files, { path, sha256: 'a'.repeat(64) }] },
          manifest.release,
        ),
      );
    }
    assert.throws(() =>
      parseManifest(
        { ...manifest, files: [...manifest.files, manifest.files[0]] },
        manifest.release,
      ),
    );
    assert.throws(() =>
      parseManifest({ ...manifest, files: manifest.files.slice(0, 2) }, manifest.release),
    );
    assert.throws(() => parseManifest(manifest, 'different'));
    assert.throws(() => parseManifest({ ...manifest, version: 2 }, manifest.release));
    assert.throws(() => releaseId('../bad'));
    await symlink('/etc/passwd', join(directory, 'link'));
    await assert.rejects(createManifest(directory, 'safe'), /Unsupported artifact/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('HTML is last; cache and MIME headers cover workers and worklets', () => {
  const manifest = parseManifest(
    {
      version: 1,
      release: 'test',
      files: ['index.html', 'assets/worker-12345678.js', 'assets/style-12345678.css'].map(
        (path) => ({ path, sha256: 'a'.repeat(64) }),
      ),
    },
    'test',
  );
  assert.equal(publicationOrder(manifest).at(-1)!.path, 'index.html');
  assert.equal(cacheControl('assets/worker-12345678.js'), 'public,max-age=31536000,immutable');
  for (const path of ['index.html', 'other.html', 'assets/other.html'])
    assert.equal(cacheControl(path), 'no-cache,max-age=0,must-revalidate');
  for (const path of ['assets/worker-12345678.js', 'assets/worklet-12345678.js', 'worklet.mjs'])
    assert.equal(contentType(path), 'text/javascript; charset=utf-8');
  assert.equal(contentType('index.html'), 'text/html; charset=utf-8');
  assert.equal(contentType('engine.wasm'), 'application/wasm');
});

test('target preflight rejects wrong accounts, stack outputs, aliases, origins and behaviors before writes', () => {
  const base = fake();
  assert.equal(resolveTargets(base.run, JSON.stringify(outputs)).bucket, hosting.websiteBucketName);
  assert.throws(
    () => resolveTargets(() => ({ Account: 'wrong' }), JSON.stringify(outputs)),
    /account/,
  );
  for (const key of [
    'StackId',
    'WebsiteBucketName',
    'ReleasesBucketName',
    'DistributionId',
    'WebsiteUrl',
  ]) {
    const bad = structuredClone(outputs);
    bad[hosting.stackName][key] = 'wrong';
    assert.throws(() => resolveTargets(base.run, JSON.stringify(bad)));
  }
  assert.throws(() => resolveTargets(base.run, '{}'));
  assert.throws(() =>
    resolveTargets(base.run, JSON.stringify({ Other: outputs[hosting.stackName] })),
  );
  const mutations = [
    (d: any) => {
      d.Distribution.ARN = 'wrong';
    },
    (d: any) => {
      d.Distribution.DistributionConfig.Enabled = false;
    },
    (d: any) => {
      d.Distribution.DistributionConfig.Aliases.Items.push('other.example');
    },
    (d: any) => {
      d.Distribution.DistributionConfig.Origins.Items[0].DomainName = 'other.s3.amazonaws.com';
    },
    (d: any) => {
      delete d.Distribution.DistributionConfig.Origins.Items[0].OriginAccessControlId;
    },
    (d: any) => {
      d.Distribution.DistributionConfig.CacheBehaviors.Items[0].ViewerProtocolPolicy = 'allow-all';
    },
  ];
  for (const mutate of mutations) {
    const f = fake();
    mutate(f.live);
    assert.throws(() => resolveTargets(f.run, JSON.stringify(outputs)));
    assert(f.calls.every((c) => c[0] === 'sts' || c[1] === 'get-distribution'));
  }
});

test('fake publish commits archive last, uploads assets before HTML, invalidates, verifies and rolls back', async (t) => {
  const previousOutputs = process.env.HOSTING_OUTPUTS;
  process.env.HOSTING_OUTPUTS = JSON.stringify(outputs);
  t.after(() => {
    if (previousOutputs === undefined) delete process.env.HOSTING_OUTPUTS;
    else process.env.HOSTING_OUTPUTS = previousOutputs;
  });
  const directory = await fixture();
  const f = fake();
  // The fake stores uploads/downloads; it never executes a CLI or reaches AWS.
  const run = (args: string[]) => {
    if (args[0] !== 's3') return f.run(args);
    f.calls.push(args);
    if (args[2].startsWith('s3://')) {
      const data = f.objects.get(args[2]);
      if (!data) throw new Error('Incomplete archive');
      // CLI is synchronous, as is this fake's local file transfer.
      writeFileSync(args[3], data);
    } else f.objects.set(args[3], readFileSync(args[2]));
    return {};
  };
  try {
    const manifest = await createManifest(directory, 'abc-1-1');
    let verified = 0;
    const verify = async (url: string, expected: Uint8Array) => {
      assert.equal(url, `https://${hosting.hostname}`);
      assert.deepEqual(
        f.objects.get(`s3://${hosting.websiteBucketName}/index.html`),
        Buffer.from(expected),
      );
      verified++;
    };
    await publish({ run, directory, manifest, archive: true, verifyHomepage: verify });
    const archive = f.calls.filter(
      (c) => c[0] === 's3' && c[3].startsWith(`s3://${hosting.releasesBucketName}/`),
    );
    assert(archive.at(-1)![3].endsWith('/release.json'));
    const website = f.calls.filter(
      (c) => c[0] === 's3' && c[3].startsWith(`s3://${hosting.websiteBucketName}/`),
    );
    assert(website.at(-1)![3].endsWith('/index.html'));
    assert(
      f.calls.findIndex((c) => c[1] === 'create-invalidation') > f.calls.indexOf(website.at(-1)!),
    );
    assert(f.calls.every((c) => !c.some((s) => s.includes('/harness/'))));
    assert(
      f.calls.every((c) => !c.includes('--delete') && c[1] !== 'rm' && c[0] !== 'cloudformation'),
    );
    await assert.rejects(
      publish({ run, directory, manifest, archive: true, verifyHomepage: verify }),
      /already exists/,
    );
    await restore(run, manifest.release, verify);
    assert.equal(verified, 2);
    const interrupted = { ...manifest, release: 'interrupted' };
    const checkpoint = f.calls.length;
    await assert.rejects(
      publish({
        run: (args) => {
          if (args[0] === 's3' && args[3].endsWith('/interrupted/assets/worklet-abcdefgh.js'))
            throw new Error('Interrupted archive upload');
          return run(args);
        },
        directory,
        manifest: interrupted,
        archive: true,
        verifyHomepage: verify,
      }),
      /Interrupted archive/,
    );
    assert(!f.objects.has(`s3://${hosting.releasesBucketName}/interrupted/release.json`));
    assert(
      !f.calls
        .slice(checkpoint)
        .some((c) => c[0] === 's3' && c[3].startsWith(`s3://${hosting.websiteBucketName}/`)),
    );
    await assert.rejects(restore(run, 'interrupted', verify), /Incomplete archive/);
    // All downloads and checksum verification precede any restore write.
    f.objects.set(
      `s3://${hosting.releasesBucketName}/${manifest.release}/assets/worker-12345678.js`,
      Buffer.from('corrupt'),
    );
    const before = f.calls.length;
    await assert.rejects(restore(run, manifest.release, verify), /checksum mismatch/);
    assert(!f.calls.slice(before).some((c) => c[0] === 's3' && c[3].startsWith('s3://')));
    await writeFile(join(directory, 'index.html'), 'changed');
    const count = f.calls.length;
    await assert.rejects(publish({ run, directory, manifest, archive: true }), /checksum mismatch/);
    assert.equal(f.calls.length, count);
    await assert.rejects(restore(run, 'incomplete', verify), /Incomplete archive/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('live verification compares bytes and rejects redirects or error responses (fake fetch)', async (t) => {
  const expected = Buffer.from('homepage');
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options?.redirect, 'error');
    assert.equal(options?.cache, 'no-store');
    return new Response(expected);
  });
  await verifyHomepage(`https://${hosting.hostname}`, expected);
  await assert.rejects(
    verifyHomepage(`https://${hosting.hostname}`, Buffer.from('different')),
    /differs/,
  );
  t.mock.method(globalThis, 'fetch', async () => new Response(expected, { status: 403 }));
  await assert.rejects(verifyHomepage(`https://${hosting.hostname}`, expected), /differs/);
});
