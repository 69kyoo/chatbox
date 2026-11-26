import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth'
import { useProfiles } from '../lib/profiles'
import ChatPanel from './ChatPanel'
import RoleBadge from '../components/RoleBadge'
import { play } from '../lib/sfx'
import { emitWorld } from '../lib/bus'

type Room = { id: string; name: string; owner_id: string; is_member: boolean; created_at: string }
type Member = { user_id: string }

export default function Rooms() {
  const { session, can } = useAuth(); const me = session!.user.id
  const [rooms, setRooms] = useState<Room[]>([]); const [sel, setSel] = useState<Room | null>(null)
  const [name, setName] = useState(''); const [err, setErr] = useState(''); const [loading, setLoading] = useState(true)
  const [showMembers, setShowMembers] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_rooms')
    if (error) setErr(error.message); else setRooms(data as Room[]); setLoading(false)
  }, [])
  useEffect(() => {
    void load()
    const ch = supabase.channel('rooms-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members' }, () => void load()).subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [load])
  useEffect(() => { if (sel && !rooms.find(r => r.id === sel.id)) { setSel(null); emitWorld('close') } }, [rooms, sel])

  async function create() {
    if (name.trim().length < 1) return
    const { data, error } = await supabase.rpc('create_room', { room_name: name }); if (error) { setErr(error.message); play('error'); return }
    setName(''); setErr(''); await load(); play('open'); emitWorld('open'); void data
  }
  const open = (r: Room) => { play('open'); emitWorld('open'); setSel(r); setShowMembers(false) }

  if (sel) return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 p-2 border-b-4 border-black">
        <button className="btn btn-sm btn-alt" onClick={() => { setSel(null); emitWorld('close'); play('click') }}>BACK</button>
        <h2 className="font-pixel text-[.65rem] truncate flex-1">{sel.name}</h2>
        {!sel.is_member && can('room.inspect') && <button className="btn btn-sm btn-alt" onClick={async () => { await supabase.rpc('join_room_visibly', { rid: sel.id }); void load() }}>JOIN VISIBLY</button>}
        <button className="btn btn-sm" onClick={() => setShowMembers(s => !s)}>MEMBERS</button>
      </div>
      {!sel.is_member && can('room.inspect') && <p className="px-3 py-1 bg-[#3b2a9a] text-base">Read-only inspection. You are not shown as a member and cannot post unless you join visibly.</p>}
      {showMembers && <Members room={sel} isOwner={sel.owner_id === me} onChanged={load} />}
      <div className="flex-1 min-h-0">{sel.is_member ? <ChatPanel roomId={sel.id} /> : <ReadOnly roomId={sel.id} />}</div>
    </div>
  )
  return (
    <div className="p-3 flex flex-col gap-3 scroll-y h-full">
      <div className="flex gap-2"><input className="inp" placeholder="new room name" maxLength={40} value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && void create()} />
        <button className="btn" onClick={() => void create()}>CREATE</button></div>
      {err && <p role="alert" className="text-pink-300">{err}</p>}
      {loading && <p className="text-cyan-300">Loading…</p>}
      {!loading && rooms.length === 0 && <p className="text-violet-300">You are not in any private room yet. Create one, or ask a room owner to invite you.</p>}
      {rooms.map(r => <button key={r.id} onClick={() => open(r)} className="panel p-3 text-left flex items-center gap-2">
        <span className="truncate flex-1 text-xl">{r.name}</span>
        {r.owner_id === me && <span className="badge bg-yellow-300">OWNER</span>}{!r.is_member && <span className="badge bg-cyan-300">INSPECT</span>}</button>)}
    </div>
  )
}

function ReadOnly({ roomId }: { roomId: string }) {
  // Platform owner's invisible view: read messages without a membership row; composer intentionally absent.
  const [rows, setRows] = useState<{ id: string; user_id: string; body: string; revoked: boolean }[]>([])
  useEffect(() => {
    const load = () => void supabase.from('room_messages').select('id,user_id,body,revoked').eq('room_id', roomId).order('created_at').limit(200).then(({ data }) => setRows(data ?? []))
    load(); const ch = supabase.channel('ro:' + roomId).on('postgres_changes', { event: '*', schema: 'public', table: 'room_messages', filter: `room_id=eq.${roomId}` }, load).subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [roomId])
  const who = useProfiles(rows.map(r => r.user_id))
  return <div className="scroll-y h-full p-3 flex flex-col gap-2">{rows.map(r => <div key={r.id} className="bubble them">
    <b>{who(r.user_id).username}: </b>{r.revoked ? <i>revoked</i> : r.body || '[image]'}</div>)}</div>
}

function Members({ room, isOwner, onChanged }: { room: Room; isOwner: boolean; onChanged: () => void }) {
  const [list, setList] = useState<Member[]>([]); const [uname, setUname] = useState(''); const [err, setErr] = useState('')
  const load = useCallback(() => { void supabase.from('room_members').select('user_id').eq('room_id', room.id).then(({ data }) => setList(data ?? [])) }, [room.id])
  useEffect(() => { load() }, [load])
  const who = useProfiles(list.map(l => l.user_id))
  async function add() {
    const { error } = await supabase.rpc('room_add_member', { rid: room.id, member_username: uname.trim() })
    if (error) setErr(error.message); else { setErr(''); setUname(''); load(); play('notify') }
  }
  async function remove(id: string) { const { error } = await supabase.rpc('room_remove_member', { rid: room.id, member: id }); if (error) setErr(error.message); else { load(); onChanged() } }
  return <div className="p-2 border-b-4 border-black bg-[#1b0f4a] max-h-56 scroll-y flex flex-col gap-2">
    {list.map(l => { const p = who(l.user_id); return <div key={l.user_id} className="flex items-center gap-2"><span className="truncate flex-1">{p.username}</span><RoleBadge role={p.role} />
      {l.user_id === room.owner_id ? <span className="badge bg-yellow-300">HOST</span> : (isOwner || l.user_id === room.owner_id) && <button className="btn btn-sm btn-danger" onClick={() => void remove(l.user_id)}>KICK</button>}</div> })}
    {isOwner && <div className="flex gap-2"><input className="inp" placeholder="invite username" value={uname} onChange={e => setUname(e.target.value)} onKeyDown={e => e.key === 'Enter' && void add()} /><button className="btn btn-sm" onClick={() => void add()}>ADD</button></div>}
    {isOwner && <button className="btn btn-sm btn-danger self-start" onClick={async () => { if (confirm('Delete this room and all its messages?')) { await supabase.rpc('delete_room', { rid: room.id }); onChanged() } }}>DELETE ROOM</button>}
    {!isOwner && <button className="btn btn-sm btn-alt self-start" onClick={async () => { const me = (await supabase.auth.getUser()).data.user!.id; await remove(me) }}>LEAVE</button>}
    {err && <p role="alert" className="text-pink-300">{err}</p>}
  </div>
}
