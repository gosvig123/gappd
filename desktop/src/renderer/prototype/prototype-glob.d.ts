/*
 * The project hand-declares renderer globals (see `renderer/global.d.ts`)
 * instead of pulling in `vite/client`, so declare the one Vite helper the
 * prototype uses for variant discovery.
 */
interface ImportMeta {
  glob<T = unknown>(pattern: string | string[], options?: { eager?: boolean }): Record<string, T>
}
