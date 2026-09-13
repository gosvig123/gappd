# Combined Meetings and Calendar: round 3

The user selected round 2's A, **Next + history**, as the baseline. This round asks
how Agenda planning and recorded Meeting content can get enough space to use.
The list stays the same in all three variants. No content layout is selected yet.

## Run

```sh
npm --prefix desktop run prototype:meetings-calendar
```

Open http://127.0.0.1:5175/?variant=A. An Agenda opens initially. Use the bottom
arrows or Left/Right to compare the same content in each layout:

- **A — Reading workspace:** compact Next + history navigation beside a wide
  content area. On narrow windows, content temporarily replaces the list.
- **B — Full page:** content replaces the main list. Back to Meetings returns to
  the baseline. The editor uses a comfortable reading width inside the full page.
- **C — Inline expansion:** the selected row expands into a full-width editor,
  with the rest of Next + history still above and below it.

## Interactions

- Add, edit, and remove Agenda topics; write Preparation notes.
- Close content and choose a recorded Meeting from History. Switch between its
  Summary, Transcript, and editable Notes.
- Variant switches preserve topics, notes, selection, and the active content tab.
- Start and stop a demo recording. The planned row becomes recorded without a
  duplicate. Planning topics and preparation notes remain in demo state.
- Demo controls & state below the list shows all state. Choose a disconnected
  Calendar or first-use scenario; this explicitly resets demo edits.

The selected content receives focus and opens at its top. Close/Back returns focus
to the corresponding row where available. Inputs keep normal Left/Right behavior.
Wide editing fields resize vertically; content scrolls with the window.

## Scope and evidence

All data and summary/transcript/context text are illustrative. No audio, AI,
Calendar writes, OAuth, or persistence is called. The normal app still mounts
without `variant`; production excludes the development-only preview.

TypeScript, renderer build, and all 225 desktop tests passed. Browser checks covered
320×568, 600×400, and 1440×900 with no horizontal overflow. At 1440 px, the initial
A editor measured 818 px wide (previous round capped details at 320 px). B and C
use the main content width. Checked topic addition, topic and note retention
across all variants, recorded Meeting notes, five-turn transcript, and visible
Close/Back controls. Screenshots reviewed in all three layouts.

Keep this on `prototype/meetings-calendar`; do not merge throwaway code into beta.
Earlier rounds remain at `39bc3c8` (round 1) and `574fda8` (round 2 and its selected
A baseline). No domain-model change is implied and CONTEXT.md is unchanged.
