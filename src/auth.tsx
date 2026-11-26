import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'

export type Role = 'owner' | 'admin' | 'moderator' | 'member'
export type Profile = { id: string; username: string; avatar_url: string | null; bio: string | null; role: Role; banned: boolean; created_at: string }
type Ctx = { session: Session | null; profile: Profile | null; loading: boolean }
const C = createContext<Ctx>({ session: null, profile: null, loading: true })
export const useAuth = () => useContext(C)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])
  const uid = session?.user.id
  useEffect(() => {
    if (!uid) { setProfile(null); return }
    supabase.from('profiles').select('*').eq('id', uid).single().then(({ data }) => setProfile(data as Profile | null))
  }, [uid])
  return <C.Provider value={{ session, profile, loading }}>{children}</C.Provider>
}
