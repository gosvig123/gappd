import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { AI_APPS, type AIAppId, type AIAppState, type AIAppStatus } from '../shared/ai-apps'
import { findAgents } from './ai-provider'
import { childEnv, resolveGappdBinary } from './native-runtime'
import { selectedFixtureBackendEnv } from './selected-fixture-profile'

// Each AI app runs `gappd mcp` on this Mac; no Gappd cloud connection is needed.
// Claude Code and Codex change their own config through their `mcp` commands; Claude Desktop has
// no command, so Gappd edits its JSON config and keeps every other entry.

const run = promisify(execFile)
const SERVER = 'gappd'
const CLI_TIMEOUT_MS = 20_000

type JsonObject = Record<string, unknown>
type Clis = { claude?: string; codex?: string }

export async function aiAppStatuses(): Promise<AIAppStatus[]> {
  const clis = await findClis()
  return Promise.all(AI_APPS.map(async (app): Promise<AIAppStatus> => {
    // One unreadable config must not hide the other apps.
    try { return { id: app.id, name: app.name, state: await stateOf(app.id, clis) } } catch (error) {
      return { id: app.id, name: app.name, state: 'error', error: error instanceof Error ? error.message : String(error) }
    }
  }))
}

export async function connectAIApp(id: AIAppId): Promise<AIAppStatus[]> {
  const clis = await findClis()
  const server = gappdServer()
  const env = serverEnv(server.env)
  if (id === 'claude_desktop') {
    const config = readJson(claudeDesktopConfig())
    writeJson(claudeDesktopConfig(), { ...config, mcpServers: { ...objectAt(config, 'mcpServers'), [SERVER]: server } })
  } else if (id === 'claude_code') {
    const claude = required(clis.claude, 'Claude Code')
    // `claude mcp add` refuses a name that exists, so an update removes the old entry first.
    const previous = objectAt(readJson(claudeCodeConfig()), 'mcpServers')[SERVER]
    if (previous !== undefined) await cli(claude, ['mcp', 'remove', SERVER, '--scope', 'user'])
    try {
      await cli(claude, ['mcp', 'add', '--scope', 'user', SERVER, ...env.flatMap((pair) => ['-e', pair]), '--', server.command, ...server.args])
    } catch (error) {
      if (previous !== undefined) await cli(claude, ['mcp', 'add-json', '--scope', 'user', SERVER, JSON.stringify(previous)]).catch(() => undefined)
      throw error
    }
  } else {
    const codex = required(clis.codex, 'Codex')
    await cli(codex, ['mcp', 'add', SERVER, ...env.flatMap((pair) => ['--env', pair]), '--', server.command, ...server.args])
  }
  return aiAppStatuses()
}

export async function disconnectAIApp(id: AIAppId): Promise<AIAppStatus[]> {
  const clis = await findClis()
  if (id === 'claude_desktop') {
    const config = readJson(claudeDesktopConfig())
    const { [SERVER]: _removed, ...servers } = objectAt(config, 'mcpServers')
    writeJson(claudeDesktopConfig(), { ...config, mcpServers: servers })
  } else if (id === 'claude_code') {
    await cli(required(clis.claude, 'Claude Code'), ['mcp', 'remove', SERVER, '--scope', 'user'])
  } else {
    await cli(required(clis.codex, 'Codex'), ['mcp', 'remove', SERVER])
  }
  return aiAppStatuses()
}

async function stateOf(id: AIAppId, clis: Clis): Promise<AIAppState> {
  if (id === 'claude_desktop') {
    if (!claudeDesktopInstalled()) return 'missing'
    return serverState(objectAt(readJson(claudeDesktopConfig()), 'mcpServers')[SERVER])
  }
  if (id === 'claude_code') {
    if (!clis.claude) return 'missing'
    return serverState(objectAt(readJson(claudeCodeConfig()), 'mcpServers')[SERVER])
  }
  if (!clis.codex) return 'missing'
  const output = await cli(clis.codex, ['mcp', 'get', SERVER, '--json']).catch((error) => {
    if (error instanceof Error && error.message.includes('No MCP server named')) return null
    throw error
  })
  if (output === null) return 'off'
  return serverState(objectAt(parseJson(output, 'codex mcp get'), 'transport'))
}

