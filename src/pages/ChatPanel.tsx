import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth'
import MessageList, { Msg } from '../components/MessageList'
import Composer, { Draft } from '../components/Composer'
import { imagePath, uploadImage } from '../lib/media'
import { play } from '../lib/sfx'
import { emitWorld } from '../lib/bus'

// One component for BOTH public chat (table 'messages') and private rooms (table 'room_messages').
export default function ChatPanel({ roomId, onUnread }: { roomId?: string; onUnread?: () => void }) {
  const { session, can } = useAuth(); const me = session!.user.id
  const table = roomId ? 'room_messages' : 'messages'
  const [msgs, setMsgs] = useState<Msg[]>([]); const [state, setState] = useState<'loading' | 'ready' | 'error' | 'offline'>('loading')
  const [sys, setSys] = useState<Msg[]>([])
  const seen = useRef(new Set<string>())

  const load = useCallback(async () => {
    let q = supabase.from(table).select('*').order('created_at', { ascending: false }).limit(100)
    if (roomId) q = q.eq('room_id', roomId)
    const { data, error } = await q
    if (error) { setState('error'); return }
    const rows = (data as Msg[]).reverse(); seen.current = new Set(rows.map(r => r.id)); setMsgs(rows); setState('ready')
  }, [table, roomId])

  useEffect(() => {
    setState('loading'); setMsgs([]); setSys([]); void load()
    const ch = supabase.channel(`${table}:${roomId ?? 'public'}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table, ...(roomId ? { filter: `room_id=eq.${roomId}` } : {}) }, p => {
        const m = p.new as Msg
        if (seen.current.has(m.id)) return; seen.current.add(m.id)
        setMsgs(a => [...a, m])
        if (m.user_id !== me) { play('receive'); emitWorld('receive'); onUnread?.() }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table, ...(roomId ? { filter: `room_id=eq.${roomId}` } : {}) }, p => {
        const m = p.new as Msg; setMsgs(a => a.map(x => x.id === m.id ? m : x))
      })
      .subscribe(st => {
        if (st === 'SUBSCRIBED') { setState(s => s === 'offline' ? 'ready' : s); void load() }   // re-sync after a dropped connection
        if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') setState(s => s === 'ready' ? 'offline' : s)
      })
    return () => { void supabase.removeChannel(ch) }
  }, [table, roomId, load, me, onUnread])

  const note = (text: string) => setSys(a => [...a.slice(-4), { id: crypto.randomUUID(), user_id: me, body: text, image_path: null, revoked: false, revoked_by: null, created_at: new Date().toISOString(), system: true }])

  async function send(d: Draft, progress: (n: number) => void) {
    if (!roomId && d.body.startsWith('/')) {                // moderation commands are parsed + authorised in the database
      const { data, error } = await supabase.rpc('run_command', { cmd: d.body })
      if (error) throw new Error(error.message); note(String(data)); play('notify'); return
    }
    let path: string | null = null
    if (d.file) { path = roomId ? `rooms/${roomId}/${me}/` : `public/${me}/`; path = imagePath(path.replace(/\/$/, ''), d.file); await uploadImage(path, d.file, progress) }
    const row = roomId ? { room_id: roomId, user_id: me, body: d.body, image_path: path } : { user_id: me, body: d.body, image_path: path }
    const { data, error } = await supabase.from(table).insert(row).select().single()
    if (error) throw new Error(/row-level security/i.test(error.message) ? 'You cannot post right now (muted, banned, or not a member).' : error.message)
    const m = data as Msg; if (!seen.current.has(m.id)) { seen.current.add(m.id); setMsgs(a => [...a, m]) }
    play('send'); emitWorld('send')
  }
  async function revoke(m: Msg) {
    const { error } = await supabase.rpc('revoke_content', { kind: roomId ? 'room_message' : 'message', cid: m.id })
    if (error) note(error.message)
  }
  async function report(m: Msg) {
    const reason = prompt('Why are you reporting this message?'); if (!reason) return
    const { error } = await supabase.from('reports').insert({ reporter_id: me, kind: 'message', target_id: m.id, reason: reason.slice(0, 300) })
    note(error ? error.message : 'Report sent to moderators.')
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {state === 'loading' && <p className="p-3 text-cyan-300">Loading…</p>}
      {state === 'error' && <p role="alert" className="p-3 text-pink-300">Could not load messages. <button className="underline" onClick={() => { setState('loading'); void load() }}>retry</button></p>}
      {state === 'offline' && <p role="status" className="px-3 py-1 bg-yellow-300 text-black text-base">Connection lost, reconnecting…</p>}
      <MessageList msgs={[...msgs, ...sys]} canMod={!roomId && can('chat.moderate')} onRevoke={revoke} onReport={roomId ? undefined : report} />
      <Composer onSend={send} placeholder={!roomId && (can('chat.mute')) ? 'Message… (/mute name 5m, /unmute name)' : 'Type a message…'} />
    </div>
  )
}
