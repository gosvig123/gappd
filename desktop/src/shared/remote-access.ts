/**
 * Remote access lets AI services outside this Mac read Meetings through Gappd Cloud, which passes
 * each request to this Mac and stores nothing.
 *
 * off: the user has not turned it on. signed-out: it is on, but no Gappd account is signed in.
 * connecting / connected / offline: the state of the connection to Gappd Cloud. replaced: another
 * Mac with the same account connected later, so this Mac stopped until the user turns it on again.
 */
export type RemoteAccessState = 'off' | 'signed-out' | 'connecting' | 'connected' | 'offline' | 'replaced'

/** address is the MCP URL that the user adds to an AI service. */
export type RemoteAccessStatus = { enabled: boolean; state: RemoteAccessState; address: string }
