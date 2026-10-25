---
section: Security
---
- `datamodels build`, `check` and `release` refuse a symbolic link anywhere in `models/`. Before, `build` published the file a link pointed to, a file outside the node included, for a mapping file or a file of an older release snapshot, and `release` could write through a link.
