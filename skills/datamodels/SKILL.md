---
name: datamodels
description: Model NGSI-LD / JSON-LD data with the datamodels.jp catalog and publish your own data models with datamodels-toolkit. Use when choosing or designing a data model (entity types, attributes, @context, IRIs), when searching for an existing model (datamodels search), when reusing or extending a datamodels.jp model, when converting a CSV list into entities of a model (datamodels mapping, datamodels convert), or when starting, changing, releasing or upgrading a data model node (node.yaml, models/<subject>/, datamodels init/add/extend/check/build/bump/upgrade).
---

# Data models with datamodels.jp and datamodels-toolkit

datamodels.jp is a catalog of data models that work in Japan: JSON Schemas, JSON-LD `@context` files and vocabularies at URLs that never change. datamodels-toolkit publishes data models on a site of your own (a *node*) in the same form.

## Find before you define

1. Read https://datamodels.jp/llms.txt (an index for agents), then https://datamodels.jp/catalog.json (every model: type IRI, `@context`, schema, attributes, examples). Other known nodes and what they build on: https://datamodels.jp/en/guide/sites.
   If the datamodels.jp MCP tools are available, use them: `search_models`, `get_model` (schema, `@context`, example, attributes), `find_attribute` (an attribute to reuse) and `validate` (an entity against a model). A client that can read neither the web nor a repository needs them; if they are missing, ask the user to add the server https://datamodels.jp/mcp (https://datamodels.jp/en/ai#mcp-server).
   Find existing models with `datamodels search <words…>` before proposing one: it searches datamodels.jp and the nodes it links to, in English or Japanese (`datamodels search 避難`, `datamodels search road closure --json`). `datamodels nodes` lists those nodes.
