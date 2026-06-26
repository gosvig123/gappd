import type { ReactNode } from 'react'
import type { RecordingStatus, UpdateStatus } from '../../shared/contracts'
import { Banner, Button, ProgressBar } from './ui'

type UpdateBannerProps = {
  status: UpdateStatus | null
  recordingStatus: RecordingStatus
  onDownload: () => void
  onInstall: () => void
  onOpenReleasePage: () => void
  onCheckNow: () => void
}

type BannerModel = { title: string; detail: ReactNode; tone?: 'error' | 'info'; progress?: number | null }

export function UpdateBanner(props: UpdateBannerProps) {
  const model = bannerModel(props.status, props.recordingStatus)
  if (!model || !props.status) return null
  return <Banner tone={model.tone} title={model.title} actions={bannerActions(props)}>{model.detail}{model.progress !== undefined ? <ProgressBar value={model.progress} label="Update download progress" /> : null}</Banner>
}

function bannerModel(status: UpdateStatus | null, recordingStatus: RecordingStatus): BannerModel | null {
  if (!status) return null
  const version = versionLabel(status)
  if (status.phase === 'downloaded') return downloadedModel(version, recordingStatus)
  if (status.phase === 'downloading') return { title: 'Downloading update', detail: `${version} is downloading in the background.`, progress: status.progress ?? null }
  if (status.phase === 'available') return { title: 'Update available', detail: `${version} is ready to download. You can keep using Gappd.` }
  if (status.phase === 'error') return { title: 'Update failed', detail: status.error, tone: 'error' }
  return null
}

function downloadedModel(version: string, recordingStatus: RecordingStatus): BannerModel {
  if (recordingStatus !== 'idle') return { title: 'Update ready after recording', detail: `${version} will install after you finish the current recording.` }
  return { title: 'Update ready', detail: `${version} is downloaded. Restart Gappd to install it.` }
}

function bannerActions(props: UpdateBannerProps): ReactNode {
  if (props.status?.phase === 'downloaded') return downloadedActions(props)
  if (props.status?.phase === 'available') return <><Button variant="primary" onClick={props.onDownload}>Download update</Button><Button onClick={props.onOpenReleasePage}>Release notes</Button></>
  if (props.status?.phase === 'error') return <><Button variant="primary" onClick={props.onCheckNow}>Check again</Button><Button onClick={props.onOpenReleasePage}>Download manually</Button></>
  return null
}

function downloadedActions(props: UpdateBannerProps): ReactNode {
  const blocked = props.recordingStatus !== 'idle'
  return <><Button variant="primary" onClick={props.onInstall} disabled={blocked}>Restart to update</Button><Button onClick={props.onOpenReleasePage}>Release notes</Button></>
}

function versionLabel(status: UpdateStatus): string {
  return status.latestVersion ? `Gappd v${status.latestVersion}` : 'Gappd update'
}
