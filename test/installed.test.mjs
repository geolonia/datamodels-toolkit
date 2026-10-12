// The toolkit installed in a project (npm i @geolonia/datamodels) and run
// from that project's folder: its own files are then under node_modules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, cp, readdir, symlink, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = join(import.meta.dirname, '..');

test('build writes the pages when the toolkit is installed in the project and run from it', async () => {
  const project = await mkdtemp(join(tmpdir(), 'datamodels-installed-'));
  const modules = join(project, 'node_modules');
  // A copy, not a link: Node would follow a link to the real path, outside node_modules.
  const toolkit = join(modules, '@geolonia', 'datamodels');
  await mkdir(toolkit, { recursive: true });
  for (const f of ['bin', 'src', 'package.json']) await cp(join(ROOT, f), join(toolkit, f), { recursive: true });
  // The toolkit's dependencies, as npm puts them next to it.
  for (const name of await readdir(join(ROOT, 'node_modules'))) {
    if (name.startsWith('.') || name === '@geolonia') continue;
    await symlink(join(ROOT, 'node_modules', name), join(modules, name));
  }
  await writeFile(join(project, '.gitignore'), 'node_modules\n');
  await cp(join(ROOT, 'test', 'fixtures', 'node'), join(project, 'node1'), { recursive: true });
  await run(process.execPath, [join(toolkit, 'bin', 'datamodels.mjs'), 'build', 'node1'], { cwd: project });
  const site = join(project, 'node1', '_site');
  await access(join(site, 'catalog.json'));
  for (const page of ['index.html', '404.html']) await assert.doesNotReject(access(join(site, page)), page);
});
