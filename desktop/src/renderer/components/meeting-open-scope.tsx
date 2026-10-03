import { createContext, useContext, type ReactNode } from 'react'

export type MeetingTab = 'summary' | 'agenda' | 'transcript'

/** Opens a Meeting, optionally focused on one tab. */
export type OpenMeeting = (meetingId: string, tab?: MeetingTab) => void

const OpenMeetingContext = createContext<OpenMeeting | null>(null)

/**
 * Lets a preview-line chip land straight on the Agenda tab without threading a
 * prop through every section that can open a Meeting.
 */
export function OpenMeetingScope({ open, children }: { open: OpenMeeting; children: ReactNode }) {
  return <OpenMeetingContext.Provider value={open}>{children}</OpenMeetingContext.Provider>
}

export function useOpenMeeting(fallback: OpenMeeting): OpenMeeting {
  return useContext(OpenMeetingContext) ?? fallback
}
