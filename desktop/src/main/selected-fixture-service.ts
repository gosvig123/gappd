import { app } from 'electron'
import { demoAuthorization } from './demo-upload-service'
import { selectedFixtureProfile } from './selected-fixture-profile'
import { exportSelectedFixture } from './selected-fixture-export'
import { SelectedFixtureUpload } from './selected-fixture-upload'

let instance: SelectedFixtureUpload | null = null
export function selectedFixtureUpload(): SelectedFixtureUpload {
  instance ||= new SelectedFixtureUpload(demoAuthorization(), exportSelectedFixture,
    !app.isPackaged && process.env.GAPPD_SYNTHETIC_UPLOAD_ENABLED === 'true' && Boolean(selectedFixtureProfile()),
    'https://gappd-cloud-api-production.up.railway.app/mcp')
  return instance
}
