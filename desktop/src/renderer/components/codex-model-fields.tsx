import type { CodexModelCatalog } from '../../shared/ipc-contract'
import { codexEffortChoices, codexModelChoices, codexSelectionIsUnavailable } from '../../shared/codex-models'
import type { CodexCatalogState } from '../hooks/use-codex-catalog'
import { Button } from './ui'

type Props = {
  catalog: CodexCatalogState
  model: string
  effort: string
  disabled: boolean
  savedModel: string
  savedEffort: string
  onModelChange: (model: string) => void
  onEffortChange: (effort: string) => void
}

export function CodexModelFields({ catalog, model, effort, disabled, savedModel, savedEffort, onModelChange, onEffortChange }: Props) {
  return (
    <>
      <div className="metric-card">
        <label className="label" htmlFor="codex-model">Model</label>
        <select id="codex-model" className="settings-select" value={model} disabled={disabled || catalog.loading} onChange={(event) => onModelChange(event.target.value)}>
          <ModelOptions catalog={catalog.catalog} savedModel={savedModel} model={model} />
        </select>
      </div>
      <div className="metric-card">
        <label className="label" htmlFor="codex-reasoning-effort">Reasoning effort</label>
        <select id="codex-reasoning-effort" className="settings-select" value={effort} disabled={disabled || catalog.loading} onChange={(event) => onEffortChange(event.target.value)}>
          {codexEffortChoices(catalog.catalog, model, savedEffort).map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>
    </>
  )
}

function ModelOptions({ catalog, savedModel, model }: { catalog: CodexModelCatalog | null; savedModel: string; model: string }) {
  const choices = codexModelChoices(catalog, savedModel)
  if (!choices.length) return <option value={model}>{model || 'Loading models…'}</option>
  return <>{choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</>
}

export function CodexModelStatus({ catalog, model, executable }: { catalog: CodexCatalogState; model: string; executable: string }) {
  if (!executable.trim()) return <div className="status-note">Enter the Codex executable path to load the installed models.</div>
  if (catalog.loading) return <div className="status-note">Loading installed Codex models…</div>
  if (catalog.error) return <div className="status-note danger">{catalog.error} <Button className="compact-action" onClick={catalog.refresh}>Retry</Button></div>
  if (codexSelectionIsUnavailable(catalog.catalog, model)) return <div className="status-note danger">The saved model {model} is not in the installed Codex model catalog. Choose an available model. <Button className="compact-action" onClick={catalog.refresh}>Refresh</Button></div>
  return <div className="status-note">Applies to every Gappd AI operation that uses Installed Codex. The default is {catalog.catalog?.defaultModel ?? 'gpt-5.6-terra'} with {catalog.catalog?.defaultReasoningEffort ?? 'medium'} reasoning effort. <Button className="compact-action" onClick={catalog.refresh}>Refresh</Button></div>
}
