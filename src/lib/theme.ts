import { useEffect, useState } from 'react'

export type ThemeId = 'christmas' | 'outside' | 'kitty' | 'nyc' | 'horror'
export const THEMES: { id: ThemeId; name: string; blurb: string; staffOnly?: boolean; sw: [string, string, string] }[] = [
  { id: 'christmas', name: 'CHRISTMAS', blurb: 'Snowy night, fairy lights, gifts and a snowman. The classic.', sw: ['#06101f', '#2fbf71', '#ffd21f'] },
  { id: 'outside', name: 'OUTSIDE', blurb: 'A calm sunny day: green hills, trees, clouds and a little house.', sw: ['#7ec8ff', '#3fae4a', '#fff3a0'] },
  { id: 'kitty', name: 'KAWAII PINK', blurb: 'Soft pink and white, hearts, bows, sparkles and candy clouds.', sw: ['#ffe4f1', '#ff8fc0', '#ffffff'] },
  { id: 'nyc', name: 'NYC STREETS', blurb: 'Gritty night in the city: brick, neon, graffiti and wet asphalt.', sw: ['#16161b', '#ff9f1c', '#ff2e63'] },
  { id: 'horror', name: 'HORROR', blurb: 'Graveyard, blood moon and fog. Applied by the owner or admins only.', staffOnly: true, sw: ['#050505', '#8a0303', '#555555'] }
]
export const isTheme = (v: unknown): v is ThemeId => THEMES.some(t => t.id === v)

const KEY = 'ck_theme'
let current: ThemeId = (() => { try { const v = localStorage.getItem(KEY); return isTheme(v) ? v : 'christmas' } catch { return 'christmas' } })()
const subs = new Set<() => void>()

// Sets <html data-theme>, remembers it locally (so there's no flash on next load) and tells the 3D background to swap scenes.
// The SERVER is the source of truth (profiles.theme); this only mirrors it for display.
export function applyTheme(t: ThemeId) {
  current = t
  document.documentElement.dataset.theme = t
  try { localStorage.setItem(KEY, t) } catch { /* private mode */ }
  subs.forEach(s => s())
}
export const currentTheme = () => current
export function useTheme(): ThemeId {
  const [t, setT] = useState(current)
  useEffect(() => { const f = () => setT(current); subs.add(f); return () => { subs.delete(f) } }, [])
  return t
}
