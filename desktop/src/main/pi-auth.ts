import { randomUUID } from 'node:crypto'
import { shell, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { IPC_EVENTS, type AIProviderStatus, type PiAuthAnswer, type PiAuthEvent, type PiAuthPrompt, type PiConfigurationInput } from '../shared/ipc-contract'
import { piRuntime } from './pi-runtime'

type Interaction = Parameters<typeof piRuntime.configureOAuth>[1]
type ProviderPrompt = Parameters<Interaction['prompt']>[0]
type ProviderNotice = Parameters<Interaction['notify']>[0]
type PendingPrompt = { senderId: number; resolve(value: string): void; reject(error: Error): void }
const pending = new Map<string, PendingPrompt>()

export function configurePiOAuth(event: IpcMainInvokeEvent, input: PiConfigurationInput): Promise<AIProviderStatus> {
  const interaction: Interaction = {
    prompt: (prompt) => askRenderer(event.sender, prompt),
    notify: (notice) => { void notifyRenderer(event.sender, notice) },
  }
  return piRuntime.configureOAuth(input, interaction)
}

export function answerPiAuth(event: IpcMainInvokeEvent, answer: PiAuthAnswer): void {
  const prompt = pending.get(answer.id)
  if (!prompt || prompt.senderId !== event.sender.id) return
  pending.delete(answer.id)
  if (answer.cancelled || answer.value === undefined) return prompt.reject(new Error('Sign-in cancelled'))
  prompt.resolve(answer.value)
}

function askRenderer(sender: WebContents, prompt: ProviderPrompt): Promise<string> {
  const id = randomUUID()
  const payload: PiAuthPrompt = { id, type: prompt.type, message: prompt.message, ...('placeholder' in prompt ? { placeholder: prompt.placeholder } : {}), ...('options' in prompt ? { options: prompt.options } : {}) }
  return new Promise((resolve, reject) => {
    pending.set(id, { senderId: sender.id, resolve, reject })
    prompt.signal?.addEventListener('abort', () => answerPiAuthAbort(id), { once: true })
    sender.send(IPC_EVENTS.aiProvider.auth, { type: 'prompt', prompt: payload } satisfies PiAuthEvent)
  })
}

function answerPiAuthAbort(id: string): void {
  const prompt = pending.get(id)
  if (!prompt) return
  pending.delete(id)
  prompt.reject(new Error('Sign-in prompt expired'))
}

async function notifyRenderer(sender: WebContents, notice: ProviderNotice): Promise<void> {
  const event = noticeEvent(notice)
  sender.send(IPC_EVENTS.aiProvider.auth, event)
  if (notice.type === 'auth_url') await shell.openExternal(notice.url)
  if (notice.type === 'device_code') await shell.openExternal(notice.verificationUri)
}

function noticeEvent(notice: ProviderNotice): PiAuthEvent {
  if (notice.type === 'auth_url') return { type: 'notice', message: notice.instructions || 'Finish sign-in in browser.', url: notice.url }
  if (notice.type === 'device_code') return { type: 'notice', message: 'Enter this device code in browser.', url: notice.verificationUri, userCode: notice.userCode }
  return { type: 'notice', message: notice.message }
}
