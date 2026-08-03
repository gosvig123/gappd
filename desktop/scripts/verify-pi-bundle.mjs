import { readFile } from 'node:fs/promises'

const bundle = await readFile(new URL('../dist-electron/main/main.js', import.meta.url), 'utf8')
const failures = []

if (!bundle.includes('EXPANSION_MAX_LENGTH')) failures.push('patched brace-expansion missing')
if (bundle.includes('function expand_(str, max, isTop)')) failures.push('vulnerable brace-expansion bundled')
if (/require\(["']@earendil-works\//.test(bundle)) failures.push('Pi runtime left external')
if (!bundle.includes('const __gappdImportMetaUrl')) failures.push('CommonJS import.meta.url shim missing')
if (bundle.includes('fileURLToPath)(import_meta.url)')) failures.push('undefined import.meta.url access bundled')

if (failures.length) {
  console.error(`Pi bundle verification failed: ${failures.join(', ')}`)
  process.exit(1)
}

console.log('Pi bundle verified: self-contained and patched')
