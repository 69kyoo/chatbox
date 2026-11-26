import { supabase } from '../lib/supabase'
import { useAuth } from '../auth'
import Logo from '../components/Logo'
import RoleBadge from '../components/RoleBadge'
export default function Lobby() {
  const { profile, session } = useAuth()
  return (
    <main className="min-h-screen flex flex-col items-center gap-8 p-4 pt-12">
      <Logo />
      <section className="panel p-5 w-full max-w-lg flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{profile?.username ?? '...'}</span>{profile && <RoleBadge role={profile.role} />}
        </div>
        <p className="text-slate-300">{session?.user.email}</p>
        {profile?.banned && <p className="text-red-400">This account is banned.</p>}
        <p className="text-cyan-300">Lobby online. Chat, rooms and forum arrive in the next phases.</p>
        <button className="btn self-start" onClick={() => supabase.auth.signOut()}>LOG OUT</button>
      </section>
    </main>
  )
}
