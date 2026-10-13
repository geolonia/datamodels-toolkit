# datamodels-toolkit

Command-line tools and a GitHub Action for the [datamodels.jp](https://datamodels.jp) catalog: publish data models of your own on a site of your own, convert CSV lists into entities of a model, and export models for tools that do not read NGSI-LD.

**Documentation: [datamodels.jp/en/toolkit](https://datamodels.jp/en/toolkit/)** ([日本語](https://datamodels.jp/toolkit/)), with every command and option in the [command reference](https://datamodels.jp/en/toolkit/reference).

**To publish data models of your own** as a website, use the [GitHub Action](#github-action).

## Install

Node.js 24 or later. Run a release of [`@geolonia/datamodels`](https://www.npmjs.com/package/@geolonia/datamodels) with `npx`:

```bash
npx @geolonia/datamodels@0.3.11 --help
```

Or add it to a project (`npm install --save-dev @geolonia/datamodels@0.3.11`) and run `npx datamodels …` there. Releases before 0.3.8 are not on npm; they run from GitHub (`npx github:geolonia/datamodels-toolkit#v0.3.7 …`).

## Commands

| Command | What it does | Docs |
|---|---|---|
| `search`, `nodes` | Find existing models in datamodels.jp and the sites it links to | [Your site's models](https://datamodels.jp/en/toolkit/models#search) |
| `convert`, `mapping` | Turn a CSV list into entities of a model, with a mapping file | [Converting your data](https://datamodels.jp/en/toolkit/convert) |
| `export` | A CSV template, a Table Schema, a JSON Schema for AI output, a PostgreSQL / PostGIS table | [Exporting to other tools](https://datamodels.jp/en/toolkit/export) |
| `init` | Start a site of your own for your models (a node) | [Starting a site](https://datamodels.jp/en/toolkit/start) |
| `add`, `extend` | Add a model to your site, or start from a catalog model | [Your site's models](https://datamodels.jp/en/toolkit/models) |
| `check`, `build` | Check the node and build its files and pages | [Checking and building](https://datamodels.jp/en/toolkit/check), [The node and build](https://datamodels.jp/en/toolkit/node) |
| `bump`, `release`, `upgrade` | Change a published model in a new version; move to a newer toolkit | [Versions](https://datamodels.jp/en/toolkit/versions) |

```bash
npx @geolonia/datamodels@0.3.11 search 避難
npx @geolonia/datamodels@0.3.11 convert disaster/EvacuationSite jichitai-opendata-site sites.csv --out sites.json
npx @geolonia/datamodels@0.3.11 export disaster/EvacuationSite --to csv
npx @geolonia/datamodels@0.3.11 init my-models
```

## GitHub Action

**What it is for.** A data model describes one kind of data, for example an evacuation site or a road closure: which attributes it has, what each one means, and in which format. When your city, company or project defines data models of its own, other people and their programs need to find them at web addresses that never change, in formats that tools can read (JSON Schema and a JSON-LD `@context`), with a page that people can read.

This Action does that for you. You keep your models in a GitHub repository, and every change goes online as a website on GitHub Pages: no server, and every change checked before it is published.

- **On every pull request** it checks the models: the schemas, the examples, and that each term means what the schema says. The published versions of the schemas, `@context` files and vocabulary must stay exactly the same; examples and pages can still be corrected. (Not yet caught: deleting a whole published release folder, [#93](https://github.com/geolonia/datamodels-toolkit/issues/93).) A mistake shows up as a failed check, before anything goes online.
- **On every push to `main`** it builds the website and publishes it on GitHub Pages: a page for each model, the JSON Schemas, the `@context` files, the vocabulary, and files for spreadsheets, AI and PostgreSQL.

You need it only to publish data models of your own. To use existing models, start at [datamodels.jp](https://datamodels.jp/en/).

**Start in three steps** ([Starting a site](https://datamodels.jp/en/toolkit/start), step by step):

1. Run `npx @geolonia/datamodels@0.3.11 init my-models`. It asks a few questions (the web address, who publishes, the first subject) and writes the repository: the settings (`node.yaml`), a folder for your models (`models/`) and the workflow with this Action.
2. Put the folder on GitHub, and in the repository settings set Pages to deploy from GitHub Actions. With the [GitHub CLI](https://cli.github.com/), add `--github my-org/my-models` to the command of step 1, and `init` does both.
3. Add your models ([Your site's models](https://datamodels.jp/en/toolkit/models)). Each push to `main` updates the site.

Sites that run on it: [models.geolonia.com](https://models.geolonia.com/) ([repository](https://github.com/geolonia/models)) and [models.gtt-project.org](https://models.gtt-project.org/) ([repository](https://github.com/gtt-project/models)).

**The workflow.** `init` writes it, so you do not need to write it yourself. Its main step:

```yaml
- uses: geolonia/datamodels-toolkit@eed03254a925ef9262de5c6c5f6e1bfde5394949 # v0.3.11
  with:
    deploy: 'false'   # on pull requests: check and build, publish nothing
```

<details>
<summary>The whole workflow that <code>init</code> writes</summary>

```yaml
# .github/workflows/publish.yml
# Checks the node on pull requests; on main, builds it and deploys it to GitHub Pages
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
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: geolonia/datamodels-toolkit@eed03254a925ef9262de5c6c5f6e1bfde5394949 # v0.3.11
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
      url: ${{ steps.node.outputs.page_url }}
    concurrency:
      group: pages
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - id: node
        uses: geolonia/datamodels-toolkit@eed03254a925ef9262de5c6c5f6e1bfde5394949 # v0.3.11
```

</details>

Inputs: `directory` (default `.`), `deploy` (default `true`), `offline` (default `false`). Outputs: `page_url`, and `site`, the folder with the built files, for a step that publishes them on [another host](https://datamodels.jp/en/toolkit/hosts). `datamodels upgrade` moves the pin to a newer release, and Dependabot can propose it ([Checking and building](https://datamodels.jp/en/toolkit/check#action)).

## Build library

`@geolonia/datamodels/build` builds the machine-readable files of a catalog from a models folder: every published version, the @contexts, vocabularies, JSON Schemas, examples, mapping files and `catalog.json`. It is the code datamodels.jp runs, with the base URL and the required languages as options, so a node of the [web of data models](https://github.com/geolonia/datamodels/issues/200) builds its files the same way ([The node and build](https://datamodels.jp/en/toolkit/node)).

```js
import { catalogUrls, loadSubjects, publishCatalog } from '@geolonia/datamodels/build';

const urls = catalogUrls('https://models.example.org', { iris: 'hash' }); // slash IRIs without it
const subjects = await loadSubjects('models', { urls, languages: ['en'], subjectFields: ['title', 'description'] });
await publishCatalog(subjects, { urls, outDir: 'dist', languages: ['en'], head: { license: 'CC0-1.0' } });
```


## Agent skill

`skills/datamodels/SKILL.md` gives an AI agent the catalog's modelling rules and this toolkit's workflow ([Agent skill](https://datamodels.jp/en/toolkit/#agent-skill)). It is not in the npm package; copy the folder from this repository into your project's `.claude/skills/`.

## Development

```bash
npm ci
npm test
```

The tests read `test/fixtures/site/`, a copy of the files datamodels.jp serves for the mappings they use. After the catalog changes one of those models or mappings, refresh it with `npm run fixtures` and commit the result.

`test/fixtures/catalog/` holds the sources of two subjects of [geolonia/datamodels](https://github.com/geolonia/datamodels) and the files datamodels.jp serves for them; the build library must produce exactly those files. Refresh it with `npm run fixtures:build -- <path to a datamodels checkout>` when the catalog changes those subjects.

### Releases

A release reaches npmjs.org through the workflow `.github/workflows/publish.yml`:

1. A release pull request raises `version` in `package.json` (and `package-lock.json`, for example with `npm version X.Y.Z --no-git-tag-version`) and runs `npm run changelog -- X.Y.Z`: it moves the change files in `changes/` into `CHANGELOG.md` under `## [X.Y.Z] - <today>` and deletes them. Then write the summary line of the release under that heading.
2. After it is merged, tag the merge commit `vX.Y.Z` and publish a GitHub release for the tag.
3. The workflow checks that the tag is `v` followed by the version in `package.json`, runs the tests, and stages `@geolonia/datamodels` on npmjs.org (`npm stage publish`). A pre-release on GitHub stages nothing.
4. A maintainer of the package approves the staged release, with 2FA: on npmjs.com, in the package's Staged Packages tab, or with `npm stage list @geolonia/datamodels` and `npm stage approve <stage-id>` (npm 11.15.0 or later; [staged publishing](https://docs.npmjs.com/staged-publishing)). Only then is the version public. The workflow cannot approve: approval needs 2FA, and the workflow's OIDC token cannot give it.
5. Then pin `init` (`ACTION_REF`, `ACTION_VERSION` in `src/init.mjs`) and the README's `npx` lines to the new release.

The workflow uses npm's [trusted publishing](https://docs.npmjs.com/trusted-publishers): npm accepts GitHub's OIDC token, so there is no npm token in the repository, and npm adds provenance (the commit and the workflow that built the package). The trusted publisher in the package's settings on npmjs.com names this repository and the file `publish.yml`, and allows staging only, not `npm publish`; after renaming the file, change that setting too.

## Issues and contributions

Problems with the tool go to [this repository's issues](https://github.com/geolonia/datamodels-toolkit/issues). Questions about a model or a mapping file go to [geolonia/datamodels](https://github.com/geolonia/datamodels/issues). Pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). The documentation is in [geolonia/datamodels](https://github.com/geolonia/datamodels) (`site/toolkit/`, `site/en/toolkit/`): a change to a command changes its page there too. Changes are listed in [CHANGELOG.md](CHANGELOG.md); a pull request adds its entry as a file in [`changes/`](changes/README.md), not in CHANGELOG.md.

## Licence

The code is [Apache-2.0](LICENSE). The files in `test/fixtures/site/` come from datamodels.jp and are CC0 1.0 ([licence](https://datamodels.jp/LICENSE-CONTENT)). The sample rows in the tests come from Utsunomiya City's and GSI's published lists (CC BY 4.0 and compatible terms), credited where they are used.
