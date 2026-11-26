import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Logo from '../components/Logo'
export default function ResetPage() {
  const [pw, setPw] = useState(''); const [msg, setMsg] = useState(''); const nav = useNavigate()
  async function go(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.auth.updateUser({ password: pw })
    if (error) setMsg(error.message); else nav('/')
  }
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-8 p-4">
      <Logo />
      <form onSubmit={go} className="panel w-full max-w-sm p-5 flex flex-col gap-3">
        <h2 className="font-pixel text-xs text-yellow-300">NEW PASSWORD</h2>
        <input className="inp" type="password" minLength={8} required placeholder="new password" value={pw} onChange={e => setPw(e.target.value)} />
        <button className="btn">SAVE</button>{msg && <p className="text-pink-300">{msg}</p>}
      </form>
    </main>
  )
}
