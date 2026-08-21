---
id: cloud-sync-002
title: Research backend platform fit for explicit meeting sync
type: research
status: closed
label: wayfinder:research
parent: Optional cloud sync across Macs
assignee:
blocked_by: []
context: research/backend-platform-fit.md
---

## Question

Which backend shape best supports Gappd's explicit push/pull synchronization boundary: Supabase Auth plus PostgreSQL and a thin service, a standalone Go service with managed PostgreSQL, or an Apple-only CloudKit bridge? Compare authentication integration, authorization, local-first behavior, deployment burden, observability, testing, and lock-in using primary sources.
