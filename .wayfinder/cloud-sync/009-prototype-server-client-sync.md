---
id: cloud-sync-009
title: Prototype the server-client synchronization interaction
type: prototype
status: open
label: wayfinder:prototype
parent: Optional cloud sync across Macs
assignee:
blocked_by:
  - Prototype the native Apple authentication boundary
  - Define the profile storage and runtime boundary
  - Define the cloud meeting projection
  - Define synchronization and conflict semantics
  - Choose the synchronization server architecture
---

## Question

Does a thin, disposable implementation of the chosen server endpoints, PostgreSQL schema, Electron session boundary, and Go push/pull client demonstrate the intended token flow, versioned meeting transfer, idempotent retry, deletion, and two-Mac convergence clearly enough to hand off a production build?
