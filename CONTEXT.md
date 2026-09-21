# Gappd

Gappd is a local-first macOS meeting application. Recording, transcription, meeting history, model setup, and settings remain usable without a cloud identity or Google Calendar connection.

## Language

**Meeting**:
A user-initiated local recording with its derived transcript and meeting data.

**Person**:
A saved identity that can be assigned to speakers in multiple meetings.

**Meeting speaker**:
A voice identified within one meeting, optionally linked to a saved person.

**Calendar invitee**:
A person listed on a calendar event whose attendance and voice identity still need confirmation.

**Agenda draft**:
Editable preparation for an upcoming calendar event, grounded in matched Meetings and authorized Gmail or Slack communication.

**Saved Agenda draft**:
An Agenda draft that Gappd keeps encrypted on this Mac for one Calendar event, together with the topics the user edited.

**Google Calendar connection**:
Read-only authorization for one Google account's primary calendar, with independent synchronization, errors, reconnect, and disconnect behavior.

**OAuth relay**:
The isolated `auth.getgappd.com` credential proxy that transiently adds Google's Desktop client secret and does not persist authorization codes, tokens, Calendar data, or meeting data.

## Relationships

- A Gappd identity and a **Google Calendar connection** are separate and neither gates local app features.
- Each **Google Calendar connection** owns its encrypted on-device tokens and Calendar cache.
- Assigning a **Person** to a **Meeting speaker** names their transcript turns and refreshes the meeting's summary.
- A **Meeting** can retain a calendar event snapshot to suggest **Calendar invitees** when labeling speakers.
- Disconnecting one **Google Calendar connection** removes only that account's authorization and Calendar cache; existing **Meetings** and their confirmed Calendar snapshots remain, but that account no longer supplies inferred overlap context. Saved Agenda drafts are local user work and remain.
- The renderer receives Calendar snapshots and account operations, never Google tokens or relay private keys.
- An **Agenda draft** uses matched **Meeting** history, optional Gmail communication with **Calendar invitees** from the event's Google account, and existing invitee DMs plus explicitly selected joined channels when Slack is connected. The configured AI provider processes bounded recent communication; a remote provider receives that text. Generation does not send messages or change Calendar, and saved drafts retain source labels and exact quotes rather than complete messages.
- A **Saved Agenda draft** stays readable and editable after its event leaves the upcoming Calendar window or its **Google Calendar connection** becomes unavailable; regenerating it requires the event to be upcoming.
- Installed Codex operations use one model and one reasoning effort from the installed Codex model catalog; an unset model uses the app default, and Gappd never substitutes a model or effort the catalog does not advertise.
- An **Agenda draft** checks later sources across **Meetings**, Gmail, and Slack for resolutions and superseded commitments. Topics ask users to confirm status; missing resolution evidence does not prove that work remains open. Long histories select useful candidates across bounded chronological history partitions, merge them into at most eight topics, then check all source sections for resolutions and explicit reopenings in original evidence order. Topic prioritization is intentional, not lossless evidence extraction, and processing limits fail without returning a partial draft.
- A past **Meeting** can supply **Calendar invitee** email context through a confirmed Calendar link or a unique, meaningful timed overlap; inferred overlap does not confirm attendance or identify a **Meeting speaker**, and ambiguous overlaps remain unresolved until the user chooses a Calendar event.
- A confirmed Calendar link takes precedence over inferred overlap, and explicitly unlinking a **Meeting** disables automatic Calendar matching for its **Agenda draft** context.

## Example dialogue

> **Dev:** "Does connecting Google change recording behavior?"
> **Domain expert:** "No. Calendar access is read-only and recording remains user-initiated."

## Flagged ambiguities

No durable domain ambiguities are currently unresolved.
