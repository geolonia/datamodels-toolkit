// The package's entry points (package.json "exports"), as a project imports them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import * as ngsi from '../src/ngsi.mjs';

const run = promisify(execFile);

test('@geolonia/datamodels/ngsi is the NGSI-LD module', async () => {
  assert.equal(await import('@geolonia/datamodels/ngsi'), ngsi);
  assert.equal(typeof ngsi.toNormalized, 'function');
});

test('importing the library does not load Eleventy; writing pages does', async () => {
  // Eleventy is large and only writes the pages (geolonia/datamodels#226).
  const probe = `
    import { registerHooks } from 'node:module';
    const seen = [];
    registerHooks({ resolve(s, c, next) { if (s.startsWith('@11ty/')) seen.push(s); return next(s, c); } });
    const build = await import('@geolonia/datamodels/build');
    await import('@geolonia/datamodels/ngsi');
    await import('@geolonia/datamodels/adapters');
    const before = seen.length;
    await build.writePages([], { urls: build.catalogUrls('https://models.example.org'), node: { languages: ['en'] }, out: process.argv[1] }).catch(() => {});
    console.log(JSON.stringify([before, seen.length > 0]));
  `;
  const out = await mkdtemp(join(tmpdir(), 'datamodels-exports-'));
  const { stdout } = await run(process.execPath, ['--input-type=module', '-e', probe, out], { cwd: import.meta.dirname });
  assert.deepEqual(JSON.parse(stdout), [0, true]);
});
