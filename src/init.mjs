// datamodels init (#11): every file a new data model node needs, generated
// here with the answers filled in (no template repository, decided
// 2026-10-10). In a folder that already has files, for example a repository
// made by the Backstage scaffolder, it only adds what is missing: a file that
// exists is left as it is, and .gitignore gets the lines it lacks.
import { mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import YAML from 'yaml';
import { settingsProblems } from './build/node.mjs';

// The version of this repository's GitHub Action a new node's workflow uses:
// the commit SHA of a release tag, with the tag as a comment, so Dependabot
// can propose newer releases. A release updates both (it cannot point to
// itself: the tag is made after the release commit).
export const ACTION_REF = '73bee7bf36020685b04477c9342fa101d34511bc';
export const ACTION_VERSION = 'v0.1.0';
const CHECKOUT = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1';
const GITIGNORE = ['_site/', 'node_modules/'];
const SUBJECT_NAME = /^[a-z][a-z0-9-]*$/;
const REPO_NAME = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

/**
 * The settings and the first subject from the answers, checked. Returns
 * { node, subject, problems }. Answers: baseUrl, iris (hash), languages
 * ([en]), publisherName, publisherUrl, license (CC0-1.0), subject, github (owner/name).
 */
export function initSettings({ baseUrl, iris = 'hash', languages = ['en'], publisherName, publisherUrl, license = 'CC0-1.0', subject, github }) {
  const node = {
    baseUrl: typeof baseUrl === 'string' ? baseUrl.replace(/\/+$/, '') : baseUrl,
    iris, languages,
    publisher: { name: { [languages?.[0] ?? 'en']: publisherName }, url: publisherUrl },
    license,
  };
  const problems = settingsProblems(node);
  if (typeof subject !== 'string' || !SUBJECT_NAME.test(subject)) problems.push('the first subject needs a name in lower case letters, digits and hyphens, for example road');
  // Checked here too, so a wrong --github stops init before it writes anything.
  if (github !== undefined && !REPO_NAME.test(github)) problems.push(`--github needs owner/name, got ${JSON.stringify(github)}`);
  return { node, subject, problems };
}

/** The files of a new node: [{ path, content }], paths relative to the node. */
export function nodeFiles({ node, subject }) {
  const namespace = node.iris === 'hash' ? `${node.baseUrl}/ns/${subject}#` : `${node.baseUrl}/ns/${subject}/`;
  const perLanguage = (text) => Object.fromEntries(node.languages.map((l) => [l, text]));
  const yaml = (o) => YAML.stringify(o, { lineWidth: 0 });
  return [
    { path: 'node.yaml', content: `# The settings of this data model node (https://github.com/geolonia/datamodels/blob/main/docs/node.md).
# The base URL and the IRI form are part of every IRI the node publishes: do not change them once published.
${yaml(node)}` },
    { path: `models/${subject}/subject.yaml`, content: `# A subject: models that share one @context and one vocabulary. Write the title and description in each language.
${yaml({ name: subject, version: '0.1.0', source: 'minted', title: perLanguage(subject), description: perLanguage(`The models of ${subject}.`) })}` },
    { path: `models/${subject}/context.jsonld`, content: `${JSON.stringify({ '@context': { [subject]: namespace } }, null, 2)}\n` },
    { path: '.github/workflows/publish.yml', content: workflow() },
    { path: 'README.md', content: readme({ node, subject }) },
  ];
}

function workflow() {
  return `# Checks the node on pull requests; on main, builds it and deploys it to GitHub Pages
# (Settings → Pages → Source: GitHub Actions). Written by datamodels init.
name: Publish
on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

permissions: {}

jobs:
  check:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: read
    steps:
      - uses: ${CHECKOUT}
        with:
          persist-credentials: false
      - uses: geolonia/datamodels-toolkit@${ACTION_REF} # ${ACTION_VERSION}
        with:
          deploy: 'false'

  publish:
    if: github.event_name != 'pull_request'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: read
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: \${{ steps.node.outputs.page_url }}
    concurrency:
      group: pages
      cancel-in-progress: false
    steps:
      - uses: ${CHECKOUT}
        with:
          persist-credentials: false
      - id: node
        uses: geolonia/datamodels-toolkit@${ACTION_REF} # ${ACTION_VERSION}
`;
}

function readme({ node, subject }) {
  const name = Object.values(node.publisher.name)[0];
  return `# Data models by ${name}

A data model node: JSON Schemas, JSON-LD @contexts and vocabularies at ${node.baseUrl}, built with [datamodels-toolkit](https://github.com/geolonia/datamodels-toolkit) (what a node publishes: [docs/node.md](https://github.com/geolonia/datamodels/blob/main/docs/node.md)).

- \`node.yaml\`: the settings.
- \`models/${subject}/\`: the first subject. A model is a folder in it with \`schema.json\`, \`catalog.yaml\` and \`examples/example.json\`, laid out as in [datamodels.jp](https://github.com/geolonia/datamodels/tree/main/models).
- \`.github/workflows/publish.yml\`: checks pull requests, and publishes main to GitHub Pages.

\`\`\`bash
npx github:geolonia/datamodels-toolkit#${ACTION_VERSION} check
npx github:geolonia/datamodels-toolkit#${ACTION_VERSION} build   # into _site/
\`\`\`
`;
}

const exists = (p) => stat(p).then(() => true, () => false);

/**
 * Write the node's files into `dir`, never over an existing file. Returns
 * { added, kept, appended }: paths written, paths left as they were, and
 * .gitignore when lines were added to it.
 */
export async function writeNode(dir, settings) {
  const added = [], kept = [], appended = [];
  for (const f of nodeFiles(settings)) {
    const file = join(dir, f.path);
    if (await exists(file)) { kept.push(f.path); continue; }
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, f.content, { flag: 'wx' });
    added.push(f.path);
  }
  const gitignore = join(dir, '.gitignore');
  if (await exists(gitignore)) {
    const text = await readFile(gitignore, 'utf8');
    const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
    const missing = GITIGNORE.filter((l) => !have.has(l) && !have.has(l.replace(/\/$/, '')) && !have.has(`/${l}`));
    if (missing.length) { await writeFile(gitignore, `${text}${text.endsWith('\n') || !text ? '' : '\n'}${missing.join('\n')}\n`); appended.push('.gitignore'); } else kept.push('.gitignore');
  } else {
    await writeFile(gitignore, `${GITIGNORE.join('\n')}\n`, { flag: 'wx' });
    added.push('.gitignore');
  }
  return { added, kept, appended };
}

