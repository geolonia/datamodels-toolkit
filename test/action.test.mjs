// The Action (action.yml) gives the job token only to the step that fetches
// the base branch, and only through git's environment; every other step runs
// without a token and drops the runner's OIDC request variables first (#127).
// The Action workflow runs the steps themselves; this test keeps the split.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';

const ROOT = join(import.meta.dirname, '..');
const UNSET = ['ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_URL', 'GITHUB_TOKEN', 'GH_TOKEN'];
const FETCH = 'Fetch the base branch';

const steps = async () => parse(await readFile(join(ROOT, 'action.yml'), 'utf8')).runs.steps;
// Any way a step could reach a token: github.token in any spelling, a secret,
// or an env entry named or valued like a token. The exact unset line names
// tokens to drop them, so it does not count.
const withoutUnset = (run) => (run ?? '').split('\n').filter((l) => l.trim() !== `unset ${UNSET.join(' ')}`).join('\n');
// An empty `token` input (setup-node) turns the action's default off.
const withoutEmptyToken = (w) => (w && w.token === '' ? { ...w, token: undefined } : w);
const mentionsToken = (step) => /token|secrets\./i.test(JSON.stringify({ env: step.env, with: withoutEmptyToken(step.with), run: withoutUnset(step.run) }));
// The shell's commands, with continued lines joined.
const commands = (run) => run.replace(/\\\n\s*/g, ' ').split('\n').map((l) => l.trim()).filter(Boolean);

test('only the base-branch fetch gets the job token, on pull requests', async () => {
  const all = await steps();
  assert.deepEqual(all.filter(mentionsToken).map((s) => s.name), [FETCH]);
  const fetch = all.find((s) => s.name === FETCH);
  assert.equal(fetch.if, "github.base_ref != ''");
  assert.equal(fetch.env.TOKEN, '${{ github.token }}');
  assert.ok(all.indexOf(fetch) < all.findIndex((s) => s.name === 'Check'), 'the fetch comes before the check');
});

test('the fetch step runs only git, and the token reaches git only in its environment', async () => {
  const fetch = (await steps()).find((s) => s.name === FETCH);
  for (const c of commands(fetch.run)) {
    assert.doesNotMatch(c, /\b(node|npx|npm|datamodels)\b|\.mjs\b/, `runs no toolkit code: ${c}`);
    if (!/\bgit\b/.test(c)) continue;
    // The only place for the token: the value of GIT_CONFIG_VALUE_0, before git.
    const rest = c.replace(/^GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="[^"]*" GIT_CONFIG_VALUE_0="AUTHORIZATION: basic \$auth" /, '');
    assert.doesNotMatch(rest, /\$\{?(TOKEN|auth)\b/, `no token on the git command line: ${c}`);
  }
  assert.ok(commands(fetch.run).some((c) => c.includes('git -C "$NODE_DIR" fetch')));
});

test('every other run step starts by dropping the runner variables and caller tokens', async () => {
  const others = (await steps()).filter((s) => s.run && s.name !== FETCH);
  assert.deepEqual(others.map((s) => s.name), ['Install the toolkit', 'Check', 'Build']);
  for (const step of others) {
    const [first] = commands(step.run);
    assert.deepEqual(first.split(/\s+/), ['unset', ...UNSET], `${step.name}: unsets first`);
  }
});

test('setup-node gets no job token, and only the deploy actions keep theirs', async () => {
  const uses = (await steps()).filter((s) => s.uses);
  assert.equal(uses.find((s) => s.uses.startsWith('actions/setup-node@')).with.token, '');
  // The deploy actions need the job token (their default) and run only when deploying.
  const rest = uses.filter((s) => !s.uses.startsWith('actions/setup-node@'));
  assert.deepEqual(rest.map((s) => s.uses.split('@')[0]), ['actions/upload-pages-artifact', 'actions/deploy-pages']);
  for (const s of rest) assert.equal(s.if, "inputs.deploy == 'true'");
});

test('the check still compares with the fetched base branch', async () => {
  const check = (await steps()).find((s) => s.name === 'Check');
  assert.match(check.run, /--base "origin\/\$BASE_REF"/);
});
