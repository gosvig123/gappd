import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Load the actual module with fake process/runtime boundaries. No child processes run.
export function loadSourceModule(path: URL, imports: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const source = readFileSync(path, 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const exports: Record<string, any> = {}
  runInNewContext(outputText, { exports, ...globals, require: (name: string) => {
    if (!(name in imports)) throw new Error(`Unexpected dependency: ${name}`)
    return imports[name]
  } })
  return exports
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
