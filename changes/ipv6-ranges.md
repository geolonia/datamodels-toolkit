---
section: Security
---
- Reads of other nodes also refuse IPv6 addresses that carry an IPv4 address (6to4 `2002::/16`, Teredo `2001::/32`) or are not routed (discard-only `100::/64`, benchmarking `2001:2::/48`, documentation `3fff::/20`). A host name that resolves to one of them is refused like a private address.
