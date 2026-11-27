import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, Role, Profile } from '../auth'
import RoleBadge from '../components/RoleBadge'
import { USERNAME_RE } from '../lib/identity'

type Tab = 'users' | 'alerts' | 'reports' | 'logs'
type Perm = { key: string; description: string; owner_only: boolean }
type Mute = { user_id: string; until: string }
const DUR: [string, number][] = [['1m', 60], ['5m', 300], ['1h', 3600], ['1d', 86400]]

export default function Admin() {
  const { can, profile } = useAuth(); const [tab, setTab] = useState<Tab>('users')
  if (!profile || !(profile.role === 'owner' || profile.role === 'admin' || can('user.manage') || can('chat.mute') || can('audit.view') || can('report.manage'))) return <p className="p-3">No access.</p>
  const tabs: [Tab, string, boolean][] = [['users', 'USERS', can('user.manage') || can('chat.mute') || can('user.ban')], ['alerts', 'ALERTS', can('alert.send')], ['reports', 'REPORTS', can('report.manage')], ['logs', 'LOGS', can('audit.view')]]
  return <div className="flex flex-col h-full min-h-0">
    <div className="flex gap-1 p-2 border-b-4 border-black overflow-x-auto">{tabs.filter(t => t[2]).map(([k, l]) => <button key={k} className="tab" aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>{l}</button>)}</div>
    <div className="flex-1 scroll-y p-3">{tab === 'users' ? <Users /> : tab === 'alerts' ? <Alerts /> : tab === 'reports' ? <Reports /> : <Logs />}</div></div>
}

