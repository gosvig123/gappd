import { resolveBinary } from './binaries'

export function resolveCaptureBinary(): string {
  return resolveBinary({
    envVar: 'GAPPD_CAPTURE_HELPER_PATH',
    packaged: ['GappdCapture.app', 'Contents', 'MacOS', 'gappd-capture'],
    dev: ['..', 'build', 'GappdCapture.app', 'Contents', 'MacOS', 'gappd-capture'],
  })
}

export function resolveGappdBinary(): string {
  return resolveBinary({
    envVar: 'GAPPD_BINARY_PATH',
    packaged: ['bin', 'gappd'],
    dev: ['..', 'build', 'gappd'],
  })
}

export function childEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const pathParts = [
    process.env.PATH ?? '',
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ]
  return { ...process.env, PATH: Array.from(new Set(pathParts.filter(Boolean))).join(':'), ...overrides }
}
