import { execFile } from 'node:child_process'
import { resolveGappdBinary } from './native-runtime'
import { selectedFixtureBackendEnv, selectedFixtureProfile } from './selected-fixture-profile'
import { SELECTED_FIXTURE_BYTES, SELECTED_FIXTURE_ID } from '../shared/selected-fixture-contract'

export async function exportSelectedFixture(id: string): Promise<string> {
  if (id !== SELECTED_FIXTURE_ID || !selectedFixtureProfile()) throw new Error('Selected fixture required.')
  const bytes = await new Promise<string>((resolve, reject) => {
    execFile(resolveGappdBinary(), ['selected-fixture', 'export', id], {
      env: { ...process.env, ...selectedFixtureBackendEnv() }, timeout: 5000, maxBuffer: 4096, encoding: 'utf8',
    }, (error, stdout) => error ? reject(new Error('Selected fixture unavailable.')) : resolve(stdout))
  })
  if (bytes !== SELECTED_FIXTURE_BYTES) throw new Error('Selected fixture changed.')
  return bytes
}