function Users() {
  const { can, profile } = useAuth(); const isOwner = profile?.role === 'owner'
  const [q, setQ] = useState(''); const [rows, setRows] = useState<Profile[]>([]); const [mutes, setMutes] = useState<Record<string, string>>({})
  const [perms, setPerms] = useState<Perm[]>([]); const [open, setOpen] = useState<string | null>(null); const [up, setUp] = useState<Record<string, boolean>>({})
  const [msg, setMsg] = useState(''); const [nu, setNu] = useState(''); const [np, setNp] = useState('')

  const load = useCallback(async () => {
    let s = supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(100)
    if (q.trim()) s = s.ilike('username', `%${q.trim().replace(/[%_]/g, '')}%`)
    const [a, m, p] = await Promise.all([s, supabase.from('mutes').select('user_id,until'), supabase.from('permissions').select('*').order('key')])
    setRows((a.data ?? []) as Profile[]); setPerms((p.data ?? []) as Perm[])
    const mm: Record<string, string> = {}; (m.data as Mute[] | null)?.forEach(x => { if (new Date(x.until) > new Date()) mm[x.user_id] = x.until }); setMutes(mm)
  }, [q])
  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t) }, [load])
  const run = async (p: PromiseLike<{ error: { message: string } | null }>, ok = 'Done') => { const { error } = await p; setMsg(error ? error.message : ok); void load() }
  async function openUser(id: string) {
    setOpen(open === id ? null : id)
    const { data } = await supabase.from('user_permissions').select('permission_key,granted').eq('user_id', id)
    const m: Record<string, boolean> = {}; data?.forEach(d => { m[d.permission_key] = d.granted }); setUp(m)
  }
  async function create() {
    if (!USERNAME_RE.test(nu) || np.length < 8) { setMsg('Username 3-20 chars (letters/numbers/_), password 8+ chars'); return }
    const { data, error } = await supabase.functions.invoke('admin-users', { body: { action: 'create', username: nu, password: np } })
    setMsg(error || data?.error ? (data?.error ?? error?.message) : 'User created'); setNu(''); setNp(''); void load()
  }
  async function del(id: string, name: string) {
    if (!confirm(`Delete ${name} permanently?`)) return
    const { data, error } = await supabase.functions.invoke('admin-users', { body: { action: 'delete', id } })
    setMsg(error || data?.error ? (data?.error ?? error?.message) : 'User deleted'); void load()
  }
  return <div className="flex flex-col gap-3">
    <input className="inp" placeholder="search username" value={q} onChange={e => setQ(e.target.value)} />
    {msg && <p role="status" className="text-cyan-300 break-words">{msg}</p>}
    {can('user.create') && <div className="panel p-2 flex flex-col sm:flex-row gap-2"><input className="inp" placeholder="new username" value={nu} onChange={e => setNu(e.target.value)} /><input className="inp" type="password" placeholder="password" value={np} onChange={e => setNp(e.target.value)} /><button className="btn" onClick={() => void create()}>CREATE</button></div>}
    {rows.map(u => { const m = mutes[u.id]; const prot = u.role === 'owner'; return <div key={u.id} className="panel p-2 flex flex-col gap-2">
      <button className="flex items-center gap-2 text-left" onClick={() => void openUser(u.id)}><span className="text-xl truncate">{u.username}</span><RoleBadge role={u.role} />
        {u.banned && <span className="badge bg-red-500">BANNED</span>}{m && <span className="badge bg-yellow-300">MUTED</span>}</button>
      {open === u.id && <div className="flex flex-col gap-2">
        {!prot && can('chat.mute') && <div className="flex gap-1 flex-wrap items-center"><span className="lbl">MUTE</span>
          {DUR.map(([l, s]) => <button key={l} className="btn btn-sm" onClick={() => void run(supabase.rpc('mute_user', { target: u.id, seconds: s }), `Muted ${u.username} ${l}`)}>{l}</button>)}
          {m && <button className="btn btn-sm btn-alt" onClick={() => void run(supabase.rpc('unmute_user', { target: u.id }), 'Unmuted')}>UNMUTE</button>}</div>}
        {!prot && can('user.ban') && <button className="btn btn-sm btn-danger self-start" onClick={() => void run(supabase.rpc('set_banned', { target: u.id, is_banned: !u.banned }))}>{u.banned ? 'UNBAN' : 'BAN'}</button>}
        {!prot && can('user.manage') && <button className="btn btn-sm btn-alt self-start" onClick={() => { const n = prompt('New username', u.username); if (n) void run(supabase.rpc('rename_user', { target: u.id, new_name: n })) }}>RENAME</button>}
        {isOwner && !prot && <>
          <div className="flex items-center gap-2"><span className="lbl">ROLE</span><select className="inp !w-auto" value={u.role} onChange={e => void run(supabase.rpc('set_user_role', { target: u.id, new_role: e.target.value as Role }))}>
            <option value="member">member</option><option value="moderator">moderator</option><option value="admin">admin</option></select></div>
          <div className="flex flex-col gap-1"><span className="lbl">PERMISSION OVERRIDES</span>{perms.filter(p => !p.owner_only).map(p => <label key={p.key} className="flex items-center gap-2 text-base">
            <select className="inp !w-auto !text-base" value={up[p.key] === undefined ? 'default' : up[p.key] ? 'grant' : 'deny'} onChange={async e => {
              if (e.target.value === 'default') await run(supabase.rpc('clear_user_permission', { target: u.id, perm: p.key }))
              else await run(supabase.rpc('set_user_permission', { target: u.id, perm: p.key, is_granted: e.target.value === 'grant' })); const { data } = await supabase.from('user_permissions').select('permission_key,granted').eq('user_id', u.id); const m: Record<string, boolean> = {}; data?.forEach(d => { m[d.permission_key] = d.granted }); setUp(m) }}>
              <option value="default">role default</option><option value="grant">grant</option><option value="deny">deny</option></select>{p.key}</label>)}</div></>}
        {can('user.delete') && !prot && <button className="btn btn-sm btn-danger self-start" onClick={() => void del(u.id, u.username)}>DELETE USER</button>}
      </div>}</div> })}
  </div>
}

