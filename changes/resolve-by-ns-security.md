---
section: Security
---
- `extend` reads the other node's index, schema and example only over https from a public host name, checking every redirect, as `export` does. It reads a schema only under the node's `schema/` and an example only under its `examples/`, and checks the `@context` first. URLs are checked after `..` and `%2e%2e` are resolved, and the resolved `@context` URL is the one written. An index at an `http://` address is no longer read.
- `extend`, `export` and the build follow a redirect of another node's schema or example only when it stays under that node's `schema/` or `examples/`.
- `extend` and `export` take a model from a catalog only when its type name is UpperCamelCase and its version is x.y.z, so a catalog cannot add lines to the files they write.
- `check` reads the indexes, `@context`s and schemas of other nodes only over https from a public host name, checking every redirect. It is a problem when an address this node wrote may not be read as written: an `extends` index in catalog.yaml, a `@context` imported in context.jsonld, or a schema `$ref` (not https, an IP address, localhost). When the network side refuses a read (a redirect to such an address, or a host name that resolves to a private address), it is a note, as for a node that is down, and so is an address that comes from another node's files.
- The build checks a `@context` imported by URL after `..` and `%2e%2e` are resolved, and compares it with the node's and the listed nodes' addresses written the same way (lower-case host, no default port).
- A read of another node's file has one time limit for the whole read, redirects included; a read that takes too long says "timed out after N s".
