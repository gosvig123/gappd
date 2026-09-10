import type { ComponentType } from 'react'
import type { PrototypeView } from './contract'

export type VariantProps = { view: PrototypeView }
export type Variant = { key: string; name: string; tagline: string; Component: ComponentType<VariantProps> }
type VariantModule = { default: Variant }

/**
 * Each variant is two namespaced files (`variant-x.tsx` / `variant-x.css`) that
 * only touch their own class prefix (`vx-`). Adding a file is the whole
 * registration step, so variants never edit a shared module.
 */
export const VARIANTS: Variant[] = loadVariants()

function loadVariants(): Variant[] {
  const modules = import.meta.glob<VariantModule>('./variants/variant-*.tsx', { eager: true })
  return Object.values(modules).map((module) => module.default).sort((left, right) => left.key.localeCompare(right.key))
}
