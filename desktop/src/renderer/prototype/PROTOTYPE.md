# Gappd UI overhaul prototype

**Status: throwaway.** This is a prototype for judging an overhauled Gappd UI. It is not
production code, it has no tests, and it must not be shipped as-is.

## The question

> What should a fully overhauled Gappd UI look like?

The design question has three parts, and this prototype answers all three at once:

- **A — Targeted UX fixes.** One alert surface instead of five stacked banners, real confirm
  dialogs instead of `window.confirm`, Meeting search instead of DOM find-on-page, no lost list
  scroll position.
- **B — Navigation and information architecture.** Where Meetings, Calendar, Saved Agenda drafts,
  and People actually live.
- **C — Visual system.** A type scale with real hierarchy, calmer density, and an optional light
  theme.

The production renderer has a mature token system, so the point is not a restyle. The point is to
compare **structurally different layouts** against the same real data and the same real behaviour.

## Run it

```bash
npm run prototype
```

That starts the Vite dev server and opens `http://127.0.0.1:5173/prototype.html`. It needs no
Electron, no native build, and no local model.

| Controls | Effect |
| --- | --- |
| `←` / `→`, or the floating bar | Cycle variants |
| `LIGHT` / `DARK` in the floating bar | Switch theme |
| `?variant=a`, `?variant=b`, `?variant=c` | Deep-link a variant |
| `&theme=light` | Deep-link the theme |
| `Cmd/Ctrl+F` | Search Meetings (in every variant) |

## Why the prototype has its own entry document

The renderer has no router, and the variants disagree about the **shell** — top bar, sidebar,
panes. A variant cannot restructure a shell it is rendered inside. So the prototype gets its own
`prototype.html` entry instead of a route, and the real data layer
(`desktop/src/renderer/prototype/host.tsx`) sits above the switcher, so every variant is judged
against identical behaviour and identical state.

`vite build` only builds `index.html`, so nothing here can reach a release.

## Seeded state

`window.gappd` is replaced by a seeded, in-memory stub (`prototype/stub/`). The stub never touches
the real Meeting database and never persists. It covers the states that matter:

- 11 Meetings — recording, pending, processing, capture failure, `diarization.state === 'degraded'`,
  and completed Meetings with notes, transcripts, and 2–4 named speakers.
- 2 Google Calendar connections, one of them with `status: 'error'`, plus 7 events (past,
  in progress, upcoming).
- 2 Saved Agenda drafts, 5 saved People, 3 audio devices.
- Local AI ready, an app update available, permissions granted, recording idle. Record creates a
  live Meeting; Stop returns to idle after about one second.

## The three variants

### A — Reading Room (`?variant=a`)

One centred column. Search is the primary affordance; an opened Meeting replaces the index like a
document. Alerts collapse into a single rail that expands on demand. Settings is a right sheet.
Destructive actions use a centred confirm dialog.

**Best when** the product should feel like a calm local archive and reading Notes is the main job.
**Weakest when** you compare two Meetings, because only one is on screen.

### B — Split Console (`?variant=b`)

A persistent left rail beside a working pane. The rail never unmounts, so list scroll position,
the search query, and the keyboard highlight survive opening a Meeting — the specific defect that
variant A still has. Record appears exactly once, in the top strip. Delete is inline, with an undo
window. The idle pane is a real home: Up next, Calendar connections, Saved Agenda drafts, recent
Meetings.

**Best when** people work through a backlog of Meetings with the list always in view.
**Weakest when** the window is narrow, because two panes compete for width.

### C — Today Deck (`?variant=c`)

A left sidebar with four real sections (Today, Meetings, Calendar, People). Today is a day timeline
of Calendar events with a "Now" marker, live processing cards, and recent Meetings. Meetings is a
sortable **table**, not cards. A floating record dock follows the user across sections. Only
blocking problems get a banner; everything else is a toast.

**Best when** the product should be a meeting-day command centre rather than an archive.
**Weakest when** the user mainly reads old Notes, because Today is in the way.

## The seven reforms, per variant

| Reform | A | B | C |
| --- | --- | --- | --- |
| One alert surface | Collapsed rail in the top bar | Thin full-width rail | Blocking banner + toast stack |
| No `window.confirm` | Centred dialog | Inline confirm + undo | Centred dialog |
| `Cmd/Ctrl+F` searches Meetings | Top-bar search | Rail search | Section search |
| Real type hierarchy | Hero title, 30px | Pane title, 22px | Section title, 22px |
| Dense Meeting rows | Index rows, 2 lines | Rail rows, 2 lines | Table rows |
| Accessibility | Tab semantics, `aria-current`, focus | Same, plus arrow-key list | Same, plus `aria-sort` |
| Light theme | Yes | Yes | Yes |

Rebuilt once, shared by all three: the v2 type scale and the light theme live in
`prototype/prototype.css` as token overrides. That is the smallest possible change to the design
system, and it is the part most worth folding into `theme.css`.

## Judging it

The useful feedback is rarely "pick B". It is usually "the header from B with the sidebar from C".
Open all three, then say which *parts* win. Note in particular:

1. Should the Meeting list ever unmount? (A and C: yes. B: no.)
2. Should Calendar and People be first-class sections, or settings?
3. Is a table or a row list the right shape for Meeting history?
4. Does light mode belong in this product at all?

## Known limits

- No real audio, no real transcription, no real model calls. `speakerClip` returns a generated tone.
- Agenda generation returns a small fixed set of topics instead of running a model.
- The prototype shows seeded Meetings, not your Meetings.
- Variant C's People section is a new surface; the production app has no People screen today.

## Cleanup

Once a winner is chosen, fold the chosen structure into the real renderer, then move this whole
directory plus `prototype.html` and the `prototype` npm scripts to a throwaway branch. Keep the
losing variants there as a primary source. `main` keeps only the validated decision.
