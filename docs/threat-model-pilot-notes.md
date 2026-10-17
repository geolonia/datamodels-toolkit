# Threat-model pilot: lessons from the third run

Date: 2026-10-16. The first draft of [`threat-model.md`](../threat-model.md)
(with `threat-model.yaml` and `threat-model.json`) was produced with the
Alpha-Omega `threat-model` plugin, version 1.2.1 at commit `192fd60`
(https://github.com/alpha-omega-security/threat-model, MIT), the same commit
as the two earlier pilots (the first pilot, a small Cloudflare Workers
service, and the datamodels.jp catalogue, geolonia/datamodels#290), in draft-first mode: the
agent wrote version 1 from the public artifacts and collected 24 questions for
the maintainer in §1.18. This run used Claude Opus 5.5 for the draft, as the
catalogue pilot did (the first pilot used Claude Fable 5.1). The
maintainer answered all 24 questions in one batch on 2026-10-17, accepting
every proposed answer; the model's status is now *accepted* and its triage
policy stays `strict`. The catalogue is a separate model and is named as a
sibling in §1.1.

## Time spent

Wall time by the session clock (JST), from the start of the session to the
draft pull request.

| Phase | Agent wall time | Notes |
|---|---|---|
| Read the plan, the two earlier notes and models; install the skill; read its references | about 5 min | The `/plugin` commands were not available in the session, so `skills/` was copied into `.claude/skills/` (not committed). HEAD of the plugin repository is still `192fd60`. |
| Recon and surface pass (`bin/`, `src/`, `action.yml`, the workflows, the skill, `CHANGELOG.md`, the toolkit pages at datamodels.jp/en/toolkit, GitHub branch and tag rules) | about 6 min | About 7,600 lines of code. One probe run (`mapping` on a crafted CSV) to confirm Q12. |
| Draft the prose | about 7 min | 16,874 words in the first draft (`wc -w`); the validator warns about length, as in both earlier pilots. |
| Backtest, sidecar, JSON export, validator loop | about 9 min | Four validator rounds; the sidecar was generated from the prose tables by a script this time (see below). |
| Lessons note, commit, draft pull request | about 5 min | |
| Maintainer: answer the 24 questions | one batch on 2026-10-17 | Every proposed answer accepted, as in the first pilot. |
| Apply the wave: promote tags, two new claims (Q2, Q12), retire §1.18, re-run the backtest, `SECURITY.md`, regenerate the companions | about 10 min | Two validator rounds: the worked-examples table allows at most four rows, and the JSON schema has no `maintainer` value for a trust boundary (a maintainer ruling is exported as `documented`). The first attempt was stopped by the agent's permission mode, because the request to record the answers came from another session; the maintainer confirmed in this session. |
| Fix the findings of a self-review before ready (a fresh agent's report on the accepted model) | about 10 min | No P0. Narrowed `P-INIT-ONLY-ITS-FILES` (an existing repository's history is pushed: `D-INIT-PUSHES-HISTORY`), named Ajv's generated validators as the exception to `P-NODE-FILES-ARE-DATA`, corrected the deadlines of `search` and `nodes` (15 s, not 20 s), recorded that the check job reads a contributor's `baseUrl` before merge, a second site of the Q12 violation, the OIDC variables in the Action's step, citations, and removed the first pilot's name from this repository. |
| **Total** | **about 52 min agent time**, plus the maintainer's reading | |

As in both earlier pilots, the source comments and the toolkit pages already
state much of the contract, so many claims could be tagged **documented**.
The share of open claims is higher than in the catalogue pilot: the draft
counted 192 documented, 0 maintainer, 65 inferred and 26 assumption tags;
after the wave 193 documented and 97 maintainer (0 inferred, 0 assumption),
counted as the validator counts. A command line promises less in writing than
a catalogue does about resource limits, sandboxing and what its output may
contain, and those are exactly the dimensions the skill asks about.

## What the brief and the repository said

- **The `--base` point from the catalogue pilot.** The toolkit's own
  documentation allows what the catalogue pilot found: during a node's
  pre-release, "an earlier version that should not have been published can be
  removed as a whole", and `check --base` notes corrections and removals
  (datamodels.jp/en/toolkit/versions "Before the launch"). The catalogue's
  README is stricter (only the current version is corrected). So the draft
  treats the toolkit's behaviour as by design and the stricter rule as the
  catalogue's own policy, kept by review (Q6); a "current version only"
  option is a candidate feature, not a fix. The catalogue's Q4 and this
  model's Q6 should be answered together.
- **The skill does not ship in the npm package.** `package.json` `files` is
  `bin`, `src`, `CHANGELOG.md`; the README tells users to copy
  `skills/datamodels/` from the repository. It is in scope as a family of its
  own (`agent-skill`), distributed by copy.
- **Provenance exists.** `publish.yml` uses npm trusted publishing with
  `--provenance`, no npm token. The only gate is publishing the GitHub release
  (stated in the workflow and the README); `v*.*.*` tags are immutable by an
  organisation ruleset that the operations team can bypass (from the GitHub
  API, not the repository).

## Questions: reused from the earlier pilots, and new for a CLI and an Action

From the skill's own bank: wave 1's scope, configuration support and side
effects (Q1, Q3, Q4) and the coexistence question (Q5).

The earlier pilots' generic questions, and how they fitted here:

| Earlier pilot's question | Used here as | Fit |
|---|---|---|
| Client-supplied outbound URL (first pilot Q9) | Q13, Q14 (which reads go through the shared reader; which URLs are trusted input) | Direct fit, split in two: reads of other nodes are guarded; `--site`, `baseUrl` and GitHub's API are not. |
| Public data as facts (first pilot Q10, Q11) | Q15 (datamodels.jp trusted for content; other nodes for nothing; `extend` copies unreviewed) | Direct fit. |
| Request size (first pilot Q8, catalogue Q16, Q20) | Q7, Q16 (local files have no limits; reads of other nodes are bounded) | Direct fit, twice. |
| A separate component family with its own adversary (first pilot Q3, catalogue Q1) | Q1 (catalogue as sibling) | Direct fit. |
| Attacker-controlled input to an LLM prompt (first pilot Q7, catalogue Q17) | Q21 (`llms.txt`, AI adapter descriptions, the agent skill) | Turned around again: the toolkit writes the text agents read, and ships the skill that sends agents to read it. |
| Pre-release mutability (catalogue Q3, Q4) | Q6 | Direct fit; the answer may differ (by design here, review-only there). |
| Merge as publication, branch rules (catalogue Q7) | Q18 (the node owner's branch rules) | Moved to the integrator: the toolkit cannot see a node's branch rules. |
| Third-party text on pages (catalogue Q18) | Q19 (`P-PAGES-ESCAPED` tier) | Direct fit. |
| Reporting and coexistence | Q5 | Direct fit. |
| Bind to a commit (catalogue Q24) | Q24 | Direct fit; bound to the commit after the `v0.3.16` release. |
| Model output as untrusted input to a policy; per-client credentials; MCP and OAuth; what an audit log proves | not used | No model, no credentials, no server, no log. |

New questions written for a command line and a GitHub Action (candidates for
the Geolonia question-bank extension, same proposed-answer style):

| Area | Toolkit question | Generic form for the extension |
|---|---|---|
| Not a sandbox | Q2 | "We believe the tool processes its inputs as data and runs nothing from them, but does not isolate them from the rest of the machine; is 'nothing in the input folder runs as code' a promise?" |
| Configuration files that read other files | Q11 | "We believe a configuration file that names other files is trusted like code; a report that it reads outside its folder is trusted-input." |
| Parser contracts | Q7, Q8, Q9, Q10 | "We believe the tool relies on each parser's documented defaults (YAML aliases, JSON depth, JSON Schema compilation, JSON-LD loading) and sets no limits of its own; which of these is a stated limit?" |
| Input text echoed into generated files | Q12 | "We believe text from an input file cannot add lines to a file the tool writes; is that a promise?" |
| Reads outside the guarded network path | Q14 | "We believe only reads of third parties go through the guarded reader; URLs from the user's options or own configuration are trusted input." |
| Job token in a composite Action | Q17 | "We believe the Action uses the token only for the steps that need it; is it acceptable that the tool's process has it in its environment?" |
| Pull-request code in the check job | Q18 | "We believe a contributor whose pull request runs in the check job already has that job's capabilities; the tool adds none." |
| Output as someone else's input | Q19 | "We believe converted output is exactly as untrusted as the input; escaping is the consumer's job." |
| Publish gate and lockfile | Q20 | "We believe one person can publish a release; is that stated? Do package users get a fixed dependency tree?" |
| A shipped agent skill | Q21 | "We believe the skill is guidance, not a control; nothing filters the text it sends agents to read." |
| Tools that publish on the user's behalf | Q22 | "We believe the tool publishes only the files it wrote, and always publicly." |

## What did not fit a command line and an Action

- **Two integrators, two places.** The person running the command line and
  the repository owner using the Action own different things: the files they
  pass, and the job's permissions and branch rules. The skill's single
  "integrator" role worked, but §1.13 had to be split by role, as it was for
  the catalogue's operator.
- **The pull-request job is not a boundary the tool can defend.** On
  `pull_request` GitHub runs the contributor's own workflow file, so anything
  the toolkit does in the check job, the contributor could do anyway. The
  skill has no question for "the attacker already runs code next to you";
  Q18 says it in the model's words, and it routes contributor reports about
  the check job to `adversary-not-in-scope`.
- **Configuration that is also a URL.** `baseUrl` and `--site` are trusted
  options, but they are also addresses the tool reads. The skill's control
  kinds (data, resource-name) do not say "trusted, but read over the
  network"; the draft adds an `x-outbound-requests` dimension.
- **The dimensions.** As in both earlier pilots, recursive topology,
  serialization, lifecycle and concurrency are mostly not applicable to a
  command line; for the agent skill six of eight are. Three project-specific
  dimensions were added: `x-outbound-requests`, `x-version-immutability` and
  `x-agent-instructions`.
- **Length.** 16,874 words in the first draft and 15,853 in the accepted model (`wc -w`), against the 3 to 8 pages the skill asks for. The
  matrix (8 families × 8 dimensions + 10) and the 43-row input table are most
  of it, as before. A per-family appendix would help here too.
- **The sidecar.** The first two pilots wrote the YAML by hand. This run
  generated it from the prose tables with a short script (in the session
  scratchpad, not committed): the matrix, §1.5, §1.6, §1.8, §1.10, §1.12 and
  §1.15 are parsed; entry points, properties and responsibilities are listed
  in the script. Regenerating after a prose change took seconds and kept the
  digest right. Two validator rules were learned the hard way: every
  parameter that is not `none — <property>` needs an `obligation_id`, also a
  trusted one, and every build flag needs an `affects_properties` list, empty
  when it is not security-relevant. Worth upstreaming as a generator, or at
  least documenting.
- **The JSON exporter** again needs hand completion of `description` and
  `trust_boundaries`, as §1.19 says. Its schema (`spec_version` 1) allows
  exactly nine dispositions and has no value for `OUT-OF-MODEL:
  dependency-contract`, so a JSON-only consumer cannot route a report about a
  dependency; the YAML has it. The exporter also cut citations that contain
  parentheses or quotes, which left broken text in the `environment` entries;
  the citations were reworded. Both are worth an upstream issue.
- **The backtest** had a real corpus for the first time worth the name: nine
  fixed defects from the changelog ("Security" and "Fixed" of 0.3.15 and
  0.3.16) and issue #93. All nine route `VALID`; fail-safe figure 0 of 9. The
  20 synthesized cases produced two `MODEL-GAP`s, both the unresolved rows of
  Q2 and Q12, which is the intended outcome for an unratified draft.
- **The secret scanner.** "Login" next to backticked names was the first
  pilot's false positive. The draft says "account" instead of "login", quotes
  no line with "password", and writes `TOKEN` without its `${{ }}` value in
  prose. The pull request's checks are the real test.

## The questions of the first draft and their answers

All 24 were answered on 2026-10-17 with the proposed answer; the ratified
claims carry *(maintainer, 2026-10)* in `threat-model.md`, and §1.18 is now
marked not applicable. The list is kept here as the record of what was
asked, since the skill deletes answered questions from the model. Two answers
added claims: Q2 (`P-NODE-FILES-ARE-DATA`, security-critical) and Q12
(`P-CSV-TEXT-NO-NEW-LINES`, correctness-only, with `D-LOCAL-TEXT-ECHOED` for
terminal output). The second is violated at the bound commit: the model
records that a report of it is `VALID`, and the fix stays candidate issue 1.
The backtest re-run turns the two former `MODEL-GAP`s into `VALID` and the
eleven escalated closes into closes; fail-safe figure still 0 of 9.

**Wave 1 — scope, roles, configuration, side effects**

- Q1 Scope: eight families in one model (`convert`, `node-tools`,
  `remote-reads`, `init-github`, `action`, `library`, `agent-skill`,
  `release-pipeline`); tests, `scripts/`, `changes/`, the toolkit pages,
  users' nodes and the catalogue out. The CLI user and the Action's
  repository owner are trusted integrators; CSV authors, node contributors and
  other nodes' operators are untrusted; datamodels.jp is trusted for content.
  Proposed: yes.
- Q2 Not a sandbox: claim "nothing in a node folder runs as code in `check`
  or `build`" (security-critical, `.eleventyignore` named as the exception),
  and disclaim file access with the user's rights. Proposed: (a) claim.
- Q3 `--site`, `--index` are trusted user choices; plain-http `--site` is the
  user's risk; a library caller's own `fetch` owns the address check.
  Proposed: yes.
- Q4 Side effects: network as listed, child processes only `git` and `gh`
  (plus `npm ci`, `git fetch` in the Action), writes only to named outputs, no
  environment reads in the toolkit's code. Proposed: yes.
- Q5 Reporting: the organisation's `SECURITY.md` and private vulnerability
  reporting; no earlier model; the catalogue's model is a sibling. Proposed:
  yes.
- Q6 During a pre-release, `check --base` notes changes to any snapshot, as
  the toolkit's documentation allows; the catalogue's stricter rule is its
  own policy. Proposed: yes, by design; "current version only" is a feature
  candidate.

**Wave 2 — local input files and their parsers**

- Q7 No size or nesting limits on local files or library input; stated,
  correctness-only. Proposed: yes.
- Q8 YAML and JSON rely on the parsers' defaults; a YAML feature that runs
  code is `dependency-contract`. Proposed: yes.
- Q9 Ajv compiles schemas, including remote `$ref` targets in `check`; slow
  patterns and huge schemas are a stated limit, correctness-only. Proposed:
  yes.
- Q10 JSON-LD reads any public https context through the shared reader; an
  unread one is a note. Proposed: yes.
- Q11 A mapping file is trusted configuration; `via` may read any YAML file.
  Proposed: yes.
- Q12 CSV header text adds lines to the mapping file `mapping` writes (tried):
  claim that it must not, correctness-only, so it is `VALID` and gets a fix;
  terminal echo of local text stays disclaimed. Proposed: (a) claim.

**Wave 3 — network**

- Q13 `P-PUBLIC-READS` is security-critical and covers every read of another
  node; its only off-switch is a caller's own `fetch`. Proposed: yes.
- Q14 `--site`, the node's own site under `baseUrl`, and GitHub's API are
  read outside the shared reader; their URLs are trusted input; state it as
  `D-OWN-SITE-READS`. Proposed: yes.
- Q15 Trusted as data: datamodels.jp for `convert`, GitHub's API for
  `upgrade`; other nodes for nothing; `extend` copies unreviewed content.
  Proposed: yes.
- Q16 Remote reads bounded (5 MB, one deadline per read — 15 s in `search`
  and `nodes`, 20 s elsewhere, as corrected after the self-review — depth 5,
  50 nodes),
  correctness-only; only the `search`/`nodes` listing is plain text, notes and
  errors are not. Proposed: yes to both.

**Wave 4 — the Action, outputs, supply chain, agents, meta**

- Q17 The token is in the whole "Check" step's environment; state it
  (`D-TOKEN-IN-STEP-ENV`, security-critical) and claim the Action's own use.
  Proposed: yes; narrowing it is a hardening candidate.
- Q18 A contributor already runs code in the `pull_request` job; their
  reports about that job are `adversary-not-in-scope`; required checks are the
  owner's job. Proposed: yes.
- Q19 `convert` output as untrusted as the CSV (stated, security-critical);
  pages escaping and context imports correctness-only; SQL quoting
  security-critical. Proposed: yes.
- Q20 One person can publish a release to npm (stated); tags immutable with an
  operations bypass; no lockfile in the package (`D-NO-SHRINKWRAP`,
  security-critical); a malicious transitive version is
  `dependency-contract`. Proposed: yes to both.
- Q21 The agent skill is guidance; agent text is unfiltered
  (`D-AGENT-TEXT` security-critical, `D-SKILL-GUIDANCE-ONLY` correctness-only).
  Proposed: yes to both.
- Q22 `init --github` always creates a public repository with only the files
  it wrote. Proposed: yes. (Qualified after the self-review: in a folder that
  is already a git repository without a remote, it pushes the whole local
  history, older files and commits included; `D-INIT-PUSHES-HISTORY`.)
- Q23 `P-PUBLISHED-COMPARISON` is correctness-only (online only). Proposed:
  yes.
- Q24 Bind to `4d88e4e`, keep `strict`, re-run at the next minor release or a
  §1.16 trigger. Proposed: yes.

## Candidate issues (not in the model)

The model describes the toolkit as it is. These came up while reading and
belong in issues, not in the threat model:

1. `mapping` writes CSV header names into YAML comments with their line
   breaks, so a header can add lines to the generated mapping file. Two
   places: the list of unused columns (`src/mapping.mjs:444`) and the "maybe"
   suggestions in a row's comment (`src/mapping.mjs:426`, written at `:432`).
   Reduce header text to one line there and in the summary (Q12,
   `P-CSV-TEXT-NO-NEW-LINES`).
2. Move `TOKEN` from the "Check" step's environment into the `git fetch` alone
   (for example a separate step), so the toolkit process does not carry the
   job token (Q17).
3. Read `--site` and the node's own published files (`check`, `release`)
   with the same rules as other nodes, or with a size cap and a deadline at
   least (Q14).
4. An option for `check --base` that allows pre-release corrections only for
   the current version, which the catalogue's README rule needs (Q6, catalogue
   Q4).
5. Decide on a lockfile for `npx` users (`npm-shrinkwrap.json`) or document
   that the transitive tree is resolved at install time (Q20).
6. Consider a release environment with a required reviewer for `publish.yml`,
   or keep the single gate and say so in a `SECURITY.md` (Q20).
7. ~~A `SECURITY.md` in the repository that links this model, as the first
   pilot did (Q5).~~ Done in this PR.
8. Document in the README that a mapping file is trusted configuration and
   that `via` can read any YAML file (Q11).
9. `init --github` in a folder that is already a git repository without a
   remote pushes its whole local history to the new public repository;
   checking only the working tree is not enough. Refuse a repository with earlier
   commits, or push only `init`'s commit (`D-INIT-PUSHES-HISTORY`).
10. Upstream to Alpha-Omega: a sidecar generator from the prose tables, the
   `obligation_id` and `affects_properties` rules in `sidecar-schema.md`, the
   exporter reading §1.1's description and §1.4, a JSON value for
   `dependency-contract`, citations with parentheses kept whole by the
   exporter, and question-bank entries for
   "the attacker already runs code next to you" and "trusted configuration
   that is also a URL".
11. For `geolonia/skills`: the CLI and Action questions in the table above,
    next to the first pilot's and the catalogue's questions.

## Files

- `threat-model.md` — the prose model (canonical).
- `threat-model.yaml` — the sidecar (`threat-model-sidecar/v2`), bound to the
  prose by SHA-256.
- `threat-model.json` — the flat export (`schema.json`, spec 1), with
  `description` and `trust_boundaries` completed by hand.
- `SECURITY.md` — the reporting channel and how reports are triaged against
  the model.
- `.threat-model/backtest.md` — producer-side routing table, ignored by git
  and not in the repository, as the skill asks; only the aggregate figures in
  §1.1 are published.
- The skill itself lives in `.claude/skills/` in the working tree and is not
  committed; reinstall it with `/plugin marketplace add
  alpha-omega-security/threat-model` and `/plugin install
  threat-model@threat-model`, or copy the `skills/` folder from the plugin
  repository at commit `192fd60`.

To re-validate after a change (needs Python with PyYAML and a checkout of the
plugin repository):

```bash
python tests/harness/validate_model.py threat-model.md threat-model.yaml --json-report threat-model.json --source-root .
```
