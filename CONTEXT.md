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

**Google Calendar connection**:
Read-only authorization for one Google account's primary calendar, with independent synchronization, errors, reconnect, and disconnect behavior.

**OAuth relay**:
The isolated `auth.getgappd.com` credential proxy that transiently adds Google's Desktop client secret and does not persist authorization codes, tokens, Calendar data, or meeting data.

## Relationships

- A Gappd identity and a **Google Calendar connection** are separate and neither gates local app features.
- Each **Google Calendar connection** owns its encrypted on-device tokens and Calendar cache.
- Assigning a **Person** to a **Meeting speaker** names their transcript turns and refreshes the meeting's summary.
- A **Meeting** can retain a calendar event snapshot to suggest **Calendar invitees** when labeling speakers.
- Disconnecting one **Google Calendar connection** removes only that account's authorization and Calendar cache; existing **Meetings** remain.
- The renderer receives Calendar snapshots and account operations, never Google tokens or relay private keys.

## Example dialogue

> **Dev:** "Does connecting Google change recording behavior?"
> **Domain expert:** "No. Calendar access is read-only and recording remains user-initiated."

## Flagged ambiguities

No durable domain ambiguities are currently unresolved.
