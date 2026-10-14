---
section: Security
---
- `extend` reads the other node's index, schema and example only over https from a public host name, checking every redirect, as `export` does. It reads a schema only under the node's `schema/` and an example only under its `examples/`, and checks the `@context` first. URLs are checked after `..` and `%2e%2e` are resolved, and the resolved `@context` URL is the one written. An index at an `http://` address is no longer read.
- `extend` and `export` take a model from a catalog only when its type name is UpperCamelCase and its version is x.y.z, so a catalog cannot add lines to the files they write.
- `check` reads the indexes, `@context`s and schemas of other nodes only over https from a public host name, checking every redirect. An index or `@context` it may not read is a problem; one that cannot be reached is still a note.
- The build checks a `@context` imported by URL after `..` and `%2e%2e` are resolved.
- A read of another node's file has one time limit for the whole read, redirects included.
