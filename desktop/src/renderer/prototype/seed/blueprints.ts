import type { CaptureStatus, DiarizationState, MeetingState, ProcessingStatus } from '../../../shared/generated/protocol'

export type Turn = [speaker: string, text: string]

export type Blueprint = {
  id: string
  title: string
  dayOffset: number
  hour: number
  minute?: number
  minutes: number
  state: MeetingState
  captureState?: CaptureStatus
  processingState?: ProcessingStatus
  failureMessage?: string
  diarizationState?: DiarizationState
  diarizationError?: string
  summary?: string
  turns?: Turn[]
}

const PRODUCT_SYNC_SUMMARY = `## Decisions

- Ship the keyboard-first Meetings list in 0.2.0. The **Reading Room** layout stays the default.
- Delete becomes undoable. Native confirm dialogs go away.
- Recording moves to one predictable place instead of two.

## Action items

- **Priya Raman** — draft the undo model for deleted Meetings.
- **Marco Silva** — trace where list scroll position resets.
- **Unassigned** — audit every alert surface against the new single rail.
`

const DESIGN_REVIEW_SUMMARY = `## What we reviewed

Walked through the first-run permission flow on a clean Mac.

## Findings

- Three permission prompts appear before any content. Too heavy.
- Speaker labels need a clearer trust cue. Users assume full accuracy.
- The Meeting detail tabs read as filters, not as panes.

## Next step

- **Dana Whitfield** — rebuild the empty states with a real primary action.
`

export const BLUEPRINTS: Blueprint[] = [
  {
    id: 'm-01', title: 'Weekly product sync', dayOffset: 0, hour: 9, minute: 30, minutes: 47,
    state: 'completed', diarizationState: 'completed',
    summary: PRODUCT_SYNC_SUMMARY,
    turns: [
      ['Priya Raman', 'Let us start with the one thing that keeps coming back: people cannot find a meeting they recorded last month.'],
      ['Marco Silva', 'Right. The list scrolls back to the top every time you open a meeting and come back. I can reproduce it every single time.'],
      ['Krisitan Ahmadi', 'So the list unmounts. That is the whole bug. It is not a scroll problem, it is a mounting problem.'],
      ['Dana Whitfield', 'Which is also why the search box survives but the position does not. The query lives higher up than the list.'],
      ['Priya Raman', 'Good. Fix the mount, and we probably get the side-by-side layout for free on wide screens.'],
      ['Marco Silva', 'That is a bigger change. I would rather split the console so the list always stays visible.'],
      ['Krisitan Ahmadi', 'Then we prototype both and stop arguing about it on a call.'],
      ['Dana Whitfield', 'Agreed. And while we are there, the delete confirmation. Native dialogs feel like a different app.'],
    ],
  },
  {
    id: 'm-02', title: 'Design review — onboarding', dayOffset: 0, hour: 11, minutes: 38,
    state: 'completed', diarizationState: 'completed', summary: DESIGN_REVIEW_SUMMARY,
    turns: [
      ['Dana Whitfield', 'Permission prompts come first, before we show a single meeting. On a clean Mac that is three dialogs.'],
      ['Krisitan Ahmadi', 'And two of them are stacked at the same time on screen.'],
      ['Dana Whitfield', 'Yes. One rail, ordered by what actually blocks work.'],
      ['Marco Silva', 'I will fix the empty state. Right now it is one sentence and a shrug.'],
    ],
  },
  {
    id: 'm-03', title: 'Vendor call: Northwind', dayOffset: 0, hour: 13, minute: 15, minutes: 52,
    state: 'processing', captureState: 'captured', processingState: 'processing', diarizationState: 'processing',
    turns: [['Ana Petrova', 'We can share the contract draft before Friday.']],
  },
  {
    id: 'm-04', title: '1:1 with Priya', dayOffset: 0, hour: 15, minute: 30, minutes: 28,
    state: 'pending', captureState: 'captured', processingState: 'pending', diarizationState: 'pending',
  },
  {
    id: 'm-05', title: 'Quarterly planning kickoff', dayOffset: -1, hour: 14, minutes: 96,
    state: 'completed', diarizationState: 'degraded', diarizationError: 'Speaker separation was uncertain for 3 of 4 voices.',
    summary: `## Objectives for the quarter

- Cut time-to-first-note below 90 seconds.
- Make Meeting history genuinely searchable, not just filterable.
- Ship one alert surface instead of five.

## Commitments

- **Krisitan Ahmadi** — prototype the three layout directions.
- **Priya Raman** — define what "searchable" means for transcripts.
`,
    turns: [
      ['Priya Raman', 'Three objectives. One: time to first note under ninety seconds.'],
      ['Krisitan Ahmadi', 'Today it is closer to three minutes when a model has to warm up.'],
      ['Marco Silva', 'Two: search has to actually search. Right now it only matches the title and a summary blob.'],
      ['Priya Raman', 'Three: one alert surface. We currently render five banners in a stack.'],
      ['Krisitan Ahmadi', 'Five. I counted them this morning.'],
    ],
  },
  {
    id: 'm-06', title: 'Customer interview — Beacon Health', dayOffset: -2, hour: 10, minute: 30, minutes: 41,
    state: 'completed', diarizationState: 'completed',
    turns: [
      ['Ana Petrova', 'Our care coordinators record every patient handoff, then never listen to a single one again.'],
      ['Priya Raman', 'So what do you do with them?'],
      ['Ana Petrova', 'We search. Badly. Usually we scroll and guess.'],
      ['Priya Raman', 'If search was instant across transcripts, what changes for you?'],
      ['Ana Petrova', 'Everything. That is the product, honestly.'],
    ],
  },
  {
    id: 'm-07', title: 'Sprint retro', dayOffset: -3, hour: 16, minutes: 35,
    state: 'completed', diarizationState: 'completed',
    summary: `## Keep

- Small, single-purpose pull requests.

## Change

- Stop adding banner surfaces. Consolidate instead.
- Write the empty state before the feature.
`,
    turns: [
      ['Marco Silva', 'Keep: small pull requests. Change: stop adding banners.'],
      ['Dana Whitfield', 'Strong yes on the banners.'],
    ],
  },
  {
    id: 'm-08', title: 'Budget review', dayOffset: -5, hour: 9, minutes: 12,
    state: 'failed', captureState: 'failed', processingState: 'failed', diarizationState: 'not_requested',
    failureMessage: 'System audio capture stopped before the meeting ended.',
  },
  {
    id: 'm-09', title: 'Recruiting: staff engineer', dayOffset: -8, hour: 11, minutes: 55,
    state: 'completed', diarizationState: 'completed',
    summary: `## Signal

- Strong systems background. Owned an on-call rotation for a local-first data layer.

## Concerns

- Has not worked on macOS capture permissions before.
`,
    turns: [
      ['Priya Raman', 'Walk me through the hardest thing you have shipped.'],
      ['Marco Silva', 'A local sync engine with no server to blame.'],
      ['Priya Raman', 'That is the right answer for this team.'],
    ],
  },
  {
    id: 'm-10', title: 'Board prep', dayOffset: -12, hour: 15, minute: 30, minutes: 64,
    state: 'completed', diarizationState: 'completed',
    turns: [
      ['Krisitan Ahmadi', 'Numbers first, then the product narrative.'],
      ['Priya Raman', 'And one honest slide about what is not working yet.'],
    ],
  },
  {
    id: 'm-11', title: 'Offsite debrief', dayOffset: -20, hour: 10, minutes: 30,
    state: 'completed', diarizationState: 'not_applicable',
  },
]
