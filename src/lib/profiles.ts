import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Profile } from '../auth'

type Mini = Pick<Profile, 'id' | 'username' | 'role' | 'avatar_url'>
const cache = new Map<string, Mini>()
const pending = new Set<string>()
const subs = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | null = null

function flush() {
  timer = null
  const ids = [...pending]; pending.clear()
  if (!ids.length) return
  void supabase.from('profiles').select('id,username,role,avatar_url').in('id', ids).then(({ data }) => {
    (data as Mini[] | null)?.forEach(p => cache.set(p.id, p)); subs.forEach(s => s())
  })
}
// Batches lookups so a page of 100 messages = 1 query.
export function useProfiles(ids: string[]) {
  const [, force] = useState(0)
  useEffect(() => { const f = () => force(n => n + 1); subs.add(f); return () => { subs.delete(f) } }, [])
  let need = false
  for (const id of ids) if (!cache.has(id) && !pending.has(id)) { pending.add(id); need = true }
  useEffect(() => { if (need && !timer) timer = setTimeout(flush, 30) })
  return (id: string): Mini => cache.get(id) ?? { id, username: '…', role: 'member', avatar_url: null }
}
export const invalidateProfile = (id: string) => cache.delete(id)
