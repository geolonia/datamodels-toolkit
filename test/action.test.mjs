// The Action (action.yml) gives the job token only to the step that fetches
// the base branch; the steps that run this package get no token (#127). The
// Action workflow runs the steps themselves; this test keeps the split.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';

const ROOT = join(import.meta.dirname, '..');
const RUNNER_TOKENS = ['ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_URL', 'ACTIONS_RUNTIME_TOKEN'];

const steps = async () => parse(await readFile(join(ROOT, 'action.yml'), 'utf8')).runs.steps;
const usesToken = (step) => JSON.stringify(step).includes('github.token');
const runsToolkit = (step) => /\bnode\b/.test(step.run ?? '');

test('only the base-branch fetch gets the job token, and it runs no node', async () => {
  const withToken = (await steps()).filter(usesToken);
  assert.deepEqual(withToken.map((s) => s.name), ['Fetch the base branch']);
  const [fetch] = withToken;
  assert.equal(fetch.if, "github.base_ref != ''");
  assert.ok(!runsToolkit(fetch), 'the fetch step runs no node');
  assert.match(fetch.run, /git -C "\$NODE_DIR" fetch/);
  assert.doesNotMatch(fetch.run, /\$TOKEN[^"]*" *git|git[^\n]*\$TOKEN/, 'the token is not on the git command line');
});

test('the steps that run the toolkit get no token and drop the runner tokens first', async () => {
  const toolkit = (await steps()).filter(runsToolkit);
  assert.deepEqual(toolkit.map((s) => s.name), ['Check', 'Build']);
  for (const step of toolkit) {
    assert.ok(!usesToken(step), `${step.name}: no job token`);
    const first = step.run.split('\n')[0];
    for (const name of RUNNER_TOKENS) assert.ok(first.startsWith('unset ') && first.includes(name), `${step.name}: unsets ${name} first`);
  }
});

test('the check still compares with the fetched base branch', async () => {
  const check = (await steps()).find((s) => s.name === 'Check');
  assert.match(check.run, /--base "origin\/\$BASE_REF"/);
});