function serverState(value: unknown): AIAppState {
  if (value === undefined) return 'off'
  const expected = gappdServer()
  if (!isObject(value) || value.command !== expected.command || !Array.isArray(value.args) || value.args.length !== 1 || value.args[0] !== 'mcp') return 'outdated'
  if (expected.env && objectAt(value, 'env').HOME !== expected.env.HOME) return 'outdated'
  return 'on'
}

async function findClis(): Promise<Clis> {
  const installs = await findAgents()
  const executable = (agent: string) => installs.find((install) => install.agent === agent)?.executable || undefined
  return { claude: executable('claude_code'), codex: executable('codex_exec') }
}

/** The MCP server entry. A fixture session points it at the fixture database, never the real one. */
function gappdServer(): { command: string; args: string[]; env?: Record<string, string> } {
  const home = selectedFixtureBackendEnv().HOME
  return { command: resolveGappdBinary(), args: ['mcp'], ...(home ? { env: { HOME: home } } : {}) }
}

function serverEnv(env: Record<string, string> | undefined): string[] {
  return Object.entries(env ?? {}).map(([key, value]) => `${key}=${value}`)
}

/** The home whose AI app configs change: the fixture's backend home in a fixture session. */
function configHome(): string {
  return selectedFixtureBackendEnv().HOME ?? os.homedir()
}

function claudeCodeConfig(): string {
  const directory = selectedFixtureBackendEnv().HOME ?? process.env.CLAUDE_CONFIG_DIR ?? configHome()
  return path.join(directory, '.claude.json')
}

function claudeDesktopConfig(): string {
  return path.join(configHome(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
}

function claudeDesktopInstalled(): boolean {
  const apps = ['/Applications/Claude.app', path.join(os.homedir(), 'Applications', 'Claude.app')]
  return apps.some((app) => fs.existsSync(app)) || fs.existsSync(path.dirname(claudeDesktopConfig()))
}

async function cli(executable: string, args: string[]): Promise<string> {
  try {
    const env = childEnv({ HOME: configHome() })
    if (selectedFixtureBackendEnv().HOME) {
      delete env.CODEX_HOME
      delete env.CLAUDE_CONFIG_DIR
    }
    const { stdout } = await run(executable, args, { env, timeout: CLI_TIMEOUT_MS })
    return stdout
  } catch (error) {
    const detail = (error as { stderr?: string }).stderr?.trim() || (error instanceof Error ? error.message : String(error))
    throw new Error(`${path.basename(executable)} ${args.slice(0, 2).join(' ')} failed: ${detail}. Try again, or run it in Terminal to see the cause.`)
  }
}

function required(executable: string | undefined, name: string): string {
  if (!executable) throw new Error(`${name} is not installed on this Mac. Install it, then try again.`)
  return executable
}

function readJson(file: string): JsonObject {
  let text: string
  try { text = fs.readFileSync(file, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new Error(`Could not read ${file}: ${error instanceof Error ? error.message : String(error)}.`)
  }
  return text.trim() === '' ? {} : parseJson(text, file)
}

function parseJson(text: string, source: string): JsonObject {
  try {
    const value: unknown = JSON.parse(text)
    if (isObject(value)) return value
  } catch { /* reported below */ }
  throw new Error(`${source} is not a JSON object. Fix or remove it, then try again.`)
}

/** Writes through a temporary file, so an interrupted write never leaves a broken config. */
function writeJson(link: string, value: JsonObject): void {
  fs.mkdirSync(path.dirname(link), { recursive: true })
  // A linked config (for example from a dotfiles repo) stays linked: write the real file.
  const file = fs.existsSync(link) ? fs.realpathSync(link) : link
  const mode = fs.existsSync(file) ? fs.statSync(file).mode & 0o777 : 0o600
  const temporary = `${file}.gappd-${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode })
  fs.renameSync(temporary, file)
}

function objectAt(value: JsonObject, key: string): JsonObject {
  const child = value[key]
  return isObject(child) ? child : {}
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
