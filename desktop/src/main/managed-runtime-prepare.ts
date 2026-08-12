import type { ManagedRuntimePullStage, ManagedRuntimeSnapshot } from '../shared/managed-runtime'
import { ensureAppleSpeechAsset } from './apple-speech'
import { ensureManagedLanguageModel } from './language-model'

export type PrepareProgress = { progress?: number; message?: string; pullStage?: ManagedRuntimePullStage }
type PrepareHooks = {
  current(): boolean
  stage(message: string, extra?: Partial<ManagedRuntimeSnapshot>): boolean
  progress(fallback: string, progress: PrepareProgress): void
}

export async function prepareManagedAssets(model: string, hooks: PrepareHooks): Promise<boolean> {
  if (!hooks.stage(`Downloading meeting model ${model}`, { pullStage: 'preparing' })) return false
  await ensureManagedLanguageModel((progress) => hooks.progress(`Downloading meeting model ${model}`, progress))
  if (!hooks.current()) return false
  if (!hooks.stage('Preparing Apple speech model', { model, pullStage: 'preparing', progress: undefined })) return false
  await ensureAppleSpeechAsset((progress) => hooks.progress('Downloading Apple speech model', progress))
  return hooks.current()
}
