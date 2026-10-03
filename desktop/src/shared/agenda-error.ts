export function agendaErrorMessage(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  const message = raw.replace(/^Error invoking (?:remote method )?['"]?googleCalendar:generateAgenda['"]?:\s*/, '')
    .replace(/^(?:Error:\s*)+/, '').split(/\n(?:Usage:|Flags:|Global Flags:|\s+at\s)/)[0].trim()
  if (/context deadline exceeded|operation was aborted|timed out/i.test(message)) return 'Agenda generation timed out. Try again or use fewer matched Meetings. No draft was generated.'
  return message || 'Agenda generation failed. Check your AI model in Settings, then retry.'
}
