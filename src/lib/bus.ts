// Tiny event bus so UI events can drive the 3D world without coupling.
export type WorldEvent = 'nav' | 'open' | 'close' | 'send' | 'receive' | 'alert' | 'secret' | 'error'
type H = (e: WorldEvent) => void
const hs = new Set<H>()
export const emitWorld = (e: WorldEvent) => hs.forEach(h => h(e))
export const onWorld = (h: H) => { hs.add(h); return () => { hs.delete(h) } }
