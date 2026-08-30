# Gappd

Gappd is a local-first desktop application for recording and reviewing private meeting notes.

## Language

**Local installation**: The on-device Gappd profile that owns local meetings, settings, and connected service state.

**Gappd account**: An optional Clerk identity for cloud features; it does not gate local features or Google Calendar.

**Google Calendar connection**: On-device authorization for one Google account’s primary calendar, with its own tokens, cache, synchronization state, and disconnect lifecycle.

## Relationships

- A **local installation** can exist without a **Gappd account**.
- A **local installation** can own multiple **Google Calendar connections** independently of its **Gappd account**.
- A **Google Calendar connection** reads one Google account’s primary calendar only.

## Example dialogue

> **Dev:** “Does connecting Google Calendar create or require a Gappd account?”
> **Domain expert:** “No. The Google Calendar connection remains independent and on-device.”

## Flagged ambiguities

- How an existing **local installation** later attaches to a **Gappd account** is not yet defined.
