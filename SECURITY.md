# Security policy

## Reporting a vulnerability

Report security problems privately through GitHub's private vulnerability
reporting for this repository:
https://github.com/geolonia/datamodels-toolkit/security/advisories/new

Do not open a public issue for a security problem. If a report needs an
example, use a small node or CSV of invented values, not your organisation's
data or a token.

## How reports are handled

This repository has a threat model, [`threat-model.md`](threat-model.md),
that states what the `datamodels` command line, its GitHub Action, its
library exports and its agent skill promise (for example, that reads of other
nodes reach only public https hosts, and that the Action uses the job token
for one fetch of the base branch), what they deliberately do not promise, and
what the person running the command line and the repository owner using the
Action own. The model describes the code at the commit it names. Since
then, the Action passes the job token only to a step of its own that runs only
git, not to the toolkit (#127); the model is updated in #144. A report is
triaged against it:

- A report that violates a property the model claims (§1.11) is a valid
  finding and is fixed.
- A report about something the model states it does not provide (§1.12),
  about code it marks out of scope (§1.3), about an input it treats as trusted
  (§1.7), or about an adversary it excludes (§1.10) is answered by citing the
  section that says so.
- A report that fits none of the model's dispositions (§1.17) means the
  model is incomplete, and the model is revised.

The model is bound to a commit (see its §1.1 header) and is revised when one
of the conditions in its §1.16 happens. `threat-model.yaml` and
`threat-model.json` are machine-readable companions derived from it; the
prose is authoritative.

Questions about a data model or a mapping file of datamodels.jp belong in
[geolonia/datamodels](https://github.com/geolonia/datamodels); its own
security policy and threat model are in progress in
[geolonia/datamodels#290](https://github.com/geolonia/datamodels/pull/290).

## Supported versions

Fixes are released as a new version of `@geolonia/datamodels` on npm and a
new tag of the Action; published versions are not changed. Use the latest
release: `npx @geolonia/datamodels@<version>`, or move a node's workflow with
`datamodels upgrade` or Dependabot.
