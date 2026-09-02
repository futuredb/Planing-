import { createContext, useContext } from 'react'
import type { Store } from './store'

export const StoreContext = createContext<Store | null>(null)

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('Store missing')
  return ctx
}
