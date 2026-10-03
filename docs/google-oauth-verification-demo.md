# Google Calendar OAuth verification demo

## Status

Google approved `calendar.events.owned.readonly` for `gappd-production` on 30 September 2026 ([approval email](https://mail.google.com/mail/u/?authuser=leasemobil%40gmail.com#all/1a0f338b636dab66)). On 1 October 2026 the Verification Center showed branding and data access as verified, publishing status **In production**, and the declared scopes as `openid`, `userinfo.email`, and `calendar.events.owned.readonly`, with no restricted scope. These match `GOOGLE_SCOPES` in `desktop/src/main/google-calendar-api.ts`.

- The 100-user cap no longer applies to Calendar-only consent. It still applies to any unapproved scope.
- A change to branding, domains, privacy URL, or scopes requires a new verification request. Approval is not inherited by new scopes.
- `gmail.readonly` is restricted and not approved. Keep the Gmail option blocked in release builds until it has its own verification; see [Gmail verification](google-gmail-verification.md).

The rest of this document records how the approved demo was prepared. Reuse it for a future scope request.

## Original review request

The [September 5 verification email](https://mail.google.com/mail/u/?authuser=leasemobil%40gmail.com#all/1a0706249e1227c9) says the previous video did not show why `calendar.events.owned.readonly` is needed or why narrower access is insufficient. Reply to that thread after the replacement video and factual AI-processing answers are ready. At that time Calendar data access was still under review, and beta users could see Google's unverified-app warning.

## Prepare

- Use a clean macOS test profile and a Google test account with a primary calendar. Keep real Meetings and emails out of the recording. Create one upcoming event with a harmless title, time, and two test invitees. Do not create a second Calendar OAuth client or alter the submitted scopes.
- Use an isolated development profile with the same Calendar flow as the signed beta app, not the owner's existing app data. Confirm the Google OAuth desktop client points to the submitted `gappd-production` project. Ensure the consent screen language is **English**.
- Use **Local AI** for the demo. Do not connect Gmail or Cloud sync: Gmail is a separate restricted scope and Cloud sync is not needed to prove Calendar access. Close unrelated windows and notifications.
- Run `bash scripts/record-calendar-verification.sh 240` from the project root. The script starts a screen recording after five seconds; the user performs browser sign-in and consent. It never enters a password or clicks consent.

## Recording sequence

1. Show Gappd's name, Settings → Connections → Google Calendar, and the disclosure before connecting. Explain that recording and local Meeting history work without this connection.
2. Click **Connect Google Calendar**. Show the system browser and the *complete* Google consent screen with `See the events on Google calendars you own` visible. The user completes sign-in and grants access; do not show a password or a callback URL containing a code.
3. Return to Gappd. Show the connected account and the test event's **title and start time** in Today or Upcoming events. If a harmless test Meeting is already available, link it to the event under **People in this meeting**, show the invitee suggestions there, and show its Agenda tab. Do not claim the event list itself shows invitees. Do not imply Calendar starts recording or confirms who spoke.
4. Narrate the minimum scope: `calendar.events.freebusy` gives availability only, not the event title or invitees needed for the displayed features; `calendar.events.readonly` covers all calendars the user can access, which is broader; `calendar.events.owned.readonly` reads owned events without edit or delete rights. Gappd queries only the connected account's primary calendar.
5. If time permits, show Disconnect and the removed Calendar cache, while the Meeting remains. End recording before visiting private accounts or app data.

Review and trim the file before uploading. Make the YouTube video unlisted or use an accessible Drive link, check it in a signed-out browser, and put that link in the existing verification email thread. Keep the original unredacted recording private.

## Reply facts to verify with the owner

The email also requests AI provider names, account plan tiers, gateways/downstream endpoints, training controls, and privacy-policy coverage of offline models. The code offers on-device Local AI and optional Installed Codex via the user's own Codex executable/account. The personal browser showed a **ChatGPT Pro** account on 27 September 2026; Codex Data controls said **model improvement enabled** and **Include environments off**. This does not prove the installed CLI uses that same account. **Do not assert that remote processing disables model training** until the owner disables Improve the model for everyone, verifies the setting and the CLI account, and confirms the relevant provider terms. Gappd does not enforce the account's plan, controls, or downstream endpoints. The staged privacy policy describes both paths; confirm the live policy before replying. The submitted Calendar permission is read-only; no write/delete Calendar scope is requested. Reply directly to the existing thread after those facts and the video are checked by the owner.
