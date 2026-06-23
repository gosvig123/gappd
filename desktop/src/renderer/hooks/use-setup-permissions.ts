import { useState } from 'react'
import type { CapturePermissions, CapturePermissionTarget } from '../../shared/ipc-contract'

export type SetupPermissionState = {
  status: 'waiting' | 'checking' | 'granted' | 'blocked' | 'unknown' | 'error'
  permissions?: CapturePermissions
  error?: string
}

const WAITING_PERMISSIONS: SetupPermissionState = { status: 'waiting' }

export function useSetupPermissions(enabled: boolean) {
  const [state, setState] = useState<SetupPermissionState>(WAITING_PERMISSIONS)

  async function request() {
    if (!enabled) return
    setState({ status: 'checking', permissions: state.permissions })
    try {
      setState(permissionState(await window.gappd.system.requestCapturePermissions()))
    } catch (err) {
      setState({ status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  }

  async function openSettings(target?: CapturePermissionTarget) {
    if (!enabled) return
    try {
      const permissions = await window.gappd.system.requestCapturePermissions()
      setState(permissionState(permissions))
      await window.gappd.system.openPermissionsSettings(target ?? permissionTarget(permissions))
    } catch (err) {
      setState({ status: 'error', permissions: state.permissions, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return { state: enabled ? state : WAITING_PERMISSIONS, ready: enabled && state.status === 'granted', request, openSettings }
}

function permissionState(permissions: CapturePermissions): SetupPermissionState {
  if (permissions.microphone === 'granted' && permissions.screen === 'granted') return { status: 'granted', permissions }
  if (isDenied(permissions.microphone) || isDenied(permissions.screen)) return { status: 'blocked', permissions }
  return { status: 'unknown', permissions }
}

function permissionTarget(permissions?: CapturePermissions): CapturePermissionTarget | undefined {
  if (!permissions || permissions.screen !== 'granted') return 'screen-recording'
  if (permissions.microphone !== 'granted') return 'microphone'
  return undefined
}

function isDenied(state: string): boolean {
  const value = state.trim().toLowerCase()
  return value.includes('denied') || value.includes('restricted')
}
