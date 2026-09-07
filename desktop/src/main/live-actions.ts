import type { LiveActionsResponse } from '../shared/generated/live-actions'
import { RECORDING_STATUS_RECORDING } from '../shared/meeting-recording-workflow'
import { requestCommand } from './app-protocol'
import { pauseDrains, resumeDrains } from './drain-coordinator'
import { createLiveActionsRequests } from './live-actions-request'
import { getRecordingState, onRecordingStateChange } from './state'
import { usingSummaryRuntime } from './summary-runtime'

const requests = createLiveActionsRequests<LiveActionsResponse>({ recording, generate: generateDraft })
onRecordingStateChange(() => requests.cancelStale())

function recording(id: string): boolean {
  const state = getRecordingState()
  return state.status === RECORDING_STATUS_RECORDING && state.meetingId === id
}

async function generateDraft(id: string, signal: AbortSignal): Promise<LiveActionsResponse> {
  await pauseDrains('live-actions')
  try {
    signal.throwIfAborted()
    const { meeting } = await requestCommand('meetings.show', { id }, {}, signal)
    if (!meeting.segments.some((segment) => segment.text.trim())) throw new Error('Live Transcript text is not available yet.')
    return await usingSummaryRuntime(async (env) => {
      signal.throwIfAborted()
      return requestCommand('meetings.generateLiveActions', { id }, env, signal)
    }, true)
  } finally { resumeDrains('live-actions') }
}

export const generateLiveActions = requests.generate
export const liveActionsGenerating = requests.generating
export const liveActionsRevision = requests.revision
