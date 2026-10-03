# Contributing

## 日本語まとめ

- 不具合や要望は、このリポジトリの Issue に書いてください。日本語でも英語でも構いません。
- モデルや対応表（`mapping/*.yaml`）の中身についての質問や提案は、[geolonia/datamodels](https://github.com/geolonia/datamodels/issues) へ。
- Pull Request には、変更を確かめるテストを付けてください（`npm test`）。
- すべてのコミットに `git commit -s` で署名（DCO）を付けてください。

---

Bug reports, questions and pull requests are welcome, in English or Japanese.

## Where to report

- **The tool** (`datamodels convert`: wrong output, an error, a missing option): an issue in this repository. Include the command, the first lines of the CSV file if you can share them, and what it printed.
- **A model or a mapping file** (an attribute, a column that maps to the wrong field, a missing mapping): an issue in [geolonia/datamodels](https://github.com/geolonia/datamodels/issues). The conversion rules are part of the catalog; this repository only applies them.

## Pull requests

1. Open an issue first for anything larger than a fix, so we can agree on it before you write code.
2. Add a test for every change in behaviour (`test/`), and run `npm test`.
3. If the catalog changed a model or mapping file that the tests use, refresh the fixtures with `npm run fixtures` and commit them in the same pull request.
4. Keep the README in step with the command line.
5. Sign off every commit (below).

A new subcommand needs a named user and a task that existing JSON-LD and FIWARE tools do not cover ([geolonia/datamodels#91](https://github.com/geolonia/datamodels/issues/91)). Please describe both in the issue first.

Write code comments, commit messages and documentation in plain English: short sentences, common words. Many readers are not native speakers.

## Sign-off (DCO)

`Signed-off-by: Name <email>` in a commit states that you agree to the [Developer Certificate of Origin](https://developercertificate.org/): you wrote the change or have the right to submit it, and it may be published under this repository's licence. There is no separate contributor agreement.

- How: `git commit -s` (the name and email must match the commit's author).
- Forgot it: `git rebase --signoff origin/main`, then `git push --force-with-lease`. If you would rather not rewrite history, add one follow-up commit that signs off the earlier ones, with the text shown in the DCO check's details.

The [DCO app](https://github.com/apps/dco) checks that every commit of a pull request (except bots and merge commits) is signed off by its author.

## Licence

The code is [Apache-2.0](LICENSE). The files in `test/fixtures/site/` are copies of datamodels.jp files, which are CC0 1.0.

## Code of conduct

Geolonia's [code of conduct](https://github.com/geolonia/.github/blob/main/CODE_OF_CONDUCT.md) applies.
