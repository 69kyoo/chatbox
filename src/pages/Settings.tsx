import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth'
import { THEMES, ThemeId, applyTheme, isTheme, useTheme } from '../lib/theme'
import { play } from '../lib/sfx'

export default function Settings() {
  const { profile, refresh } = useAuth(); const active = useTheme(); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false)
  if (!profile) return <p className="p-3">Loading…</p>
  const staff = profile.role === 'owner' || profile.role === 'admin'
  const locked = !!profile.theme_locked && !staff   // staff applied a theme to this user (horror): only staff can change it
  const saved: ThemeId = isTheme(profile.theme) ? profile.theme : 'christmas'

  async function pick(id: ThemeId) {
    if (busy || id === active) return
    setBusy(true); setMsg(''); applyTheme(id); play('click')     // optimistic: instant preview, the server decides
    const { error } = await supabase.rpc('set_my_theme', { t: id })
    if (error) { applyTheme(saved); setMsg(/function .*does not exist|schema cache/i.test(error.message) ? 'Theme storage is not set up yet: run supabase/migrations/004_themes.sql' : error.message) }
    else { setMsg('Theme saved'); refresh() }
    setBusy(false)
  }

  return <div className="p-3 scroll-y h-full"><section className="panel p-4 flex flex-col gap-3 max-w-lg mx-auto">
    <h2 className="lbl">SETTINGS</h2>
    <p className="text-lg">Pick how <b>your</b> CHATKARI looks. Only you see it, and it follows you to every device.</p>
    {locked && <p role="status" className="text-yellow-300">A staff member set your theme. It is locked until staff change it.</p>}
    <div className="flex flex-col gap-2" role="group" aria-label="Themes">
      {THEMES.map(t => { const off = busy || locked || (!!t.staffOnly && !staff); return <button key={t.id} className="theme-card" aria-pressed={active === t.id} disabled={off && active !== t.id} onClick={() => void pick(t.id)}>
        <span className="theme-sw" aria-hidden="true">{t.sw.map(c => <i key={c} style={{ background: c }} />)}</span>
        <span className="flex items-center gap-2"><span className="font-pixel text-[.6rem]">{t.name}</span>{active === t.id && <span className="badge bg-yellow-300">ACTIVE</span>}{t.staffOnly && <span className="badge bg-red-500">STAFF ONLY</span>}</span>
        <span className="text-base opacity-90">{t.blurb}</span>
      </button> })}
    </div>
    {staff && <p className="text-base opacity-90">As {profile.role}, you can apply any theme (including HORROR) to any member from ADMIN, USERS.</p>}
    {msg && <p role="status" className="text-cyan-300">{msg}</p>}
  </section></div>
}
