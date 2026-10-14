---
section: Security
---
- `extend` reads the other node's index, schema and example only over https from a public host name, checking every redirect, as `export` does. It reads a schema only under the node's `schema/` and an example only under its `examples/`, and checks the `@context` first. An index at an `http://` address is no longer read.
