---
id: cloud-sync-007
title: Define synchronization and conflict semantics
type: grilling
status: open
label: wayfinder:grilling
parent: Optional cloud sync across Macs
assignee:
blocked_by:
  - Define the cloud meeting projection
  - Set the cloud privacy and retention promise
---

## Question

What are the version, cursor, idempotency, deletion, retry, and conflict rules that guarantee two independent local SQLite databases converge without copying machine-local processing state or silently losing meeting content?
