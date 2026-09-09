import assert from 'node:assert/strict'
import { test } from 'node:test'
// @ts-expect-error Node test runner requires explicit TypeScript extension.
import { agendaErrorMessage } from '../shared/agenda-error.ts'

test('agenda errors retain cause without Electron wrappers, Cobra help or stack', () => {
  assert.equal(agendaErrorMessage(new Error("Error invoking remote method 'googleCalendar:generateAgenda': Error: Error: agenda: history exceeds processing limit; use shorter Meetings\nUsage:\n  gappd agenda\nFlags:\n--help")), 'agenda: history exceeds processing limit; use shorter Meetings')
  assert.equal(agendaErrorMessage('Error: provider unavailable\n    at run (app.js:1:2)'), 'provider unavailable')
  assert.equal(agendaErrorMessage('context deadline exceeded'), 'Agenda generation timed out. Try again or use fewer matched Meetings. No draft was generated.')
})
