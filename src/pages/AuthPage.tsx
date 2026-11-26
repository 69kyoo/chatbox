import { FormEvent, useState } from 'react'
import { supabase } from '../lib/supabase'
import { internalId, USERNAME_RE } from '../lib/identity'
import Logo from '../components/Logo'
import { play } from '../lib/sfx'

type Mode = 'login' | 'register'
// Username + password only. No email field, no verification, no reset-by-email.
export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('login')
  const [password, setPassword] = useState(''); const [username, setUsername] = useState('')
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true); setMsg('')
    try {
      if (!USERNAME_RE.test(username)) throw new Error('Username: 3-20 letters, numbers or _')
      if (mode === 'register') {
        if (password.length < 8) throw new Error('Password needs at least 8 characters')
        const { data, error } = await supabase.auth.signUp({ email: internalId(username), password, options: { data: { username } } })
        if (error) throw new Error(/already|taken|registered/i.test(error.message) ? 'Username already taken' : error.message)
        if (!data.session) throw new Error('Account created, but the project still requires confirmation. In Supabase: Authentication > Providers > Email > turn OFF "Confirm email".')
        play('secret')
      } else {
        const { data: ident } = await supabase.rpc('login_identifier', { uname: username })
        const { error } = await supabase.auth.signInWithPassword({ email: (ident as string | null) ?? internalId(username), password })
        if (error) throw new Error('Wrong username or password')
        play('open')
      }
    } catch (err) { const m = (err as Error).message; setMsg(/database error saving new user/i.test(m) ? 'Username already taken or registration is closed' : m); play('error') } finally { setBusy(false) }
  }
  return (
    <main className="min-h-full flex flex-col items-center justify-center gap-8 p-4 overflow-y-auto">
      <Logo />
      <form onSubmit={submit} className="panel w-full max-w-sm p-5 flex flex-col gap-3">
        <h2 className="font-pixel text-xs text-yellow-300">{mode === 'login' ? 'PLAYER LOGIN' : 'NEW PLAYER'}</h2>
        <input className="inp" placeholder="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={username} onChange={e => setUsername(e.target.value)} required maxLength={20} />
        <input className="inp" type="password" placeholder="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={mode === 'register' ? 8 : 1} />
        <button className="btn" disabled={busy}>{busy ? '...' : mode === 'login' ? 'START' : 'CREATE PLAYER'}</button>
        {msg && <p role="alert" className="text-pink-300 break-words">{msg}</p>}
        <button type="button" className="text-cyan-300 underline text-base self-start" onClick={() => { play('click'); setMode(mode === 'login' ? 'register' : 'login'); setMsg('') }}>
          {mode === 'login' ? 'new here? register' : 'have an account? login'}</button>
        <p className="text-sm text-violet-300">Lost your password? Ask the site owner to reset it for you.</p>
      </form>
    </main>
  )
}
