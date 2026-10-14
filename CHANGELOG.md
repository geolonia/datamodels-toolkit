# Changelog

All notable changes to `@geolonia/datamodels`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers follow [Semantic Versioning](https://semver.org/). Before 1.0.0, a minor version may change the command line.

Entries for the next release wait in [`changes/`](https://github.com/geolonia/datamodels-toolkit/tree/main/changes), one file per change; the release folds them in here ([`changes/README.md`](https://github.com/geolonia/datamodels-toolkit/blob/main/changes/README.md)). Do not add them under Unreleased.

## [Unreleased]

## [0.3.16] - 2026-10-15

Other tools can use the rules `check` applies to a normalized entity. Reads of other nodes refuse more special-purpose addresses.

### Added

- `attributeProblems()` and `unclosedRings()` in `@geolonia/datamodels/ngsi`: the rules that `datamodels check` applies to a normalized entity, so other tools can use the same rules (#120). `attributeProblems` lists each attribute whose type is not the one in `x-ngsi.type` (Property when there is none), that has several instances without `x-ngsi.multi`, or whose date or date-time value has no typed form. `unclosedRings` lists the polygon rings that do not close, as `$.area.coordinates[0]` paths or, with `{ style: 'pointer' }`, as JSON pointers (`/area/coordinates/0`). Both return data, not messages. The messages of `datamodels check` do not change, except that an attribute sent with the wrong type (a Relationship where the schema has a Property) no longer also gets a date message for its value.

### Changed

- `datamodels init` writes a workflow pinned to the v0.3.15 release of the Action, and a README whose commands run `npx @geolonia/datamodels@0.3.15`. The README uses 0.3.15 too.

### Fixed

- An attribute named `__proto__` is kept as an attribute by `toKeyValues` and `toNormalized` in `@geolonia/datamodels/ngsi`. Before, they dropped it and changed the prototype of the result instead. `datamodels check` now also reports it in the key-values form of `example-normalized.jsonld` when the schema allows no other properties.

### Security

- Reads of other nodes also refuse IPv6 addresses that carry an IPv4 address (6to4 `2002::/16`, Teredo `2001::/32`) or are not reachable on the internet (discard-only `100::/64`, dummy `100:0:0:1::/64`, benchmarking `2001:2::/48`, documentation `3fff::/20`, SRv6 `5f00::/16`), and the IPv4 documentation ranges `198.51.100.0/24` and `203.0.113.0/24`. A host name that resolves to one of them is refused like a private address.

## [0.3.15] - 2026-10-14

`export` and `extend` find a model by its type IRI on the node that made it; other nodes are read only over https. A node can have a title and description.

### Added

- The agent skill (`skills/datamodels`) names the datamodels.jp MCP server (https://datamodels.jp/mcp) and its tools, and tells an agent without them to ask the user to add the server (geolonia/datamodels#223).
- `node.yaml` takes an optional `title` and `description` of the node, each a text in every language of the node, like `subject.yaml` (geolonia/datamodels#220). `catalog.json` lists them at the top (still `formatVersion: 1`). The pages use the title as the site's name, and the home page shows the description; `llms.txt` uses them too. Without them, every file stays as before. `datamodels check` reports a text that is missing a language of the node, a value that is not a text per language, and a key that is not a language. `datamodels init` writes both, commented out, to fill in.
- `datamodels nodes` and `datamodels search` show a node by its title when its `catalog.json` has one; `--json` adds `title` to each node and `siteTitle` to each result.
- `export` and `extend` find a model of another node by its type IRI without `--index`: they first read the index of the node that made the IRI (the part before `/ns/`, plus `catalog.json`), and use it when it lists the model; otherwise they read the usual index (the first node in node.yaml, else datamodels.jp), and its error says why the first one was not used. That first index is read only over https from a public host name, and for at most 5 seconds, redirects included (geolonia/datamodels#222).
- `indexForIri()` in `@geolonia/datamodels/build`: the index URL of the node that made a type IRI, or null.
- `extend` says which index it read the model from.

### Changed

- `datamodels init` writes a workflow pinned to the v0.3.14 release of the Action, and a README whose commands run `npx @geolonia/datamodels@0.3.14`. The README uses 0.3.14 too.
- `export` and `extend` now read the model from the node that made the IRI, even when the first node in node.yaml (else datamodels.jp) lists an alias with the same IRI. To get the alias, give `--index` with the alias's node, or give the alias as `<subject>/<Type>` when that node is the first one in node.yaml. `extend` records the node it used in `extends[].index` and, when it is new, in node.yaml (geolonia/datamodels#222).
- `nodes[].url` and `nodes[].index` in node.yaml, and `extends[].index` in catalog.yaml, must be https URLs, as the toolkit reads other nodes only over https. The error says to change `http://` to `https://`.

### Fixed

- `datamodels nodes` and `datamodels search` skip an empty or non-text publisher name in another language: a node whose `catalog.json` has `name: { en: " ", ja: X }` is named X, no longer by its host.

### Security

- `extend` reads the other node's index, schema and example only over https from a public host name, checking every redirect, as `export` does. It reads a schema only under the node's `schema/` and an example only under its `examples/`, and checks the `@context` first. URLs are checked after `..` and `%2e%2e` are resolved, and the resolved `@context` URL is the one written. An index at an `http://` address is no longer read.
- `extend`, `export` and the build follow a redirect of another node's schema or example only when it stays under that node's `schema/` or `examples/`.
- `extend` and `export` take a model from a catalog only when its type name is UpperCamelCase and its version is x.y.z, so a catalog cannot add lines to the files they write.
- `check` reads the indexes, `@context`s and schemas of other nodes only over https from a public host name, checking every redirect. It is a problem when an address this node wrote may not be read as written: an `extends` index in catalog.yaml, a `@context` imported in context.jsonld, or a schema `$ref` (not https, an IP address, localhost). When the network side refuses a read (a redirect to such an address, or a host name that resolves to a private address), it is a note, as for a node that is down, and so is an address that comes from another node's files.
- The build checks a `@context` imported by URL after `..` and `%2e%2e` are resolved, and compares it with the node's and the listed nodes' addresses written the same way (lower-case host, no default port).
- A read of another node's file has one time limit for the whole read, redirects included; a read that takes too long says "timed out after N s".

## [0.3.14] - 2026-10-14

Errors name the JSON or YAML file in models/ that does not parse.

### Changed

- `datamodels init` writes a workflow pinned to the v0.3.13 release of the Action, and a README whose commands run `npx @geolonia/datamodels@0.3.13`. The README uses 0.3.13 too (#110).

### Fixed

- A JSON or YAML file in models/ that does not parse is named in the error (`road/context.jsonld: …`), not only the parser's message; also in `datamodels add` and `extend`. An empty `subject.yaml` is reported by its missing name instead of a crash (#111).

## [0.3.13] - 2026-10-14

`datamodels check` lists a changed release snapshot with the other problems, with the right advice during a pre-release, so datamodels.jp can validate with it (geolonia/datamodels#226).

### Changed

- `datamodels check` reports a release snapshot that differs from the sources as one problem and goes on checking, so the other problems show at the same time. During a pre-release (`prerelease: true`) it says how to correct the snapshot instead of asking for a new version (geolonia/datamodels#226).
- `datamodels init` writes a workflow pinned to the v0.3.12 release of the Action, and a README whose commands run `npx @geolonia/datamodels@0.3.12`. The README uses 0.3.12 too.

### Fixed

- Messages about a missing text say "needs a description in en" and "needs a text in ja or en", not "needs a en description".

## [0.3.12] - 2026-10-13

`datamodels check` has the model checks of datamodels.jp's validator, the Action's pull-request check catches a removed release, and the library exports what datamodels.jp needs to build with the toolkit (geolonia/datamodels#226).

### Added

- `datamodels check` checks more rules of the models (geolonia/datamodels#226): an alias (`x-alias-of`) has the attributes, requirements and kind of its type; a subclass (`x-subclass-of`) uses its parent's IRIs and NGSI-LD types and stays as strict; one model per type IRI; `x-personal-data` is `true` or left out; `catalog.yaml` has the title, description and every attribute in every language of the node, and no attribute that the schema lacks; `status` and `supersededBy`; the shape of `notes.yaml`. It lists every missing text at once.
- `datamodels check`: the id of an example entity is `urn:ngsi-ld:<Type>:<local id>`, and a Relationship in an example references an entity of the type that its schema declares (`x-ngsi.target`), the example of that type when the node has one. The normalized example references the same targets as `example.json` (geolonia/datamodels#226).
- `@geolonia/datamodels/ngsi`: the NGSI-LD helpers (`toNormalized`, `toKeyValues`, …) for other programs, such as the datamodels.jp build (geolonia/datamodels#226).
- `@geolonia/datamodels/build` exports the NGSI-LD core context (`CORE_CONTEXT`, `CORE_CONTEXT_URL`), for programs that list its terms, such as datamodels.jp (geolonia/datamodels#226).
- A model's page shows its change history (`history` in `notes.yaml`) below the notes, folded away, as datamodels.jp does (geolonia/datamodels#226).

### Changed

- Commands start faster: Eleventy is loaded only when pages are written, also for programs that import `@geolonia/datamodels/build`.
- `datamodels init` writes a workflow pinned to the v0.3.11 release of the Action, and a README whose commands run `npx @geolonia/datamodels@0.3.11`. The README uses 0.3.11 too.
- The README shows badges for the npm version, the tests, the GitHub Marketplace listing and the licence.

### Fixed

- The Action's pull-request check compares the release snapshots with the pull request's base branch, so removing a whole published release folder fails the check (#93).
- `convert` writes a JsonProperty or VocabProperty attribute as the catalog's key-values form has it, `{"json": …}` or `{"vocab": …}`, and with `--normalized` as a JsonProperty or VocabProperty, not as a Property.

## [0.3.11] - 2026-10-13

The README is short, with the documentation on datamodels.jp, and says what the GitHub Action is for. npmjs.org and the Marketplace listing show it from this release.

### Changed

- The documentation is on datamodels.jp ([/en/toolkit](https://datamodels.jp/en/toolkit/), with a [command reference](https://datamodels.jp/en/toolkit/reference)), and the README keeps the essentials (#87). `--help` links the command reference instead of the README.
- The README says what the GitHub Action is for, in words for readers new to data models: what it checks on a pull request, what it publishes from `main`, who needs it, and how to start in three steps. The full workflow is folded under its main step.
- The README's GitHub Action section: `--github` goes on the first `init` command, and it says what the pull-request check does not catch yet (a deleted release folder, [#93](https://github.com/geolonia/datamodels-toolkit/issues/93)).
- `datamodels init` writes a workflow pinned to the v0.3.10 release of the Action, and a README whose commands run `npx @geolonia/datamodels@0.3.10`. The README uses 0.3.10 too.

## [0.3.10] - 2026-10-12

The Action is ready for the GitHub Marketplace, and a new node starts on v0.3.9.

### Changed

- `datamodels init` writes a workflow pinned to the v0.3.9 release of the Action, and a README whose commands run `npx @geolonia/datamodels@0.3.9`. The README uses 0.3.9 too.
- For a listing on the GitHub Marketplace, the Action is called "Data model node (datamodels.jp)", its description says what it publishes, and its badge is blue. Workflows refer to it by repository, so they need no change.

## [0.3.9] - 2026-10-12

The toolkit is on npm: `npx @geolonia/datamodels@0.3.9`. Releases are staged on npm by a workflow and approved by a maintainer.

### Added

- `@geolonia/datamodels` is on npmjs.org (#74), from 0.3.8. A published GitHub release now stages the package on npmjs.org, through a workflow with npm's [trusted publishing](https://docs.npmjs.com/trusted-publishers): no npm token is stored, and npm adds provenance. A maintainer then approves the staged release with 2FA ([staged publishing](https://docs.npmjs.com/staged-publishing)); only then is it public.

### Changed

- The README, the agent skill and the README that `datamodels init` writes run the toolkit from npm: `npx @geolonia/datamodels@0.3.8 …` instead of `npx github:geolonia/datamodels-toolkit#v0.3.8 …`.
- `datamodels upgrade` writes the npm form in a node's Markdown files, also where they ran the toolkit from GitHub. A release from before 0.3.8, which is not on npm, keeps the GitHub form.
- Japanese texts of the pages, the adapters and the instructions `datamodels mapping` writes use datamodels.jp's term list (geolonia/datamodels#251): 分野 for subject, 検証 for checking data against a schema.
- `datamodels init` writes a workflow pinned to the v0.3.8 release of the Action, and a README whose `npx` commands run v0.3.8.

## [0.3.8] - 2026-10-12

A new node starts on v0.3.7, and the init questions take what you type.

### Changed

- `datamodels init` writes a workflow pinned to the v0.3.7 release of the Action, and a README whose `npx` commands run v0.3.7.

### Fixed

- `datamodels init` questions no longer start with a value typed in: what you type replaces the shown default (`en`, `CC0-1.0`), and Enter alone keeps it. Each answer is checked as soon as you give it, so a wrong one can be corrected at once instead of stopping init at the end.

## [0.3.7] - 2026-10-12

Find models across linked sites, check a node as datamodels.jp does, publish on hosts other than GitHub Pages, and say what opening hours of 0:00 to 0:00 mean.

### Added

- `datamodels check` has the checks of datamodels.jp's validator for schemas and examples (geolonia/datamodels#226): the `type` const, `$id` and `x-version` of each schema, the `x-ngsi.type` names, polygon rings that close, the NGSI-LD rules of `example-normalized.jsonld` (attribute types, typed dates, the same id and vocab values as `example.json`, a valid key-values form, the alias URL in its `@context`), and a JSON-LD processor that expands the normalized example, the example of a value type and the vocabulary without losing anything. It also checks that an entity schema accepts the `@context` that data may carry.
- `datamodels search <words…> [--index URL] [--depth N] [--limit N] [--json]`: find models by words in their type, title, attributes and description, in datamodels.jp (or another index) and the nodes it links to through `nodes` and `extends`, up to `--depth` links away (default 1). Japanese is matched by pairs of characters, as datamodels.jp matches model proposals. Each result names its node and page; `--json` adds the type IRI, schema, `@context` and index (geolonia/datamodels#222).
- `datamodels nodes [--index URL] [--depth N] [--json]`: the nodes reachable from an index, with their name, address, licence, number of models and the node that links to them.
- Both read other sites only over https and from a public address, each index once (a cycle ends), at most 50. A linked node that cannot be read is a note on standard error, not a failure.
- The agent skill tells agents to look for an existing model with `datamodels search` before proposing one.
- `datamodels check` checks the mapping files of a node, as datamodels.jp's validator did (geolonia/datamodels#226): a correspondence table with a `standard` and its `name`, a `to` in every row, texts in the node's languages (a text that YAML cut at a comma is reported), known keys only, fields of the model, and `via` to another mapping file of the node without circles. The conversion rules are checked as `convert` applies them, so a catalog mapping may hold every rule that a mapping file of your own may: `values` on a rule of one column, the transforms `boolean`, `yesno`, `weekdays`, `time`, `geometry` and `json`, and field names with a dot. Each part of a field name with a dot must be a member of the value before it, followed into the node's other models; a member of a value is not a field of the model on its own. A `name:` in the file, a `standard.url` with a user name or password, an empty `via` and `flags` without values are reported.
- `datamodels check --base <git ref>`: the release snapshots must be as they are at the ref, usually the branch a pull request goes into, so a published version is never changed or removed, offline too (geolonia/datamodels#226). It replaces datamodels.jp's list of hashes (`published-manifest.json`), which recorded the same files as the snapshots.
- `datamodels check --all-released`: every subject's current version needs its release snapshot, for a catalog that releases before it publishes.
- `prerelease: true` in `node.yaml`: before an official launch, published versions may be corrected in place, or removed as a whole (their folder under `releases/`); `check --base` notes the corrections and removals instead of failing while the base branch and the change both have the flag (without `--base` they stay problems), and refuses a change that removes the flag or sets it back to true.
- `convert.allDay` in a mapping file says what opening hours of 0:00 to 0:00 mean in the list: `open` writes `00:00` to `23:59` (open 24 hours, as Google's structured data guidelines read it), `closed` writes `00:00` to `00:00` (closed all day). It applies to the mappings reached through `via` too, and the outermost mapping that says it wins, so a mapping of your own decides it for the catalog's OpeningHours mapping. `datamodels mapping` writes a TODO for it when the model has opening hours.
- `datamodels build` writes `_headers` and, with slash IRIs, `_redirects` into the site: the content types (`application/ld+json`, `application/schema+json`, `text/csv`, `application/sql`, ...), CORS and IRI redirects that Cloudflare Pages, Cloudflare Workers static assets and Netlify read. GitHub Pages ignores both (#51). Cloudflare reads at most 2,000 redirects; `build` prints a note when a node has more.
- The Action has a `site` output, the folder with the built files, so a workflow can publish the node on another host with `deploy: 'false'`. The README shows how for Cloudflare Pages and Netlify, and what any other host must do (#51).

### Fixed

- `datamodels build` writes the pages (index.html, 404.html, the model and subject pages) when the toolkit is installed in a project (`npm i @geolonia/datamodels`) and run from that project's folder. They were missing: the toolkit's page templates are then under `node_modules`, which Eleventy skips by default, as it skips what the project's `.gitignore` lists.
- `catalog.json` gives the standard of each mapping file in the node's languages, not always in `ja` and `en`. `datamodels convert` refuses a rule with an empty `via` (`via:` or `via: ""`), which it skipped without a word, a `via` to a file that is empty or not a mapping, and `transform: flags` with empty `values`.
- `datamodels check` compares a released current version with the site once, not twice.
- A release folder without its `context.jsonld` stops `build` and `check` with a message that names the file, instead of a bare ENOENT: a version is removed with its whole folder.
- `datamodels check` validates an `example.json` without the `{"json": ...}` and `{"vocab": ...}` wrappers of `JsonProperty` and `VocabProperty` attributes, as the schema describes them; such an example was reported as invalid (datamodels.jp's Decision).
- `datamodels check` reads the @contexts of the node's own subjects from the build, offline too, instead of from the site: an import of the node's own common context is checked against what is about to be published.

### Changed

- Model pages: the Download row shows a small button per file (CSV template, Table Schema, AI structured output, PostgreSQL / PostGIS), still plain HTML without JavaScript, and "About these files" links the explanation of the files on datamodels.jp, in the page's language (`https://datamodels.jp/adapters/#downloads` for Japanese, `https://datamodels.jp/en/adapters/#downloads` for English and any other language).
- `build` no longer writes an `/adapters/` page: the explanation lives in one place, datamodels.jp, not on every node. It removes an `adapters/index.html` (and `<lang>/adapters/index.html`, also of a language no longer in `node.yaml`) left in the output folder by an older version, so it is not published; only a page the toolkit wrote (its `<meta name="generator" content="datamodels-toolkit …">`), so a page of your own at that path stays. The adapters' files (`/adapters/<name>/<subject>/<Type>.<ext>`) and their entries under `adapters` in `catalog.json` are unchanged.
- `datamodels init` writes a workflow pinned to the v0.3.6 release of the Action, and a README whose `npx` commands run v0.3.6.
- `datamodels convert` reports opening hours of 0:00 to 0:00 as a problem of the row unless the mapping has `convert.allDay`: written as they are, they read as "closed all day" to tools that follow Google's convention, while Japanese lists mean "around the clock". An opening and a closing time that are the same at another hour (9:00 to 9:00) are always a problem of the row.

## [0.3.6] - 2026-10-12

More of the facility lists convert: yes/no columns, value lists, weekdays and times.

### Added

- Transforms for the facility lists (#54): `yesno` (有/無, あり/なし, ○/× and similar to true and false), `weekdays` (`月～金`, `月火水木金`, `土日祝`, `平日`, `12345` to the days of OpeningHours; a range wraps) and `time` (`9:00` and `9時` to `09:00`; `24:00` kept for a closing time, `0:00` kept as `00:00`). `values` on a one-column rule turns each text of the column into the model's value (`病院: hospital`), also with `split` and `yesno`. A text these do not know is a problem of the row, never a guess. `datamodels mapping` suggests `yesno` for a boolean column of 有 and 無, gives the fields of the opening hours a row each with `weekdays` and `time`, and keeps the `values` of a catalog rule.

### Changed

- `datamodels init` writes a workflow pinned to the v0.3.5 release of the Action, and a README whose `npx` commands run v0.3.5.

## [0.3.5] - 2026-10-12

Your own lists: convert any CSV with a mapping file of your own, start one with `datamodels mapping`, check the first rows with `convert --check`, or fill in the CSV template and convert it without a mapping.

### Added

- `datamodels convert` takes a mapping file of your own: a path, or a name that ends in `.yaml` or `.yml`, as the mapping. Its `via` may name a catalog mapping or another file of your own, relative to its folder. A field name with a dot (`address.postalCode`) fills a field of a value. convert refuses a file of your own that still has a `# TODO:` comment or names an attribute the model does not have.
- `datamodels mapping <subject>/<Type> <file.csv> [--out file.yaml]`: a first mapping file for a list of your own, for you or an AI agent to finish. One row per attribute and field (as the CSV template splits them) with the column that fits it, a transform for its type, or a TODO; required attributes first; the `convert.id` template of a catalog mapping when its columns are there; the columns no row reads; a one-line comment on each part, in Japanese for a Japanese header. It also says when the header has nearly all the columns of a catalog mapping.
- `datamodels convert --check [--rows N]`: converts the first rows (default 20), writes nothing, and reports the problems of the mapping, the columns the file lacks, the required attributes no row gets and the invalid rows with their first schema errors; the last line is a summary such as `18 of 20 rows valid`. Exit code 0 when every checked row is valid.
- `datamodels convert <subject>/<Type> csv-template <file.csv>`: a CSV made from the model's CSV template converts without a mapping file.
- Transforms `boolean` (true or false), `geometry` (longitude and latitude into a Point, or a GeoJSON column) and `json`. A field `id` gives the entity id as it is; a `convert.id` template that is only one value is not URL-encoded.
- The agent skill has a "Convert your data" section: the steps with `mapping` and `--check`, and the rules (never invent values, leave unmatched columns out, ask about ambiguous columns).

### Changed

- `datamodels convert` reports an id that more than one row gets, and an id value in exponent form such as `1.31E+11`, as problems of those rows: they are left out and the exit code is 1 (#56).
- `datamodels init` writes a workflow pinned to the v0.3.4 release of the Action, and a README whose `npx` commands run v0.3.4.
- The skill links the list of data model sites at its new address on datamodels.jp (`/en/guide/sites`).

## [0.3.4] - 2026-10-11

Adapters: each entity model also as a CSV template with its Table Schema, a JSON Schema for the structured output of AI models (when the model has a strict form), and a PostgreSQL / PostGIS table (when its column names do not clash), to download from the model page or to make with `datamodels export`.

### Added

- `datamodels export <subject>/<Type> --to csv,table-schema,ai,postgis`: files made from one entity model for tools that do not read NGSI-LD. A CSV template and its Frictionless Table Schema (v2), a strict JSON Schema for the structured output of AI models (OpenAI and Claude; none for a model with no strict form, such as an object with any keys), and a PostgreSQL / PostGIS `CREATE TABLE` with constraints, a GiST index and comments. They use the model's attribute names and IRIs. The model is the node's, or one of another node's `catalog.json` (default datamodels.jp), as for `extend`.
- `build` writes the same files for every entity model at `/adapters/<name>/<subject>/<Type>.<ext>`, lists them under `adapters` in `catalog.json`, and adds an `/adapters/` page that explains them. Each model page has a Download line with its files and a link to that page. The adapters follow the interface of geolonia/datamodels (`adapters/README.md`), with a third argument for what the node knows. `@geolonia/datamodels/adapters` exports them, for datamodels.jp later.
- What the adapters read from other sites is limited: a schema that a model refers to is read only from the `schema/` folder of a node listed in `node.yaml` (`export` from another catalog: that catalog's site and the nodes it lists), only over https, and only from a public address, checked when connecting and on every redirect. `check --offline` reads none.

### Changed

- `datamodels init` writes a workflow pinned to the v0.3.3 release of the Action, and a README whose `npx` commands run v0.3.3.
- The footer links to the Toolkit pages of datamodels.jp (`/toolkit/`), where the guide for publishing your own data models moved (geolonia/datamodels#228). The skill links their new addresses too. The old addresses redirect.

## [0.3.3] - 2026-10-11

An agent skill for modelling with datamodels.jp and the toolkit, and a one-line footer.

### Added

- An agent skill, `skills/datamodels/SKILL.md`: the catalog's modelling rules and the toolkit's workflow, pointing to datamodels.jp's `llms.txt` for the models.

### Changed

- The footer's first line is one short line, so it fits on desktop screens: the publisher, the licence, `catalog.json` and `llms.txt`, separated by dots.
- `datamodels init` writes a workflow pinned to the v0.3.2 release of the Action, and a README whose `npx` commands run v0.3.2.

## [0.3.2] - 2026-10-11

Addresses that moved still lead somewhere: a 404 page in the node's style, pages for renamed models and anchors for former terms; `check` notes example files it does not read.

### Added

- A model that a released version had and the current one does not keeps a page at its old address: which versions had it, its last files, the current model with the same type IRI (a rename), and the current models. The subject page lists the terms of earlier versions, each with its anchor, so their hash IRIs still open on it.
- `build` writes `404.html`, the page that GitHub Pages and most static hosts show for a missing address: in the node's style, in its languages, with links to the index, `catalog.json` and every model. It is not indexed and has no canonical URL.
- `check` notes a file in a model's `examples/` other than `example.json` and `example-normalized.jsonld`: it is not read, published or validated.

### Changed

- `datamodels init` writes a workflow pinned to the v0.3.1 release of the Action, and a README whose `npx` commands run v0.3.1.

## [0.3.1] - 2026-10-11

A new node gets the files it lacked: `LICENSE` and a Dependabot configuration.

### Added

- `datamodels init` writes `LICENSE` (the legal code of CC0-1.0 or CC-BY-4.0; for another licence it says that the file is missing) and `.github/dependabot.yml`, so Dependabot proposes new releases of the Action.

### Changed

- `datamodels init` writes a workflow pinned to the v0.3.0 release of the Action, and a README whose `npx` commands run v0.3.0.

## [0.3.0] - 2026-10-11

Pages and versions of a node: the pages come in each language of the node with metadata, show what a model is based on, and the namespace page is compact; `bump` and `upgrade` move a node to a new version of a subject or of the toolkit.

### Added

- `datamodels bump <subject> <patch|minor|major>`: releases the current version, then raises the subject's version and its schema URLs.
- `datamodels upgrade [--to vX.Y.Z]`: moves a node to a release of the toolkit, in its workflows (the Action's pin) and its README (`npx`).
- Model pages show the standards the model maps (its `mapping/*.yaml`, with links to the tables) and its notes (`notes.yaml`). `datamodels add` and `extend` start an empty `notes.yaml`.
- Page metadata: description, canonical URL, `hreflang` links, Open Graph tags, and `<meta name="generator">` with the toolkit's version. The footer names the toolkit and links to the guide for publishing your own data models.

### Changed

- The subject page (the namespace document with hash IRIs) lists its terms grouped by model, one table row each, with the IRI rule stated once instead of the full IRI under every term.
- The pages come in one set per language of the node: the first language at the base URL, the others under `/<lang>/`, with a link to switch. Each text is shown once, in the page's language; the fixed texts are in Japanese and English. `catalog.json` lists the English pages as `pageUrlEn` when English is not the first language.
- The index shows each subject's description, not only its title.

## [0.2.1] - 2026-10-11

### Changed

- `datamodels init` writes a workflow pinned to the v0.2.0 release of the Action (v0.2.0 wrote v0.1.0, which lacks the @context check), and a README whose `npx` commands run v0.2.0. The Action itself is the same as in v0.2.0.

## [0.2.0] - 2026-10-11

The tools for keeping and growing a data model node: `release` keeps a published version online, `extend` starts a model from another node's model, and `check` compares every type and attribute with the `@context`.

### Added

- `datamodels extend <model> <subject>/<Type>`: starts a model from a model of another node, such as datamodels.jp's, as the same type with more attributes or as a subtype (`--subclass`). It copies the schema, imports the @context, records `extends` and lists the node in `node.yaml`. In a terminal it asks for the model (#13).
- `datamodels release <subject>`: keeps a published version online after the next one, as a snapshot in `models/<subject>/releases/vX.Y.Z/`. It refuses when the sources changed since the version was published. `check` notes a published version without a snapshot (#27).

### Changed

- `datamodels init` writes a workflow that pins the Action to the v0.1.0 release (its commit SHA, with the tag as a comment), instead of `main`. Dependabot can then propose newer releases.
- The README that `datamodels init` writes runs the same release with `npx` (`#v0.1.0`), instead of the latest commit.

### Fixed

- `datamodels check` finds an entity type or attribute that is missing from the `@context`, or that the `@context` expands to another IRI than the schema's `x-iri`, and a redefined NGSI-LD core term (#26).

## [0.1.0] - 2026-10-10

First release: the CSV converter moved from [geolonia/datamodels](https://github.com/geolonia/datamodels) ([geolonia/datamodels#91](https://github.com/geolonia/datamodels/issues/91)), and the tools to publish a data model node of the [web of data models](https://github.com/geolonia/datamodels/issues/200).

### Added

- `datamodels convert <subject>/<Type> <mapping> <file.csv>`: turns a published list (CSV, UTF-8 or Shift_JIS) into entities of a catalog model and validates each one against the model's JSON Schema. Options `--set`, `--normalized`, `--out` and `--site` (#1).
- Reads `catalog.json`, the schemas and the mapping files from datamodels.jp, or from a local copy of the site (#1).
- Checks the transform names of a mapping, and of the mappings it reaches through `via`, before any row is read (#1).
- Lists the columns a mapping reads but the file does not have; such a column gives no value, never `false` (#1).
- Empty records are left out and listed, also `""` in a one-column file (#4).
- Errors are one line on standard error; exit code 1 for invalid rows or unreadable files, 2 for usage errors. Output written to a pipe is complete (#1, #4).
- `@geolonia/datamodels/build`: builds a catalog's machine-readable files from a models folder, the code of datamodels.jp with the base URL and the languages as options (#10). Its output for datamodels.jp's sources is byte for byte what the site serves.
- `datamodels build`: writes the files a node of the web of data models publishes, from its `node.yaml` and `models/` folder: `catalog.json` with the publisher, licence and known nodes, the @contexts, JSON Schemas, vocabularies, examples and `llms.txt` (#12).
- The pages of a node, written with [Eleventy](https://www.11ty.dev/): plain HTML, monospace, no JavaScript; a page per subject with an anchor per term (the namespace document with hash IRIs) and a page per model with an anchor per attribute (#12).
- `datamodels check`: a node's schemas and examples, its release snapshots, its published versions online, and the terms of the models it extends (#12). `--offline` skips the network.
- `datamodels init`: starts a node with every file it needs (no template repository), in a new folder or an existing repository without overwriting anything; asks with [@clack/prompts](https://github.com/bombshell-dev/clack) only in a terminal; `--github owner/name` creates the repository and turns on Pages with `gh` (#11).
- `datamodels add <subject>/<Type>`: a new model in a node that builds and passes `check` at once; `--value` for a value type (#13).
- A GitHub Action (`action.yml`): checks and builds a node and deploys it to GitHub Pages (#14). Tested in CI on `test/fixtures/node`.
- Hash IRIs (`/ns/<subject>#<Term>`), the default for nodes; `extends` in a model's `catalog.yaml` goes into `catalog.json` (#12).
- `datamodels --help` lists the commands; `datamodels <command> --help` explains each option (#6).
- The command line is built on [commander](https://github.com/tj/commander.js) (#9); `--help` also lists the arguments.
- `--normalized`: dates follow the catalog's rule (geolonia/datamodels#183). An attribute with `format: date` becomes `{"@type": "Date"}`, and one that takes a date or a date-time (Task's `start` and `due`) gets the type that fits the value.

[Unreleased]: https://github.com/geolonia/datamodels-toolkit/compare/v0.3.16...main
[0.3.16]: https://github.com/geolonia/datamodels-toolkit/compare/v0.3.15...v0.3.16
[0.3.15]: https://github.com/geolonia/datamodels-toolkit/compare/v0.3.14...v0.3.15
[0.3.14]: https://github.com/geolonia/datamodels-toolkit/compare/v0.3.13...v0.3.14
[0.3.13]: https://github.com/geolonia/datamodels-toolkit/compare/v0.3.12...v0.3.13
[0.3.12]: https://github.com/geolonia/datamodels-toolkit/compare/v0.3.11...v0.3.12
[0.3.11]: https://github.com/geolonia/datamodels-toolkit/compare/v0.3.10...v0.3.11
[0.3.10]: https://github.com/geolonia/datamodels-toolkit/compare/v0.3.9...v0.3.10
[0.3.9]: https://github.com/geolonia/datamodels-toolkit/compare/v0.3.8...v0.3.9
[0.3.8]: https://github.com/geolonia/datamodels-toolkit/compare/v0.3.7...v0.3.8
[0.3.7]: https://github.com/geolonia/datamodels-toolkit/compare/v0.3.6...v0.3.7
[0.3.6]: https://github.com/geolonia/datamodels-toolkit/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/geolonia/datamodels-toolkit/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/geolonia/datamodels-toolkit/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/geolonia/datamodels-toolkit/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/geolonia/datamodels-toolkit/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/geolonia/datamodels-toolkit/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/geolonia/datamodels-toolkit/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/geolonia/datamodels-toolkit/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/geolonia/datamodels-toolkit/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/geolonia/datamodels-toolkit/releases/tag/v0.1.0
