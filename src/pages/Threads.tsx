import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth'
import { useProfiles } from '../lib/profiles'
import Composer, { Draft } from '../components/Composer'
import RoleBadge from '../components/RoleBadge'
import Img from '../components/Img'
import { imagePath, uploadImage } from '../lib/media'
import { play } from '../lib/sfx'
import { emitWorld } from '../lib/bus'

type Thread = { id: string; user_id: string; title: string; body: string; image_path: string | null; pinned: boolean; locked: boolean; revoked: boolean; revoked_by: string | null; created_at: string; last_activity: string }
type Reply = { id: string; thread_id: string; user_id: string; body: string; image_path: string | null; revoked: boolean; revoked_by: string | null; created_at: string }
const when = (s: string) => new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function Threads({ openId }: { openId?: string | null }) {
  const [sel, setSel] = useState<string | null>(openId ?? null)
  useEffect(() => { if (openId) setSel(openId) }, [openId])
  return sel ? <ThreadView id={sel} back={() => { setSel(null); emitWorld('close') }} /> : <ThreadList open={id => { play('open'); emitWorld('open'); setSel(id) }} />
}

function ThreadList({ open }: { open: (id: string) => void }) {
  const { session } = useAuth(); const me = session!.user.id
  const [rows, setRows] = useState<Thread[]>([]); const [counts, setCounts] = useState<Record<string, number>>({})
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading'); const [composing, setComposing] = useState(false)
  const [title, setTitle] = useState(''); const [body, setBody] = useState(''); const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [pct, setPct] = useState(0)
  const who = useProfiles(rows.map(r => r.user_id))

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('threads').select('*').order('pinned', { ascending: false }).order('last_activity', { ascending: false }).limit(100)
    if (error) { setState('error'); return }
    setRows(data as Thread[]); setState('ready')
    const ids = (data as Thread[]).map(t => t.id)
    if (ids.length) { const { data: rs } = await supabase.from('thread_replies').select('thread_id').in('thread_id', ids).eq('revoked', false)
      const c: Record<string, number> = {}; rs?.forEach(r => { c[r.thread_id] = (c[r.thread_id] ?? 0) + 1 }); setCounts(c) }
  }, [])
  useEffect(() => {
    void load()
    const ch = supabase.channel('threads-list').on('postgres_changes', { event: '*', schema: 'public', table: 'threads' }, () => void load()).subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [load])

  async function create() {
    if (busy) return; if (title.trim().length < 3) { setErr('Title needs at least 3 characters'); return }
    setBusy(true); setErr('')
    try {
      let path: string | null = null
      if (file) { path = imagePath(`public/${me}`, file); await uploadImage(path, file, setPct) }
      const { data, error } = await supabase.from('threads').insert({ user_id: me, title: title.trim(), body: body.trim(), image_path: path }).select().single()
      if (error) throw new Error(/row-level security/i.test(error.message) ? 'You cannot post right now (muted or banned).' : error.message)
      setTitle(''); setBody(''); setFile(null); setComposing(false); play('send'); open((data as Thread).id)
    } catch (e) { setErr((e as Error).message); play('error') } finally { setBusy(false); setPct(0) }
  }
  return (
    <div className="p-3 flex flex-col gap-3 scroll-y h-full">
      <button className="btn self-start" onClick={() => { play('click'); setComposing(c => !c) }}>{composing ? 'CANCEL' : 'NEW THREAD'}</button>
      {composing && <div className="panel p-3 flex flex-col gap-2">
        <input className="inp" placeholder="title" maxLength={120} value={title} onChange={e => setTitle(e.target.value)} />
        <textarea className="inp" rows={4} maxLength={5000} placeholder="what's on your mind?" value={body} onChange={e => setBody(e.target.value)} />
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-sm max-w-full" />
        {busy && file && <div className="h-3 border-2 border-black"><div className="h-full bg-yellow-300" style={{ width: pct + '%' }} /></div>}
        {err && <p role="alert" className="text-pink-300">{err}</p>}
        <button className="btn self-start" disabled={busy} onClick={() => void create()}>{busy ? '…' : 'POST'}</button></div>}
      {state === 'loading' && <p className="text-cyan-300">Loading…</p>}
      {state === 'error' && <p role="alert" className="text-pink-300">Could not load threads. <button className="underline" onClick={() => void load()}>retry</button></p>}
      {state === 'ready' && rows.length === 0 && <p className="text-emerald-200">No threads yet. Start the first one!</p>}
      {rows.map(t => <button key={t.id} onClick={() => open(t.id)} className="panel p-3 text-left flex flex-col gap-1">
        <div className="flex items-center gap-2">{t.pinned && <span className="badge bg-cyan-300">PIN</span>}{t.locked && <span className="badge bg-pink-300">LOCK</span>}
          <span className="text-xl truncate">{t.revoked ? '[revoked thread]' : t.title}</span></div>
        <div className="text-sm text-emerald-200 flex gap-2 items-center flex-wrap"><span className="truncate max-w-[10rem]">{who(t.user_id).username}</span><RoleBadge role={who(t.user_id).role} />
          <span>{when(t.created_at)}</span><span>{counts[t.id] ?? 0} replies</span></div></button>)}
    </div>
  )
}

