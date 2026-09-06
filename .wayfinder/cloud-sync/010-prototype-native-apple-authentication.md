---
id: cloud-sync-010
title: Prototype the native Apple authentication boundary
type: prototype
status: open
label: wayfinder:prototype
parent: Optional cloud sync across Macs
assignee:
blocked_by:
  - Research Sign in with Apple from Electron on macOS
  - Define the cloud account and device lifecycle
---

## Question

Can a packaged, disposable Swift `AuthenticationServices` helper present native Sign in with Apple for `dev.gappd.desktop`, preserve challenge state and nonce, return Apple proof only to Electron main, and support cancellation and credential-state checks without exposing credentials to the renderer or logs?
