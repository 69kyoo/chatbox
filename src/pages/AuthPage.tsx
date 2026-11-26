import { FormEvent, useState } from 'react'
import { supabase } from '../lib/supabase'
import Logo from '../components/Logo'

type Mode = 'login' | 'register' | 'forgot'
export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [username, setUsername] = useState('')
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMsg('')
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) throw error
      } else if (mode === 'register') {
        if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) throw new Error('Username: 3-20 letters, numbers or _')
        if (password.length < 8) throw new Error('Password needs at least 8 characters')
        const { error } = await supabase.auth.signUp({ email, password, options: { data: { username }, emailRedirectTo: window.location.origin } })
        if (error) throw error
        setMsg('Account created. Check your email to confirm (if confirmation is enabled), then log in.')
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/reset' }); if (error) throw error
        setMsg('If that email exists, a reset link is on its way.')
      }
    } catch (err) { setMsg((err as Error).message) } finally { setBusy(false) }
  }
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-8 p-4">
      <Logo />
      <form onSubmit={submit} className="panel w-full max-w-sm p-5 flex flex-col gap-3">
        <h2 className="font-pixel text-xs text-yellow-300">{mode === 'login' ? 'PLAYER LOGIN' : mode === 'register' ? 'NEW PLAYER' : 'RECOVER PASSWORD'}</h2>
        {mode === 'register' && <input className="inp" placeholder="username" value={username} onChange={e => setUsername(e.target.value)} required maxLength={20} />}
        <input className="inp" type="email" placeholder="email" value={email} onChange={e => setEmail(e.target.value)} required />
        {mode !== 'forgot' && <input className="inp" type="password" placeholder="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />}
        <button className="btn" disabled={busy}>{busy ? '...' : 'START'}</button>
        {msg && <p role="alert" className="text-pink-300">{msg}</p>}
        <div className="flex justify-between text-cyan-300 underline text-base">
          {mode !== 'login' && <button type="button" onClick={() => setMode('login')}>login</button>}
          {mode !== 'register' && <button type="button" onClick={() => setMode('register')}>register</button>}
          {mode !== 'forgot' && <button type="button" onClick={() => setMode('forgot')}>forgot password</button>}
        </div>
      </form>
    </main>
  )
}