/** owner/name of a GitHub remote URL (https or ssh), or null. */
export function githubRepoOf(url) {
  const m = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9-]+\/[A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(String(url).trim());
  return m ? m[1] : null;
}

// Paths in `git status --porcelain -z`; a rename or copy is followed by its old path.
function statusPaths(out) {
  const parts = out.split('\0').filter(Boolean);
  const paths = [];
  for (let i = 0; i < parts.length; i++) {
    paths.push(parts[i].slice(3));
    if (/^[RC]/.test(parts[i])) i++;
  }
  return paths;
}

/**
 * Put the node on GitHub with the gh CLI. In a folder without a remote, commit
 * only the files init wrote (`files`) and create the public repository `repo`
 * (owner/name); anything else in the folder stops it, so nothing else is
 * published. In a folder whose remote is that repository, only turn on GitHub
 * Pages. `run(cmd, args, opts)` runs a command without a shell and returns its
 * standard output. Returns the steps taken, in words.
 */
export async function publishToGitHub(dir, repo, { run, files = [] }) {
  if (!REPO_NAME.test(repo)) throw new Error(`--github needs owner/name, got ${JSON.stringify(repo)}`);
  const steps = [];
  await run('gh', ['auth', 'status']);
  const hasGit = await exists(join(dir, '.git'));
  const remotes = hasGit ? (await run('git', ['remote'], { cwd: dir })).split('\n').map((r) => r.trim()).filter(Boolean) : [];
  if (remotes.length) {
    // Pages goes to the repository the folder pushes to, so --github must name it.
    const urls = [];
    for (const r of remotes) urls.push((await run('git', ['remote', 'get-url', r], { cwd: dir })).trim());
    if (!urls.some((u) => githubRepoOf(u)?.toLowerCase() === repo.toLowerCase())) throw new Error(`the folder's remote (${urls.join(', ')}) is not github.com/${repo}; give --github the repository it points to`);
    steps.push(`kept the remote (github.com/${repo}); no repository created`);
  } else {
    const ours = new Set(files);
    // Generated or ignored folders that .gitignore keeps out of the commit.
    const ignored = (p) => GITIGNORE.some((g) => p.startsWith(g));
    if (hasGit) {
      // The workflow publishes main: a push from another branch would never deploy.
      const branch = (await run('git', ['branch', '--show-current'], { cwd: dir })).trim();
      if (branch !== 'main') throw new Error(`the workflow publishes the branch main, but this repository is on ${branch || 'no branch'}; switch to main first (git branch -m main)`);
      const other = statusPaths(await run('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: dir })).filter((p) => !ours.has(p));
      if (other.length) throw new Error(`other changes in the folder would be published with the node: ${other.slice(0, 5).join(', ')}${other.length > 5 ? ', …' : ''}. Commit or remove them first`);
    } else {
      const all = (await readdir(dir, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'));
      const other = all.filter((p) => !ours.has(p) && !ignored(p));
      if (other.length) throw new Error(`the folder has other files that would be published with the node: ${other.slice(0, 5).join(', ')}${other.length > 5 ? ', …' : ''}. Move them out, or make the repository yourself`);
      await run('git', ['init', '-b', 'main'], { cwd: dir });
      steps.push('git init');
    }
    // Only the files init wrote; nothing else is in the folder by now.
    if (files.length) await run('git', ['add', '--', ...files], { cwd: dir });
    const staged = (await run('git', ['diff', '--cached', '--name-only'], { cwd: dir })).trim();
    if (staged) { await run('git', ['commit', '-m', 'Start a data model node (datamodels init)'], { cwd: dir }); steps.push('first commit'); }
    await run('gh', ['repo', 'create', repo, '--public', '--source', dir, '--remote', 'origin', '--push']);
    steps.push(`created https://github.com/${repo} and pushed`);
  }
  // GitHub Pages from GitHub Actions; PUT when Pages is already on.
  try { await run('gh', ['api', '-X', 'POST', `repos/${repo}/pages`, '-f', 'build_type=workflow']); } catch { await run('gh', ['api', '-X', 'PUT', `repos/${repo}/pages`, '-f', 'build_type=workflow']); }
  steps.push('GitHub Pages: deployed by GitHub Actions');
  return steps;
}
