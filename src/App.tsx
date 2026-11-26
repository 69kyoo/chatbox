import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import { configured } from './lib/supabase'
import AuthPage from './pages/AuthPage'
import ResetPage from './pages/ResetPage'
import Lobby from './pages/Lobby'

function Gate() {
  const { session, loading } = useAuth()
  if (loading) return <p className="p-8 font-pixel text-xs">LOADING...</p>
  return (
    <Routes>
      <Route path="/reset" element={<ResetPage />} />
      <Route path="/" element={session ? <Lobby /> : <AuthPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
export default function App() {
  if (!configured) return <p className="p-8">Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY. See .env.example.</p>
  return <BrowserRouter><AuthProvider><Gate /></AuthProvider></BrowserRouter>
}
