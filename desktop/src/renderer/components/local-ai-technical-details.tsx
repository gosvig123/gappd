type LocalAITechnicalDetailsProps = {
  detail?: string
}

const SHOW_TECHNICAL_DETAILS = import.meta.env.DEV

export function LocalAITechnicalDetails({ detail }: LocalAITechnicalDetailsProps) {
  if (!SHOW_TECHNICAL_DETAILS || !detail) return null
  return (
    <details className="technical-details">
      <summary>Technical details</summary>
      <pre>{detail}</pre>
    </details>
  )
}
