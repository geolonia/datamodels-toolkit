# Commands

- `npm ci`, `npm test` (offline).
- Run the local CLI: `node bin/datamodels.mjs <command> …` (not `npx @geolonia/datamodels`, which runs the published version).
- `npm run fixtures` — refresh `test/fixtures/site/` from live datamodels.jp after the catalog changes a model/mapping the tests use; commit the result.
- `npm run fixtures:build -- <datamodels checkout>` — refresh `test/fixtures/catalog/`.
- `npm run changelog -- X.Y.Z` — release PRs only.
No linter.
