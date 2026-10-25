---
section: Security
---
- The Action gives the job token only to the step that fetches the base branch of a pull request, which runs only git, and to GitHub's Pages actions when it deploys. The other steps run without it (also `actions/setup-node`, which took it by default), and also without the runner's OIDC request variables (a deploying job has them) and a `GITHUB_TOKEN` or `GH_TOKEN` from the calling job's `env:` (#127). Put no secrets in that `env:`: every step inherits it.
