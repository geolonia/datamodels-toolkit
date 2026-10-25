---
section: Security
---
- The Action gives the job token only to the step that fetches the base branch of a pull request, which runs git and no code of this package. `check` and `build` run without the job token, and without the runner's OIDC and Actions runtime tokens that a deploying job has (#127).
