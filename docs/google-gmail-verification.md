# Google Gmail verification

Gmail read access (`https://www.googleapis.com/auth/gmail.readonly`) is a restricted scope and is not approved for `gappd-production`. Calendar was approved separately on 30 September 2026 ([Calendar demo](google-oauth-verification-demo.md)). Google requires a new verification request for each new scope.

On 6 October 2026 Google asked for an ADA-CASA AL1 security assessment by 3 January 2027 ([email](https://mail.google.com/mail/u/?authuser=leasemobil%40gmail.com#all/1a0706249e1227c9)). Google requires it when an app with restricted scopes "has the ability to access data from or through a third-party server". The former OAuth relay saw refresh tokens with the client secret, so it had that ability. Desktop builds now exchange and refresh tokens directly with Google. After that release ships, reply in the thread that no Gappd server can access Gmail data or tokens and ask Google to confirm that no assessment is needed. If Google still requires it, start AL1 by mid-November; it takes 2 to 6 weeks.

## Current gate

Release builds cannot request Gmail. `gmailReviewEnabled()` in `desktop/src/main/google-calendar-service.ts` enables Gmail only in an unpackaged development run with `GAPPD_GMAIL_REVIEW=1`. This follows Google's rule to trigger unverified scopes only outside production traffic. Each Gmail consent before approval shows Google's unverified-app screen and uses one place of the 100-user cap (2 used on 1 October 2026).

## Data path to state in the request

- Gmail is read only when the user requests an Agenda draft or Meeting enrichment: messages from, to, or copying the Meeting's Calendar invitees, up to 30 messages, plain-text bodies only, no attachments or HTML-only mail (`desktop/src/main/gmail-agenda.ts`).
- Local AI (on-device llama.cpp) processes it. `newCalendarAIProvider` rejects Installed Codex (`cmd/gappd/app_agenda.go`). Agenda drafts and enrichment notes are stored encrypted on the Mac.
- Cloud sync uploads only Meeting title, summary, speakers, and turns (`internal/meetingdocument/document.go`). Enrichment notes do not change the summary.
- The desktop app exchanges and refreshes Google tokens directly with `oauth2.googleapis.com` (`desktop/src/main/oauth.ts`). Tokens are stored encrypted on the Mac. No Gappd server receives Google tokens or Gmail content. Desktop builds before 6 October 2026 used an OAuth relay on Railway (`auth.getgappd.com`) that added the client secret.

## Prepare

- Use a dedicated Google test account. It must have a primary calendar with one upcoming event and two test invitees, and a few plain-text emails exchanged with those invitees in the last 30 days. Keep real mail out of the recording.
- In Cloud Console → Google Auth Platform → Data Access, add `gmail.readonly` and save, but do not submit yet. Do not change branding or other scopes.
- Build and start an isolated development profile, as described in `AGENTS.md`, with `GAPPD_GMAIL_REVIEW=1`, `GAPPD_GOOGLE_OAUTH_CLIENT_ID` set to the production desktop client (`gh variable get GAPPD_GOOGLE_OAUTH_CLIENT_ID`), and `GAPPD_GOOGLE_OAUTH_CLIENT_SECRET` set to its secret. A selected-fixture profile shows a fictional Calendar day, so a recording that needs the real account must use a different isolated profile. Select Local AI and let the model finish downloading before recording.
- Create a synthetic Meeting that has an `Action items` section, linked to the test event. Label it as synthetic.
- Record with `bash scripts/record-calendar-verification.sh 300 ~/Desktop/gappd-gmail-verification.mov`. The user signs in and grants consent; never record a password or a callback URL with a code.

## Recording sequence

1. Settings → Connections. Show the Gmail disclosure and click **Connect with Gmail read access**.
2. Show the unverified-app screen (Google expects this in the video), then the complete consent screen listing Gmail read access and Calendar. Grant access.
3. Back in Gappd, show the account with "Gmail read access on".
4. Open the linked Meeting. Generate an Agenda draft and show the Gmail-sourced items with their citations. Open the cited message in the test Gmail web inbox to show it is the same message, unchanged and still in place.
5. Run **Add Gmail and Slack context** and show the enrichment notes on existing action items.
6. Switch the AI provider to Installed Codex and repeat step 4 to show the rejection: "Google Calendar context stays on this Mac; select Local AI…". Switch back.
7. Narrate the scope choice: `gmail.metadata` gives headers without bodies, but the features need message text; `gmail.readonly` is the narrowest scope that reads bodies, and it cannot send, delete, label, or change read state.
8. Disconnect the account and show that access is revoked in the Google Account's third-party connections page.

Lessons from the 1 October 2026 recording:

- Google skips the consent screen when the account already granted these scopes to the client. Disconnect in Gappd first (this revokes the grant, including the installed app's Calendar connection), then connect again.
- The fixture's isolated home has no Codex login, so Settings cannot save Installed Codex. For step 6, set `provider = "codex_exec"` in the fixture's `config.toml`; the refusal happens before Codex is called.
- Enrichment links a Meeting to one overlapping Calendar event. Give the synthetic Meeting the test event's time.

Trim personal data. Upload to Google Drive with "Anyone with the link can view", or as unlisted YouTube, and check playback in a signed-out browser. Google refused a downloadable GitHub release file for the Calendar review.

## Submit

In Data Access, paste the justification below, add the video link, and submit. Reply to Google's follow-up thread only with facts that have been checked.

> Gappd is a macOS meeting notes app. With optional Gmail read access, when the user requests an Agenda draft or Meeting enrichment for a Calendar event, Gappd reads up to 30 recent plain-text messages exchanged with that event's invitees and uses them to prepare agenda items and add context to existing action items, with citations. Processing runs only on the user's Mac with an on-device llama.cpp model; Gmail content is never sent to a remote AI provider, to Gappd's servers, or to the operator, and is not used for training. gmail.metadata cannot provide message text; gmail.readonly is the narrowest scope that can, and Gappd never sends, deletes, labels, or modifies mail. The app exchanges and refreshes OAuth tokens directly with Google and stores them encrypted on the Mac; no Gappd server receives Google tokens or Gmail content. Privacy policy: https://getgappd.com/privacy/
