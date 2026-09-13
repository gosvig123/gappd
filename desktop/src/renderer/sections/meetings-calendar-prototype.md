# Combined Meetings and Calendar: round 2

Question: can a simpler combined Meetings section keep preparation and recorded
history together without treating Calendar events as recordings?

The user liked the combined direction but asked for three simpler ideas. No design
is selected. Round 1 is preserved at commit `39bc3c8` on this prototype branch.

## Run

```sh
npm --prefix desktop run prototype:meetings-calendar
```

Open http://127.0.0.1:5175/?variant=A. Use the bottom arrows or Left/Right:

- **A — Next + history:** one upcoming event above history; expand the remaining
  upcoming events only when needed.
- **B — Upcoming / Past:** two choices, one list at a time. Search covers both.
- **C — One list:** all items visible, with one divider before past items.

Removed the calendar account strip, microphone toolbar, four filter buttons,
date selector, repeated row descriptions, people metadata, counts, and action
arrows. Rows show a title, date/time, and plain-text state. Open a row for people,
Agenda topics, a summary, or the demo recording action. The demo scenario selector
and full state now sit in a disclosure below the content, not in the app header.

## Try

- Search a title, person, or Agenda topic across all items.
- Open a planned event, edit topics, then start and stop a demo recording.
  The same row becomes recorded; no duplicate is added.
- Open Demo controls & state. Choose No Calendar connection: three recorded
  Meetings and one Saved Agenda draft remain. First use shows an empty state.
- Resize the window. Detail panels stack above results when space is narrow.

Scenario changes reset demo state. All data is fictional, with a fixed clock of
14 September 2026 at 09:50. Changes stay in memory. No audio, AI processing,
OAuth, Calendar writes, real search index, or persistence is called. Unrelated
sidebar navigation is disabled. Calendar remains read-only.

The renderer's existing URL hosts a development-only preview before App mounts.
Without `variant`, the normal app mounts. Production removes the preview import.
Keep alternatives on `prototype/meetings-calendar`; implement a chosen design
separately on `beta`, not by merging this throwaway code.

## Validation

TypeScript, renderer build, and 225 desktop tests passed. Browser checks found no
horizontal overflow in A/B/C, with and without details, at 320×568, 600×400, and
1440×900. Checked upcoming expansion, Upcoming/Past switching, search across both
periods, editable draft access, demo start/stop without duplication, and retained
recordings/drafts when disconnected. No new domain knowledge was introduced.
