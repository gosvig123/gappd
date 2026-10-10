# Agenda communication context

Implemented scope: optional Gmail read access, existing Slack DMs with Calendar invitees, and explicitly selected joined Slack channels. Use the configured AI provider; never send messages.

## 1. Read authorization

Keep Calendar-only access working. Offer optional Gmail read authorization on the Calendar connection. Extend Slack user permissions for invitee email lookup and conversation history. Tokens stay in encrypted main-process stores. Existing connections need consent for new permissions.

Acceptance: Calendar-only connections do not read Gmail; expired tokens refresh safely; missing permissions explain how to reconnect.

## 2. Communication retrieval

Use a bounded recent window before the event/current time. Query Gmail communication with invitees. Read only existing invitee DMs and explicitly selected joined Slack channels, including replies to retrieved threads. Do not join channels, open DMs, mark messages read, fetch attachments, or search the entire workspace. Surface incomplete coverage and rate limits.

Acceptance: fixture HTTP requests prove account isolation, scope limits, pagination, reply handling, and safe failures. Slack's non-Marketplace history/replies limits can be one request per minute, 15 messages per page; do not promise exhaustive retrieval.

## 3. Agenda evidence

Combine Meeting history and communication evidence through the existing AI-provider route, including when no Meeting matches. Keep exact-quote validation and chronological resolution checks. Saved drafts retain source labels and types, not entire message bodies. Explain provider data use before generation.

Acceptance: both configured provider paths receive the same evidence; email/Slack citations survive saving and never open a nonexistent Meeting. Run relevant tests/builds and exercise the UI before commit/push.

## Deployment prerequisites

Gmail API must be enabled for the Google project. `gmail.readonly` is restricted; Google verification and any applicable security assessment for transmission to a remote AI provider are deployment requirements. Slack app permissions must match the shipped manifest, and users must reconnect.

## Implemented limits

The event's Google account supplies Gmail messages addressed from/to/cc/bcc the invitees. Gmail reads plain-text MIME bodies only; HTML-only mail and attachments are excluded with a coverage warning. Slack accepts up to three selected channel IDs, discovers existing invitee DMs, and reads up to eight conversations and twelve retrieved threads. Each Slack history/replies call requests 15 messages. Only the 16 newest messages per service reach the model, with a warning when candidates were dropped. Previous Meetings keep their existing 12-source limit. Processing capacity errors do not overwrite a saved draft.

## Validation

- All Go tests/builds and generated protocol checks passed.
- 385 desktop tests, TypeScript checking, and Electron/renderer builds passed.
- An independent API validator used isolated real HTTP requests and identified a nameless text-attachment gap; the filter and regression test now exclude MIME attachment dispositions.
- An actual gappd process accepted communication over stdin, called an isolated HTTP model endpoint with the configured model, and returned a validated source quote.
- The built Electron app ran in a separate synthetic profile. UI actions verified Gmail/Slack citations, topic autosave through IPC, channel validation without overwriting saved work, and permission disclosures. No production credentials or live communication services were used.

Sources checked: [Google Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [Slack conversations.history](https://docs.slack.dev/reference/methods/conversations.history), and [Slack conversations.replies](https://docs.slack.dev/reference/methods/conversations.replies).
