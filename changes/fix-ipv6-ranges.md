---
section: Security
---
- Reads of other nodes also refuse IPv6 addresses that carry an IPv4 address (6to4 `2002::/16`, Teredo `2001::/32`) or are not reachable on the internet (discard-only `100::/64`, dummy `100:0:0:1::/64`, benchmarking `2001:2::/48`, documentation `3fff::/20`, SRv6 `5f00::/16`), and the IPv4 documentation ranges `198.51.100.0/24` and `203.0.113.0/24`. A host name that resolves to one of them is refused like a private address.
