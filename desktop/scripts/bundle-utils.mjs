import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import https from 'node:https'

export async function fileSha256(filePath) {
  const data = await readFile(filePath)
  return createHash('sha256').update(data).digest('hex')
}

export async function downloadFile({ url, outputPath, sha256, label }) {
  await streamDownload(url, outputPath, label)
  const actual = await fileSha256(outputPath)
  if (actual !== sha256) throw new Error(`${label} sha256 mismatch: ${actual}`)
}

export function runCommand(command, args, message) {
  const result = spawnSync(command, args, { stdio: 'pipe' })
  if (!result.error && result.status === 0) return
  throw new Error(`${message}\n${commandOutput(result)}`.trim())
}

async function streamDownload(url, outputPath, label) {
  await rm(outputPath, { force: true })
  await new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (isRedirect(response.statusCode) && response.headers.location) {
        response.resume()
        resolve(streamDownload(response.headers.location, outputPath, label))
        return
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download ${label}: ${response.statusCode}`))
        return
      }
      const file = createWriteStream(outputPath)
      response.pipe(file)
      file.on('finish', () => file.close(resolve))
      file.on('error', reject)
    }).on('error', reject)
  })
}

function isRedirect(statusCode) {
  return Boolean(statusCode && statusCode >= 300 && statusCode < 400)
}

function commandOutput(result) {
  if (result.error) return result.error.message
  const stderr = result.stderr.toString().trim()
  const stdout = result.stdout.toString().trim()
  if (stderr) return stderr
  if (stdout) return stdout
  return `Command exited with status ${result.status}`
}