function Alerts() {
  const [users, setUsers] = useState<{ id: string; username: string }[]>([]); const [target, setTarget] = useState('all')
  const [title, setTitle] = useState(''); const [body, setBody] = useState(''); const [msg, setMsg] = useState('')
  useEffect(() => { void supabase.from('profiles').select('id,username').order('username').limit(500).then(({ data }) => setUsers(data ?? [])) }, [])
  async function send() {
    if (!title.trim() || !body.trim()) { setMsg('Title and text are required'); return }
    const { error } = await supabase.rpc('send_alert', { target: target === 'all' ? null : target, alert_title: title, alert_body: body })
    setMsg(error ? error.message : 'Alert sent'); if (!error) { setTitle(''); setBody('') }
  }
  return <div className="panel p-3 flex flex-col gap-2 max-w-lg">
    <label className="lbl">TARGET</label><select className="inp" value={target} onChange={e => setTarget(e.target.value)}><option value="all">EVERYONE (global)</option>{users.map(u => <option key={u.id} value={u.id}>{u.username}</option>)}</select>
    <label className="lbl">BIG TITLE</label><input className="inp" maxLength={60} value={title} onChange={e => setTitle(e.target.value)} />
    <label className="lbl">TEXT</label><textarea className="inp" rows={4} maxLength={500} value={body} onChange={e => setBody(e.target.value)} />
    {msg && <p role="status" className="text-cyan-300">{msg}</p>}<button className="btn self-start" onClick={() => void send()}>SEND ALERT</button></div>
}

type Rep = { id: string; kind: string; target_id: string; reason: string; resolved: boolean; created_at: string }
function Reports() {
  const { can } = useAuth(); const [rows, setRows] = useState<Rep[]>([]); const [preview, setPreview] = useState<Record<string, string>>({})
  const load = useCallback(async () => {
    const { data } = await supabase.from('reports').select('*').eq('resolved', false).order('created_at', { ascending: false }).limit(50); const r = (data ?? []) as Rep[]; setRows(r)
    const pv: Record<string, string> = {}
    for (const x of r) { const t = x.kind === 'message' ? 'messages' : x.kind === 'thread' ? 'threads' : 'thread_replies'
      const { data: d } = await supabase.from(t).select('body').eq('id', x.target_id).maybeSingle(); pv[x.id] = d?.body ?? '[gone]' }
    setPreview(pv)
  }, [])
  useEffect(() => { void load() }, [load])
  const kindOf = (k: string) => k === 'message' ? 'message' : k
  return <div className="flex flex-col gap-2">{rows.length === 0 && <p className="text-emerald-200">No open reports.</p>}
    {rows.map(r => <div key={r.id} className="panel p-2 flex flex-col gap-1 break-words"><b>{r.kind}</b> <i>{r.reason}</i><p className="text-emerald-100">“{preview[r.id]}”</p>
      <div className="flex gap-2">{can('chat.moderate') && <button className="btn btn-sm btn-danger" onClick={async () => { await supabase.rpc('revoke_content', { kind: kindOf(r.kind), cid: r.target_id }); await supabase.rpc('resolve_report', { rid: r.id }); void load() }}>REMOVE</button>}
        <button className="btn btn-sm" onClick={async () => { await supabase.rpc('resolve_report', { rid: r.id }); void load() }}>DISMISS</button></div></div>)}</div>
}

type Log = { id: number; actor_id: string | null; action: string; target_id: string | null; details: Record<string, unknown>; created_at: string }
function Logs() {
  const [rows, setRows] = useState<Log[]>([]); const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => { void (async () => {
    const { data } = await supabase.from('mod_logs').select('*').order('created_at', { ascending: false }).limit(100); const r = (data ?? []) as Log[]; setRows(r)
    const ids = [...new Set(r.flatMap(x => [x.actor_id, x.target_id]).filter(Boolean))] as string[]
    if (ids.length) { const { data: p } = await supabase.from('profiles').select('id,username').in('id', ids); const n: Record<string, string> = {}; p?.forEach(x => { n[x.id] = x.username }); setNames(n) } })() }, [])
  return <div className="flex flex-col gap-1 text-base">{rows.map(l => <div key={l.id} className="border-b border-emerald-900 py-1 break-words">
    <span className="text-emerald-200">{new Date(l.created_at).toLocaleString()}</span> <b>{l.actor_id ? names[l.actor_id] ?? '?' : 'system'}</b> {l.action}{l.target_id ? ` → ${names[l.target_id] ?? '?'}` : ''} <span className="text-emerald-300">{Object.keys(l.details).length ? JSON.stringify(l.details) : ''}</span></div>)}</div>
}