2. Reuse in this order: a datamodels.jp model as it is; then [Smart Data Models](https://smartdatamodels.org/), NGSI-LD core terms or schema.org where they fit; define a new type only for what is missing.
3. Reuse attribute names and their IRIs (the MCP tool `find_attribute` finds them). The same meaning gets the same IRI; a new attribute gets an IRI in your own namespace.
4. Where it goes: a model many organisations in Japan need → propose it to datamodels.jp (https://datamodels.jp/en/guide/contribute). Only you need it → your own node. Not about Japan → Smart Data Models.

## Modelling rules

- Never change the meaning or type of an existing attribute; add a new one.
- Never redefine an NGSI-LD core term (`status`, `description`, `location`, `createdAt`, `modifiedAt`, `observedAt`, …). Name your own, for example `incidentStatus`.
- Fixed value lists: never force the nearest value. Where the model has `statusLabel` (Task's `progress`, EvacuationShelter's `openingStatus`, RoadRestriction's `restrictionStatus`), leave the status out when no value fits and put the local wording in `statusLabel`. For other enums, follow the model's schema.
- Locations are GeoJSON geometries in `location` (`$ref` to datamodels.jp's common Geometry, narrowed when needed). Addresses use the common JapaneseAddress.
- In the datamodels.jp catalog: the same type under another name → **alias** (`x-alias-of`, exactly the same attributes and required fields); added attributes or a separate kind → **subclass** (`x-subclass-of`).
- On your own node, `extend` works differently: by default the model keeps the original type IRI and adds attributes (an extension, like GTT's `Issue` for datamodels.jp's `Task`); `--subclass` makes a separate kind with its own type IRI. When the extension's name differs from the original, map the new name to the original IRI in your `@context` and set the original name to `null` there; otherwise JSON-LD compaction picks the shorter term and brokers answer with the original name.
- Group models by subject (topic), never by customer, region or project.
- Record the sources, the upstream types you considered and why, and what you left out in the model's `notes.yaml`. Map fields to an external standard in `mapping/<name>.yaml`.
- Examples: `examples/example.json` (key-values form), valid against the schema; ids `urn:ngsi-ld:<Type>:<local id>`; Japanese times with `+09:00`. The catalog also requires `examples/example-normalized.jsonld` for every entity model (not for value types); on a node it is optional. Other files in `examples/` are not read (`check` notes them).

## Convert your data

A CSV list becomes entities of a datamodels.jp model with `datamodels convert`. Run it with `npx @geolonia/datamodels@<version>` (Node.js 24 or later).

1. **A standard list:** if the model page (or `mappingUrls` in catalog.json) has a mapping for the list's standard, use it: `datamodels convert <subject>/<Type> <mapping> <file.csv> --check`.
2. **The CSV template:** a CSV made from `datamodels export <subject>/<Type> --to csv` converts with `csv-template` as the mapping.
3. **Any other list:** make a mapping and finish it in a loop:
   1. `datamodels mapping <subject>/<Type> <file.csv> --out <name>.yaml` writes a first mapping: one row per attribute, the column that fits it, or `# TODO: which column?`.
   2. Read the CSV header and the first rows, then fill in each TODO: the column (`column: 列名`), and a `transform` when the text needs one (see the README's table). Delete a row when the list has nothing for it. Check the rows marked as a guess against the sample values. Fill in the `convert.id` template with the attributes that tell the rows apart.
   3. `datamodels convert <subject>/<Type> <name>.yaml <file.csv> --check` converts the first rows and reports what is wrong. Fix the mapping (or tell the user what is wrong in the list) and run it again until the last line says every row is valid and the exit code is 0.
   4. `datamodels convert <subject>/<Type> <name>.yaml <file.csv> --out entities.json`. Report the invalid rows and the repairs it lists.

Rules:

- **Never invent values.** A value comes from a column of the list, or from `value:` only when the user confirms it is true for every row (such as `addressCountry: JP` for a list of Japanese addresses). Do not fill an attribute from your own knowledge, and do not change the data to make a row valid.
- **Leave unmatched columns out.** A column that fits no attribute stays in the comment at the end of the mapping; do not force it into the nearest attribute.
- **Ask the user about ambiguous columns:** two columns that could fill the same attribute, a column whose meaning is unclear from its name and sample values, a code whose system you do not know, and which attributes make the id unique. Do not guess.
- Opening hours of 0:00 to 0:00 can mean open all day or closed all day. Ask the user what the list means, then write `allDay: open` or `allDay: closed` under `convert:` (the TODO that `datamodels mapping` writes).
- Duplicate ids and ids like `1.31E+11` (a spreadsheet rounded them) are problems of the list: tell the user; do not work around them with another id without asking.
- Keep the mapping file: it is the record of how the list was converted, and it converts the next version of the list.

## A node with datamodels-toolkit

Run the commands with `npx @geolonia/datamodels@<version>` (Node.js 24 or later); use the release the node pins (see its README). A node made before the package was on npm runs it from GitHub, `npx github:geolonia/datamodels-toolkit#v<version>`; `upgrade` changes that to the npm form.

- `init`: `node.yaml`, the first subject, README, LICENSE (CC0-1.0, CC-BY-4.0), the GitHub Pages workflow and Dependabot. **The base URL is in every IRI: choose it once** (your domain, or a w3id.org address that redirects to it: https://datamodels.jp/en/toolkit/start#w3id). Then set Settings → Pages → Source: GitHub Actions. Fill in the node's `title` and `description` in `node.yaml` (a text in each language of the node): the title names the site on every page, in `catalog.json` and `llms.txt`; the home page shows the description.
- `add <subject>/<Type>`: a new model (schema, catalog.yaml, example, notes.yaml).
- `extend <model> <subject>/<Type>`: start a model from another node's model (`task/Task` on datamodels.jp, or its type IRI): the same type with more attributes, or a subtype with `--subclass`. `extend` and `export` look up a type IRI first at the node that made it (the part before `/ns/`, plus `catalog.json`); `--index` picks another index.
- `check` before every pull request; `build` writes `_site/`.
- **A published exact version never changes:** its `@context`, vocabulary and schemas (`…/v0.1.0.jsonld`, `…/v0.1.0.json`). Before changing them, `bump <subject> patch|minor|major`: it keeps the published version online and raises the version. Pages, examples, mapping tables and notes are not versioned and can change without a bump. A renamed model keeps a page at its old address; its old terms keep their anchors.
- `upgrade [--to vX.Y.Z]`: move the node to a newer toolkit release (the workflow pin and the `npx` lines). Dependabot also proposes releases.
- Every attribute in `schema.json` needs an `x-iri`, a term in the subject's `context.jsonld` that expands to it, and a description in `catalog.yaml`. Check the JSON-LD expansion of the example when in doubt.

To have your node listed on datamodels.jp, open an issue at https://github.com/geolonia/datamodels/issues.
