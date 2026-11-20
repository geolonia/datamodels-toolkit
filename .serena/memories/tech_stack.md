# Tech stack

- Plain ESM JavaScript (`.mjs`), no TypeScript/build step; published as-is (`files`: bin, src, CHANGELOG.md).
- **npm** (package-lock.json), unlike the sibling datamodels repo which uses pnpm.
- Runtime deps are exact-pinned in package.json (commander, ajv, jsonld, yaml, Eleventy for pages, @clack/prompts for `init`). Node version: `engines`.
- Tests: `node --test` over `test/*.test.mjs`, offline (fixtures).
- npm publishing: trusted publishing (OIDC) from `.github/workflows/publish.yml`; no npm token is used or stored in this repo.

Serena: `typescript` language server (covers .mjs).
