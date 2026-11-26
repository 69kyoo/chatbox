import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'

export type Role = 'owner' | 'admin' | 'moderator' | 'member'
export type Profile = { id: string; username: string; avatar_url: string | null; bio: string | null; role: Role; banned: boolean; created_at: string }
type Ctx = {
  session: Session | null; profile: Profile | null; loading: boolean
  perms: string[]; can: (k: string) => boolean; muteUntil: Date | null; refresh: () => void
}
const C = createContext<Ctx>({ session: null, profile: null, loading: true, perms: [], can: () => false, muteUntil: null, refresh: () => {} })
export const useAuth = () => useContext(C)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [perms, setPerms] = useState<string[]>([])
  const [muteUntil, setMuteUntil] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const uid = session?.user.id
  // Profile + permissions. These drive UI gating ONLY; every action is re-validated by RLS/RPCs on the server.
  useEffect(() => {
    if (!uid) { setProfile(null); setPerms([]); setMuteUntil(null); return }
    let dead = false
    ;(async () => {
      const [p, pr, m] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', uid).single(),
        supabase.rpc('my_permissions'),
        supabase.from('mutes').select('until').eq('user_id', uid).maybeSingle()
      ])
      if (dead) return
      setProfile(p.data as Profile | null); setPerms((pr.data as string[]) ?? [])
      setMuteUntil(m.data && new Date(m.data.until) > new Date() ? new Date(m.data.until) : null)
    })()
    return () => { dead = true }
  }, [uid, tick])

  // Realtime: my mute changes / my profile role changes
  useEffect(() => {
    if (!uid) return
    const ch = supabase.channel('me:' + uid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mutes', filter: `user_id=eq.${uid}` }, () => setTick(t => t + 1))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${uid}` }, () => setTick(t => t + 1))
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [uid])

  // Mutes expire on their own: clear the UI state when the timer runs out (server already ignores expired mutes).
  useEffect(() => {
    if (!muteUntil) return
    const ms = muteUntil.getTime() - Date.now()
    const t = setTimeout(() => setMuteUntil(null), Math.max(0, ms) + 250)
    return () => clearTimeout(t)
  }, [muteUntil])

  const refresh = useCallback(() => setTick(t => t + 1), [])
  const value = useMemo<Ctx>(() => ({ session, profile, loading, perms, can: k => perms.includes(k), muteUntil, refresh }),
    [session, profile, loading, perms, muteUntil, refresh])
  return <C.Provider value={value}>{children}</C.Provider>
}
