---
section: Security
---
- `datamodels build`, `check`, `release`, `add` and `extend` refuse a symbolic link anywhere in `models/` (and `extend` a linked `node.yaml`). Before, `build` published the file a link pointed to, a file outside the node included, for a mapping file or a file of an older release snapshot, and `release`, `add` and `extend` could write through a link. A node that uses links in `models/` must replace them with the files.
