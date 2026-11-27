import { AuthProvider, useAuth } from './auth'
import { configured } from './lib/supabase'
import AuthPage from './pages/AuthPage'
import Lobby from './pages/Lobby'
import Background3D from './components/Background3D'
import Garland from './components/Garland'

function Gate() {
  const { session, loading } = useAuth()
  if (loading) return <p className="p-8 font-pixel text-xs">LOADING...</p>
  return session ? <Lobby /> : <AuthPage />
}
export default function App() {
  if (!configured) return <main className="min-h-screen flex items-center justify-center p-4"><div className="panel p-5 max-w-lg"><h2 className="font-pixel text-xs text-yellow-300 mb-3">CONFIG MISSING</h2><p>The site was built without VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY. Add them in GitHub: Settings, Secrets and variables, Actions, Variables tab. Then re-run the deploy workflow.</p></div></main>
  return <><Background3D /><div className="app-root scanlines"><Garland /><div className="flex-1 min-h-0"><AuthProvider><Gate /></AuthProvider></div></div></>
}
