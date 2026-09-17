import type { CodexModelCatalog, CodexModelOption } from './ipc-contract'

export const UNAVAILABLE_MODEL_SUFFIX = ' (unavailable)'

export type CodexModelChoice = { value: string; label: string; available: boolean }

/** Model choices keep a stale saved model visible instead of silently replacing it. */
export function codexModelChoices(catalog: CodexModelCatalog | null, savedModel: string): CodexModelChoice[] {
  const choices = (catalog?.models ?? []).map((model) => ({ value: model.id, label: modelLabel(model), available: true }))
  if (savedModel && !choices.some((choice) => choice.value === savedModel)) {
    choices.unshift({ value: savedModel, label: savedModel + UNAVAILABLE_MODEL_SUFFIX, available: false })
  }
  return choices
}

/** Effort choices come from the selected model; an unsupported saved effort stays visible. */
export function codexEffortChoices(catalog: CodexModelCatalog | null, model: string, savedEffort: string): string[] {
  const supported = codexModel(catalog, model)?.reasoningEfforts ?? []
  if (savedEffort && !supported.includes(savedEffort)) return [savedEffort, ...supported]
  return supported
}

export function codexSelectionIsValid(catalog: CodexModelCatalog | null, model: string, effort: string): boolean {
  const selected = codexModel(catalog, model)
  return Boolean(selected && effort && selected.reasoningEfforts.includes(effort))
}

export function codexSelectionIsUnavailable(catalog: CodexModelCatalog | null, model: string): boolean {
  return Boolean(model && !codexModel(catalog, model))
}

/** The default selection used when nothing explicit was saved. */
export function defaultCodexSelection(catalog: CodexModelCatalog | null): { model: string; effort: string } {
  return { model: catalog?.defaultModel ?? '', effort: catalog?.defaultReasoningEffort ?? '' }
}

/** Catalog default effort for one model, used when the model changes. */
export function defaultEffortForModel(catalog: CodexModelCatalog | null, model: string): string {
  return codexModel(catalog, model)?.defaultReasoningEffort ?? ''
}

export function codexModel(catalog: CodexModelCatalog | null, model: string): CodexModelOption | null {
  return catalog?.models.find((option) => option.id === model) ?? null
}

function modelLabel(model: CodexModelOption): string {
  return model.displayName && model.displayName !== model.id ? `${model.displayName} (${model.id})` : model.id
}
