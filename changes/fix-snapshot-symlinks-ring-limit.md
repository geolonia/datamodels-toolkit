---
section: Security
---
- `datamodels build` and `check` refuse a symbolic link in a release snapshot (`releases/vX.Y.Z/`, its `schema/` folder and files). Before, `build` published whatever file the link pointed to, a file outside the node included.
