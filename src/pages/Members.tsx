import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Role } from '../auth'
import RoleBadge from '../components/RoleBadge'

type M = { id: string; username: string; avatar_url: string | null; bio: string | null; role: Role }
const ORDER: Role[] = ['owner', 'admin', 'moderator', 'member']
const TITLE: Record<Role, string> = { owner: 'OWNER', admin: 'ADMINS', moderator: 'MODERATORS', member: 'MEMBERS' }

// Everyone, grouped by role (owner > admin > moderator > member) and A-Z inside each group. Banned accounts are hidden.
export default function Members() {
  const [rows, setRows] = useState<M[]>([]); const [q, setQ] = useState(''); const [open, setOpen] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'err'>('loading')

  useEffect(() => {
    let dead = false
    ;(async () => {
      const all: M[] = []
      for (let from = 0; ; from += 1000) {   // page through, Supabase caps a single request at 1000 rows
        const { data, error } = await supabase.from('profiles').select('id,username,avatar_url,bio,role').eq('banned', false).order('username').range(from, from + 999)
        if (error) { if (!dead) setState('err'); return }
        all.push(...(data as M[])); if (!data || data.length < 1000) break
      }
      if (!dead) { setRows(all); setState('ok') }
    })()
    return () => { dead = true }
  }, [])

  const groups = useMemo(() => {
    const f = q.trim().toLowerCase()
    return ORDER.map(role => ({
      role,
      list: rows.filter(r => r.role === role && (!f || r.username.toLowerCase().includes(f)))
        .sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base', numeric: true }))
    })).filter(g => g.list.length)
  }, [rows, q])

  return <div className="p-3 scroll-y h-full"><section className="max-w-lg mx-auto flex flex-col gap-3">
    <div className="flex items-center gap-2"><h2 className="lbl flex-1">ALL USERS ({rows.length})</h2></div>
    <input className="inp" placeholder="search username" aria-label="Search users" value={q} onChange={e => setQ(e.target.value)} />
    {state === 'loading' && <p>Loading…</p>}
    {state === 'err' && <p className="text-pink-300">Could not load the user list.</p>}
    {state === 'ok' && groups.length === 0 && <p className="text-emerald-200">No users found.</p>}
    {groups.map(g => <div key={g.role} className="panel p-3 flex flex-col gap-1">
      <h3 className="lbl mb-1">{TITLE[g.role]} ({g.list.length})</h3>
      {g.list.map(u => <div key={u.id}>
        <button className="w-full flex items-center gap-3 text-left py-1" aria-expanded={open === u.id} onClick={() => setOpen(open === u.id ? null : u.id)}>
          {u.avatar_url ? <img src={u.avatar_url} alt="" loading="lazy" className="w-9 h-9 object-cover border-[3px] border-black shrink-0" style={{ imageRendering: 'pixelated' }} />
            : <span className="w-9 h-9 border-[3px] border-black bg-[#1a7a4c] grid place-items-center font-pixel text-xs shrink-0">{u.username[0]?.toUpperCase()}</span>}
          <span className="text-xl truncate">{u.username}</span><RoleBadge role={u.role} />
        </button>
        {open === u.id && <p className="text-base pl-12 pb-1 break-words opacity-90">{u.bio || 'No bio yet.'}</p>}
      </div>)}
    </div>)}
  </section></div>
}
