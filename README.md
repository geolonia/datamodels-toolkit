# datamodels-toolkit

Command-line tools for the [datamodels.jp](https://datamodels.jp) catalog.

`convert` turns a published list (CSV) into entities of a catalog model; `build` writes the files of a data model node, a site of your own in the [web of data models](https://github.com/geolonia/datamodels/issues/200). More commands come only when someone needs them for a real task that existing JSON-LD and FIWARE tools do not cover ([geolonia/datamodels#91](https://github.com/geolonia/datamodels/issues/91)).

## Install

Node.js 24 or later. Until the package is on npm, run a release from GitHub:

```bash
npx github:geolonia/datamodels-toolkit#v0.1.0 convert <subject>/<Type> <mapping> <file.csv>
```

## convert

```bash
datamodels convert disaster/EvacuationSite jichitai-opendata-site 092011_evacuation_space.csv --out sites.json
datamodels convert disaster/EvacuationSite gsi-emergency-site 13101_2.csv --set localGovernmentCode=13101
```

This turns, for example, a municipality's 指定緊急避難場所一覧 (自治体標準オープンデータセット 03) or GSI's data into EvacuationSite entities. Each entity is validated against the model's JSON Schema.

- `<subject>/<Type>`: the model, as on its page (`/models/disaster/EvacuationSite/`).
- `<mapping>`: one of the model's mapping files. The model page lists them under "Mapping files (YAML)", and `catalog.json` lists them as `mappingUrls`.
- `--set attribute=value`: a value the list does not carry, such as GSI's municipality code, which is only in the file name.
- `--normalized`: NGSI-LD normalized form instead of key-values, with the subject's `@context` alias and the NGSI-LD core context.
- `--out file.json`: write to a file (default: standard output).
- `--site URL|dir`: where to read the catalog (default `https://datamodels.jp`). A directory laid out like the site also works, for example the `dist/` that `npm run build` makes in [geolonia/datamodels](https://github.com/geolonia/datamodels), to try a mapping before it is published.

It reads `catalog.json`, the model's schema and the mapping file from the site, and any mapping that one names with `via` (such as `common/JapaneseAddress/jichitai-opendata-address` for the address columns). The conversion rules in a mapping file:

- A field with `column` (one column or a list), an optional `transform`, a constant `value`, or `via` is converted.
- The `convert.id` template names the entities.
- Fields with only `to` are documentation.
- Transforms: `text`, `code6`, `number`, `integer`, `numbers`, `flag`, `flags` (with `values`), `split`, `municipality`, `machiazaId`, `nationalShelterType` (`src/convert.mjs`).

It detects UTF-8 and Shift_JIS. It repairs only what it can prove, such as a local government code that lost its leading zero or lacks its check digit (the check digit decides), and lists every repair on standard error. Invalid rows are left out and listed by line. The exit code is 1 when a row is invalid or a file cannot be read, and 2 for a usage error.

## init

```bash
datamodels init my-node      # asks in a terminal
datamodels init --base-url https://models.example.org --publisher "Example Inc." \
  --publisher-url https://example.org/ --subject road --languages ja,en --yes
```

Starts a data model node: `node.yaml`, the first subject in `models/`, a README, `.gitignore` and the workflow that checks pull requests and publishes to GitHub Pages ([GitHub Action](#github-action)). In a terminal it asks for what the options do not give; in CI and scripts it never asks, and a missing answer is a usage error. Defaults: hash IRIs, English, CC0-1.0.

It also works in an existing repository, for example one made by the Backstage scaffolder: it adds only the files that are missing, never overwrites one, and adds its lines to an existing `.gitignore`. It lists what it added and what it kept.

`--github owner/name` (or yes to the question) puts the node on GitHub with the `gh` CLI: in a folder without a remote it makes the first commit and creates the public repository; with a remote it keeps it. Either way it sets GitHub Pages to deploy from GitHub Actions.

## add

```bash
datamodels add road/RoadPatrol           # an entity type
datamodels add road/Segment --value      # a value type, used inside attributes
```

Adds a model to a subject of the node: `schema.json` (with `id` and `type` for an entity), `catalog.yaml` with a title and description in each of the node's languages, `examples/example.json`, and the type in the subject's `@context`. The skeleton builds and passes `check` at once; then add its attributes, each with an `x-iri` and a description in `catalog.yaml`.

## build

```bash
datamodels build             # the node in the current directory, into _site/
datamodels build my-node --out public
```

A node is a folder with `node.yaml` and `models/`. `models/` is laid out as in [geolonia/datamodels](https://github.com/geolonia/datamodels/tree/main/models): one folder per subject with `subject.yaml` and `context.jsonld`, and one folder per model with `schema.json`, `catalog.yaml` and `examples/`. A node needs only one language and has no mapping files or ADOPTERS files ([what a node publishes](https://github.com/geolonia/datamodels/blob/main/docs/node.md)).

```yaml
# node.yaml
baseUrl: https://models.example.org
iris: hash          # /ns/<subject>#<Term>; slash needs w3id.org or a server that redirects
languages: [en]
publisher: { name: { en: Example Inc. }, url: https://example.org/ }
license: CC0-1.0    # required; licenseUrl is optional
nodes:              # optional: nodes you know; a context may import theirs
  - { url: https://datamodels.jp/, index: https://datamodels.jp/catalog.json }
```

It writes `catalog.json`, the @contexts (exact version and alias), JSON Schemas, vocabularies, examples, `llms.txt` and the pages. A model that builds on another node's model lists it in `catalog.yaml` under `extends` (`typeIri`, `version`, `index`).

The pages are plain HTML in a monospace font, with no JavaScript, so they read well with `curl` too ([Eleventy](https://www.11ty.dev/) writes them):

- `/`: the subjects and their models.
- One page per subject. With hash IRIs it is the namespace document (`/ns/<subject>`, written as `ns/<subject>.html`), with an anchor for every type and attribute, so every IRI opens on it.
- One page per model (`/models/<subject>/<Type>/`), with an anchor per attribute.

Every page links to `catalog.json` (`<link rel="alternate" type="application/json">`). The exit code is 1 when the node is invalid, 2 for a usage error.

## check

```bash
datamodels check             # the node in the current directory
datamodels check --offline   # without the network
```

The checks a node runs in CI before it publishes:

- Every schema compiles, and every `examples/example.json` is valid against its schema.
- Every entity type and attribute is a term of the subject's `@context` (or an NGSI-LD core term such as `location`), and expands to the IRI in the schema (`x-iri`). Otherwise JSON-LD drops the attribute, or gives it another meaning. A term from a context imported by URL is checked online; offline it is only noted.
- Release snapshots in `models/<subject>/releases/vX.Y.Z/`, where the node keeps them, hold exactly what the sources produce.
- An exact version (`v0.1.0`) that is already online is served unchanged. One that is not online yet is new.
- A model does not redefine a term of a model it `extends`: the same name keeps the same IRI.

The exit code is 1 on a problem. Another node that cannot be reached, or does not answer within 20 seconds, is only noted: a node that is down never fails someone else's check. `--offline` skips the published files, the extended models and schemas on other sites.

## release

```bash
datamodels release road      # in the node's directory
```

Keeps the current version of a subject online. A node's site holds the current version of each subject; when `subject.yaml` gets a new version, the files of the old one leave the site, although data may still point to them. `release` writes a snapshot of the current version's @context, vocabulary and schemas into `models/<subject>/releases/vX.Y.Z/`; `build` publishes every snapshot next to the current version.

Run it once a version is published, before you change its sources, and commit the snapshot. Online, it first compares the snapshot with the published files and refuses when the sources changed since, or when the site does not answer: then restore them (for example with git), release, and make the change with a new version. A snapshot that exists is kept; `build` stops when the sources of a released version change. `check` notes a published version that has no snapshot yet. `--offline` skips the comparison.

## GitHub Action

This repository is also a GitHub Action: it runs `check` and `build` and deploys the node to GitHub Pages. A node's workflow:

```yaml
# .github/workflows/publish.yml
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
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: geolonia/datamodels-toolkit@73bee7bf36020685b04477c9342fa101d34511bc # v0.1.0
        with:
          deploy: 'false'

  publish:
    if: github.event_name != 'pull_request'
    runs-on: ubuntu-latest
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
        uses: geolonia/datamodels-toolkit@73bee7bf36020685b04477c9342fa101d34511bc # v0.1.0
```

In the repository settings, set Pages to deploy from GitHub Actions. Inputs: `directory` (default `.`), `deploy` (default `true`), `offline` (default `false`). A node upgrades by changing the pinned version; Dependabot can propose it. `datamodels init` writes this workflow.

## Build library

`@geolonia/datamodels/build` builds the machine-readable files of a catalog from a models folder: every published version, the @contexts, vocabularies, JSON Schemas, examples, mapping files and `catalog.json`. It is the code datamodels.jp runs, with the base URL and the required languages as options, so a node of the [web of data models](https://github.com/geolonia/datamodels/issues/200) builds its files the same way ([what a node publishes](https://github.com/geolonia/datamodels/blob/main/docs/node.md)).

```js
import { catalogUrls, loadSubjects, publishCatalog } from '@geolonia/datamodels/build';

const urls = catalogUrls('https://models.example.org');
const subjects = await loadSubjects('models', { urls, languages: ['en'], subjectFields: ['title', 'description'] });
await publishCatalog(subjects, { urls, outDir: 'dist', languages: ['en'], head: { license: 'CC0-1.0' } });
```

## Development

```bash
npm ci
npm test
```

The tests read `test/fixtures/site/`, a copy of the files datamodels.jp serves for the mappings they use. After the catalog changes one of those models or mappings, refresh it with `npm run fixtures` and commit the result.

`test/fixtures/catalog/` holds the sources of two subjects of [geolonia/datamodels](https://github.com/geolonia/datamodels) and the files datamodels.jp serves for them; the build library must produce exactly those files. Refresh it with `npm run fixtures:build -- <path to a datamodels checkout>` when the catalog changes those subjects.

## Issues and contributions

Problems with the tool go to [this repository's issues](https://github.com/geolonia/datamodels-toolkit/issues). Questions about a model or a mapping file go to [geolonia/datamodels](https://github.com/geolonia/datamodels/issues), where the conversion rules live. Pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Licence

The code is [Apache-2.0](LICENSE). The files in `test/fixtures/site/` come from datamodels.jp and are CC0 1.0 ([licence](https://datamodels.jp/LICENSE-CONTENT)). The sample rows in the tests come from Utsunomiya City's and GSI's published lists (CC BY 4.0 and compatible terms), credited where they are used.
