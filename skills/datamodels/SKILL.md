---
name: datamodels
description: Model NGSI-LD / JSON-LD data with the datamodels.jp catalog and publish your own data models with datamodels-toolkit. Use when choosing or designing a data model (entity types, attributes, @context, IRIs), when reusing or extending a datamodels.jp model, or when starting, changing, releasing or upgrading a data model node (node.yaml, models/<subject>/, datamodels init/add/extend/check/build/bump/upgrade).
---

# Data models with datamodels.jp and datamodels-toolkit

datamodels.jp is a catalog of data models that work in Japan: JSON Schemas, JSON-LD `@context` files and vocabularies at URLs that never change. datamodels-toolkit publishes data models on a site of your own (a *node*) in the same form.

## Find before you define

1. Read https://datamodels.jp/llms.txt (an index for agents), then https://datamodels.jp/catalog.json (every model: type IRI, `@context`, schema, attributes, examples). Other known nodes and what they build on: https://datamodels.jp/en/guide/nodes.
2. Reuse in this order: a datamodels.jp model as it is; then [Smart Data Models](https://smartdatamodels.org/), NGSI-LD core terms or schema.org where they fit; define a new type only for what is missing.
3. Reuse attribute names and their IRIs. The same meaning gets the same IRI; a new attribute gets an IRI in your own namespace.
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

## A node with datamodels-toolkit

Run the commands with `npx github:geolonia/datamodels-toolkit#<version>` (Node.js 24 or later); use the release the node pins (see its README).

- `init`: `node.yaml`, the first subject, README, LICENSE (CC0-1.0, CC-BY-4.0), the GitHub Pages workflow and Dependabot. **The base URL is in every IRI: choose it once** (your domain, or a w3id.org address that redirects to it: https://datamodels.jp/en/guide/own-site#w3id). Then set Settings → Pages → Source: GitHub Actions.
- `add <subject>/<Type>`: a new model (schema, catalog.yaml, example, notes.yaml).
- `extend <model> <subject>/<Type>`: start a model from another node's model (`task/Task` on datamodels.jp, or its type IRI): the same type with more attributes, or a subtype with `--subclass`.
- `check` before every pull request; `build` writes `_site/`.
- **A published exact version never changes:** its `@context`, vocabulary and schemas (`…/v0.1.0.jsonld`, `…/v0.1.0.json`). Before changing them, `bump <subject> patch|minor|major`: it keeps the published version online and raises the version. Pages, examples, mapping tables and notes are not versioned and can change without a bump. A renamed model keeps a page at its old address; its old terms keep their anchors.
- `upgrade [--to vX.Y.Z]`: move the node to a newer toolkit release (the workflow pin and the `npx` lines). Dependabot also proposes releases.
- Every attribute in `schema.json` needs an `x-iri`, a term in the subject's `context.jsonld` that expands to it, and a description in `catalog.yaml`. Check the JSON-LD expansion of the example when in doubt.

To have your node listed on datamodels.jp, open an issue at https://github.com/geolonia/datamodels/issues.
