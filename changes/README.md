# Change files

Each pull request with a user-visible change adds one file here instead of editing `CHANGELOG.md`, so parallel pull requests do not conflict. Name it after the branch, for example `changes/fix-init-prompts.md`:

```markdown
---
section: Fixed
---
- `datamodels init` questions take what you type (#79).
```

`section` is one of Added, Changed, Deprecated, Removed, Fixed, Security ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/)). The rest is one or more list items, as they will appear in `CHANGELOG.md`; a long item continues on lines indented by two spaces. One file has one section: a change that adds one thing and fixes another uses two files. A pull request without a user-visible change (tests, CI, internal docs) adds no file.

`npm test` checks every file here. The release pull request runs `npm run changelog -- <version>`, which moves the entries into `CHANGELOG.md` and deletes the files.
