import { useEffect } from 'react'
import { AuthProvider, useAuth } from './auth'
import { configured } from './lib/supabase'
import AuthPage from './pages/AuthPage'
import Lobby from './pages/Lobby'
import ThemeBackground from './components/ThemeBackground'
import { applyTheme, isTheme } from './lib/theme'
import Garland from './components/Garland'

// Mirrors the signed-in user's saved theme (profiles.theme, set server-side) onto <html data-theme>. Live: admin changes arrive via the profile realtime refresh.
function ThemeSync() {
  const { profile } = useAuth(); const t = profile?.theme
  useEffect(() => { if (isTheme(t)) applyTheme(t) }, [t])
  return null
}
function Gate() {
  const { session, loading } = useAuth()
  if (loading) return <p className="p-8 font-pixel text-xs">LOADING...</p>
  return session ? <Lobby /> : <AuthPage />
}
export default function App() {
  if (!configured) return <main className="min-h-screen flex items-center justify-center p-4"><div className="panel p-5 max-w-lg"><h2 className="font-pixel text-xs text-yellow-300 mb-3">CONFIG MISSING</h2><p>The site was built without VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY. Add them in GitHub: Settings, Secrets and variables, Actions, Variables tab. Then re-run the deploy workflow.</p></div></main>
  return <><ThemeBackground /><div className="app-root scanlines"><Garland /><div className="flex-1 min-h-0"><AuthProvider><ThemeSync /><Gate /></AuthProvider></div></div></>
}
