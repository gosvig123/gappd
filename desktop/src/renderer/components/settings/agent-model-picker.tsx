import { useState } from 'react'
import type { AgentModelCatalog } from '../../../shared/ipc-contract'
import { agentEffortChoices, agentModelChoices } from '../../../shared/agent-models'
import { cx } from '../ui'

const SHORT_LIST = 3

type Props = {
  catalog: AgentModelCatalog
  model: string
  effort: string
  savedModel: string
  savedEffort: string
  disabled: boolean
  onModelChange: (model: string) => void
  onEffortChange: (effort: string) => void
}

/** Model list and reasoning-effort scale from an installed agent's model catalog. */
export function AgentModelPicker({ catalog, model, effort, savedModel, savedEffort, disabled, onModelChange, onEffortChange }: Props) {
  const [showAll, setShowAll] = useState(false)
  const choices = agentModelChoices(catalog, savedModel)
  const shown = showAll ? choices : choices.filter((choice, index) => index < SHORT_LIST || choice.value === model)
  const efforts = agentEffortChoices(catalog, model, savedEffort)
  const modelDefault = catalog.models.find((option) => option.id === model)?.defaultReasoningEffort
  return (
    <>
      <div className="notes-field">
        <p className="notes-field-label" id="agent-model-label">Model</p>
        <div className="notes-models" role="radiogroup" aria-labelledby="agent-model-label">
          {shown.map((choice) => {
            const option = catalog.models.find((item) => item.id === choice.value)
            return (
              <button key={choice.value} type="button" role="radio" aria-checked={choice.value === model} disabled={disabled}
                className={cx('notes-model', choice.value === model && 'selected', !choice.available && 'unavailable')}
                onClick={() => onModelChange(choice.value)}>
                <span className="notes-radio" aria-hidden="true" />
                <span className="notes-model-name"><strong>{option?.displayName || choice.value}</strong> <code>{choice.value}</code></span>
                {!choice.available ? <span className="status-pill error">Not available</span> : choice.value === catalog.defaultModel ? <span className="status-pill notes-accent-pill">Default</span> : null}
              </button>
            )
          })}
          {choices.length > SHORT_LIST ? <button type="button" className="notes-link" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${choices.length} models`}</button> : null}
        </div>
      </div>
      {efforts.length ? (
        <div className="notes-field">
          <p className="notes-field-label" id="agent-effort-label">Reasoning effort</p>
          <div className="notes-effort" role="radiogroup" aria-labelledby="agent-effort-label" style={{ gridTemplateColumns: `repeat(${efforts.length}, minmax(0, 1fr))` }}>
            {efforts.map((value, index) => (
              <button key={value} type="button" role="radio" aria-checked={value === effort} disabled={disabled}
                className={cx('notes-effort-step', value === effort && 'selected', value === modelDefault && 'model-default')}
                onClick={() => onEffortChange(value)}>
                <span className="notes-effort-bars" aria-hidden="true">{efforts.map((step, bar) => <i key={step} className={cx(bar <= index && 'filled')} style={{ height: `${4 + bar * 2}px` }} />)}</span>
                {value}
              </button>
            ))}
          </div>
          <div className="notes-effort-scale"><span>Faster</span><span>• model default</span><span>More thorough</span></div>
        </div>
      ) : null}
    </>
  )
}