function ThreadView({ id, back }: { id: string; back: () => void }) {
  const { session, can } = useAuth(); const me = session!.user.id; const mod = can('thread.moderate')
  const [t, setT] = useState<Thread | null>(null); const [replies, setReplies] = useState<Reply[]>([]); const [state, setState] = useState<'loading' | 'ready' | 'gone'>('loading')
  const [err, setErr] = useState(''); const seen = useRef(new Set<string>())
  const who = useProfiles([...(t ? [t.user_id] : []), ...replies.map(r => r.user_id)])

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([supabase.from('threads').select('*').eq('id', id).maybeSingle(), supabase.from('thread_replies').select('*').eq('thread_id', id).order('created_at')])
    if (!a.data) { setState('gone'); return }
    setT(a.data as Thread); const rs = (b.data ?? []) as Reply[]; seen.current = new Set(rs.map(r => r.id)); setReplies(rs); setState('ready')
  }, [id])
  useEffect(() => {
    void load()
    const ch = supabase.channel('thread:' + id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'thread_replies', filter: `thread_id=eq.${id}` }, p => { const r = p.new as Reply; if (!seen.current.has(r.id)) { seen.current.add(r.id); setReplies(a => [...a, r]); if (r.user_id !== me) play('receive') } })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'thread_replies', filter: `thread_id=eq.${id}` }, p => setReplies(a => a.map(x => x.id === (p.new as Reply).id ? p.new as Reply : x)))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'threads', filter: `id=eq.${id}` }, p => setT(p.new as Thread))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'threads' }, p => { if ((p.old as { id?: string }).id === id) setState('gone') })
      .subscribe(st => { if (st === 'SUBSCRIBED') void load() })
    return () => { void supabase.removeChannel(ch) }
  }, [id, load, me])

  async function reply(d: Draft, progress: (n: number) => void) {
    let path: string | null = null
    if (d.file) { path = imagePath(`public/${me}`, d.file); await uploadImage(path, d.file, progress) }
    const { data, error } = await supabase.from('thread_replies').insert({ thread_id: id, user_id: me, body: d.body, image_path: path }).select().single()
    if (error) throw new Error(/row-level security/i.test(error.message) ? 'You cannot reply (locked thread, muted, or banned).' : error.message)
    const r = data as Reply; if (!seen.current.has(r.id)) { seen.current.add(r.id); setReplies(a => [...a, r]) }; play('send')
  }
  const revoke = async (kind: 'thread' | 'reply', cid: string) => { const { error } = await supabase.rpc('revoke_content', { kind, cid }); if (error) setErr(error.message); else if (kind === 'thread') void load() }
  const del = async () => {
    if (!confirm('Delete this thread and all its replies permanently?')) return
    const { error } = await supabase.rpc('delete_thread', { tid: id })
    if (error) setErr(error.message); else { play('click'); back() }
  }
  const report = async (kind: 'thread' | 'reply', target: string) => { const reason = prompt('Why are you reporting this?'); if (!reason) return
    const { error } = await supabase.from('reports').insert({ reporter_id: me, kind, target_id: target, reason: reason.slice(0, 300) }); setErr(error ? error.message : 'Report sent.') }

  if (state === 'loading') return <p className="p-3 text-cyan-300">Loading…</p>
  if (state === 'gone' || !t) return <div className="p-3"><p>This thread no longer exists.</p><button className="btn mt-2" onClick={back}>BACK</button></div>
  const op = who(t.user_id)
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 p-2 border-b-4 border-black">
        <button className="btn btn-sm btn-alt" onClick={back}>BACK</button><span className="flex-1" />
        {(t.user_id === me || mod) && <button className="btn btn-sm btn-danger" onClick={() => void del()}>DELETE</button>}
        {mod && <><button className="btn btn-sm" onClick={() => void supabase.rpc('thread_moderate', { tid: id, set_pinned: !t.pinned, set_locked: null })}>{t.pinned ? 'UNPIN' : 'PIN'}</button>
          <button className="btn btn-sm" onClick={() => void supabase.rpc('thread_moderate', { tid: id, set_pinned: null, set_locked: !t.locked })}>{t.locked ? 'UNLOCK' : 'LOCK'}</button></>}
      </div>
      <div className="flex-1 scroll-y p-3 flex flex-col gap-3">
        <article className="panel p-3 flex flex-col gap-2">
          {t.revoked ? <p className="italic text-emerald-200">[this thread was revoked]</p> : <>
            <h2 className="text-2xl break-words">{t.title}</h2>
            <p className="whitespace-pre-wrap break-words">{t.body}</p>{t.image_path && <Img path={t.image_path} />}</>}
          <div className="text-sm text-emerald-200 flex gap-2 items-center flex-wrap"><span className="truncate max-w-[10rem]">{op.username}</span><RoleBadge role={op.role} /><span>{when(t.created_at)}</span>
            {!t.revoked && (t.user_id === me || mod) && <button className="underline" onClick={() => void revoke('thread', t.id)}>{t.user_id === me ? 'revoke' : 'remove (mod)'}</button>}
            {!t.revoked && t.user_id !== me && <button className="underline" onClick={() => void report('thread', t.id)}>report</button>}</div>
        </article>
        {replies.map(r => { const p = who(r.user_id); return <div key={r.id} className={'panel p-2 ml-3 sm:ml-8 flex flex-col gap-1' + (r.revoked ? ' opacity-60' : '')}>
          {r.revoked ? <p className="italic text-emerald-200">reply revoked</p> : <><p className="whitespace-pre-wrap break-words">{r.body}</p>{r.image_path && <Img path={r.image_path} />}</>}
          <div className="text-sm text-emerald-200 flex gap-2 items-center flex-wrap"><span className="truncate max-w-[10rem]">{p.username}</span><RoleBadge role={p.role} /><span>{when(r.created_at)}</span>
            {!r.revoked && (r.user_id === me || mod) && <button className="underline" onClick={() => void revoke('reply', r.id)}>{r.user_id === me ? 'revoke' : 'remove (mod)'}</button>}
            {!r.revoked && r.user_id !== me && <button className="underline" onClick={() => void report('reply', r.id)}>report</button>}</div></div> })}
        {err && <p role="alert" className="text-pink-300">{err}</p>}
      </div>
      {t.locked || t.revoked ? <p className="p-3 text-yellow-300 border-t-4 border-black">This thread is closed to replies.</p> : <Composer onSend={reply} placeholder="Write a reply…" maxLen={3000} />}
    </div>
  )
}
