# Combined Meetings and Calendar prototypes

Question: can one Meetings section make preparation and recorded history easier
to find without treating every Calendar event as a recorded Meeting?

No design has been selected. This is a throwaway branch, not production UI.

## Run

```sh
npm --prefix desktop run prototype:meetings-calendar
```

Open http://127.0.0.1:5175/?variant=A. Bottom arrows or Left/Right switch designs:

- **A — Timeline:** today, upcoming days, then earlier items in one dated list.
- **B — Split view:** upcoming Calendar events and Saved Agenda drafts beside
  recorded Meeting history.
- **C — Day browser:** select a date; search still covers all dates.

The renderer's existing URL hosts a development-only preview before App mounts.
The shell uses Gappd's type and colors, but unrelated navigation is disabled.
The real Electron bridge, account state, and recording APIs are never called.
Without `variant`, the normal app mounts. Production removes the lazy preview.

## Try

- Search titles, people, or demo Agenda topics; filter planned, recorded, or drafts.
- Open a planned event and edit its demo Agenda draft.
- Start and stop a demo recording. It becomes one linked recorded row, not two.
- Switch to No Calendar connection: recorded Meetings and Saved Agenda drafts stay.
- Choose First use to see the empty state. Scenario changes reset all demo state.
- Open the prototype state drawer to inspect all values.
- Resize the browser. Detail panels stack above results in narrow windows.

All data is fictional, with a fixed demo clock of 14 September 2026 at 09:50.
No audio, processing, provider setup, auth, actual search index, or disk persistence
is simulated. The event-to-recorded-row transition is a visual experiment, not
an approved domain-model change. Calendar still remains read-only.

## Validation

TypeScript, renderer build, and all 225 desktop tests passed. Browser checks found
no horizontal overflow in A/B/C at 320×568, 390×740, 600×400, and 1440×900.
Detail views also fit at 390 px. Demo start/stop produced one linked recorded row;
the disconnected scenario retained three recorded Meetings and one Saved Agenda
draft while hiding planned events. Screenshots reviewed for wide A/C and narrow B.

Keep alternatives on `prototype/meetings-calendar`. Implement a chosen design
separately on `beta`; do not merge the prototype or its switcher into production.
