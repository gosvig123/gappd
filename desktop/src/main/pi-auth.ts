import { randomUUID } from 'node:crypto'
import { shell, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { IPC_EVENTS, type AIProviderStatus, type PiAuthAnswer, type PiAuthEvent, type PiAuthPrompt, type PiConfigurationInput } from '../shared/ipc-contract'
import { piRuntime } from './pi-runtime'

type Interaction = Parameters<typeof piRuntime.configureOAuth>[1]
type ProviderPrompt = Parameters<Interaction['prompt']>[0]
type ProviderNotice = Parameters<Interaction['notify']>[0]
type PendingPrompt = { senderId: number; sessionId: string; resolve(value: string): void; reject(error: Error): void }
type AuthSession = { id: string; controller: AbortController }
const pending = new Map<string, PendingPrompt>()
const sessions = new Map<number, AuthSession>()

export async function configurePiOAuth(event: IpcMainInvokeEvent, input: PiConfigurationInput): Promise<AIProviderStatus> {
  cancelSender(event.sender.id)
  const controller = new AbortController()
  const sessionId = randomUUID()
  const destroyed = () => cancelSender(event.sender.id)
  sessions.set(event.sender.id, { id: sessionId, controller })
  event.sender.once('destroyed', destroyed)
  const interaction: Interaction = {
    signal: controller.signal,
    prompt: (prompt) => askRenderer(event.sender, prompt, sessionId),
    notify: (notice) => { void notifyRenderer(event.sender, notice, sessionId).catch(() => controller.abort()) },
  }
  try { return await piRuntime.configureOAuth(input, interaction) }
  finally {
    event.sender.off('destroyed', destroyed)
    if (sessions.get(event.sender.id)?.controller === controller) sessions.delete(event.sender.id)
    rejectPrompts(event.sender.id, 'Sign-in ended', sessionId)
  }
}

export function cancelPiAuth(event: IpcMainInvokeEvent): void {
  cancelSender(event.sender.id)
}

export function answerPiAuth(event: IpcMainInvokeEvent, answer: PiAuthAnswer): void {
  const prompt = pending.get(answer.id)
  if (!prompt || prompt.senderId !== event.sender.id) return
  pending.delete(answer.id)
  if (answer.cancelled || answer.value === undefined) return prompt.reject(new Error('Sign-in cancelled'))
  prompt.resolve(answer.value)
}

function askRenderer(sender: WebContents, prompt: ProviderPrompt, sessionId: string): Promise<string> {
  if (!activeSession(sender, sessionId)) return Promise.reject(new Error('Sign-in cancelled'))
  const id = randomUUID()
  const payload: PiAuthPrompt = { id, type: prompt.type, message: prompt.message, ...('placeholder' in prompt ? { placeholder: prompt.placeholder } : {}), ...('options' in prompt ? { options: prompt.options } : {}) }
  return new Promise((resolve, reject) => {
    pending.set(id, { senderId: sender.id, sessionId, resolve, reject })
    prompt.signal?.addEventListener('abort', () => answerPiAuthAbort(id), { once: true })
    sender.send(IPC_EVENTS.aiProvider.auth, { type: 'prompt', prompt: payload } satisfies PiAuthEvent)
  })
}

function cancelSender(senderId: number): void {
  sessions.get(senderId)?.controller.abort()
  sessions.delete(senderId)
  rejectPrompts(senderId, 'Sign-in cancelled')
}

function rejectPrompts(senderId: number, message: string, sessionId?: string): void {
  for (const [id, prompt] of pending) {
    if (prompt.senderId !== senderId || (sessionId && prompt.sessionId !== sessionId)) continue
    pending.delete(id)
    prompt.reject(new Error(message))
  }
}

function answerPiAuthAbort(id: string): void {
  const prompt = pending.get(id)
  if (!prompt) return
  pending.delete(id)
  prompt.reject(new Error('Sign-in prompt expired'))
}

async function notifyRenderer(sender: WebContents, notice: ProviderNotice, sessionId: string): Promise<void> {
  if (!activeSession(sender, sessionId)) return
  const event = noticeEvent(notice)
  sender.send(IPC_EVENTS.aiProvider.auth, event)
  if (notice.type === 'auth_url') await shell.openExternal(notice.url)
  if (notice.type === 'device_code') await shell.openExternal(notice.verificationUri)
}

function activeSession(sender: WebContents, sessionId: string): boolean {
  return !sender.isDestroyed() && sessions.get(sender.id)?.id === sessionId
}

function noticeEvent(notice: ProviderNotice): PiAuthEvent {
  if (notice.type === 'auth_url') return { type: 'notice', message: notice.instructions || 'Finish sign-in in browser.', url: notice.url }
  if (notice.type === 'device_code') return { type: 'notice', message: 'Enter this device code in browser.', url: notice.verificationUri, userCode: notice.userCode }
  return { type: 'notice', message: notice.message }
}
