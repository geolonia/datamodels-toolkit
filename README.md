# datamodels-toolkit

Command-line tools for the [datamodels.jp](https://datamodels.jp) catalog.

It starts with one command, `convert`, which turns a published list (CSV) into entities of a catalog model. More commands come only when someone needs them for a real task that existing JSON-LD and FIWARE tools do not cover ([geolonia/datamodels#91](https://github.com/geolonia/datamodels/issues/91)).

## Install

Node.js 24 or later. Until the package is on npm, run it from GitHub:

```bash
npx github:geolonia/datamodels-toolkit convert <subject>/<Type> <mapping> <file.csv>
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

## Development

```bash
npm ci
npm test
```

The tests read `test/fixtures/site/`, a copy of the files datamodels.jp serves for the mappings they use. After the catalog changes one of those models or mappings, refresh it with `npm run fixtures` and commit the result.

## Licence

The code is [Apache-2.0](LICENSE). The files in `test/fixtures/site/` come from datamodels.jp and are CC0 1.0 ([licence](https://datamodels.jp/LICENSE-CONTENT)). The sample rows in the tests come from Utsunomiya City's and GSI's published lists (CC BY 4.0 and compatible terms), credited where they are used.
