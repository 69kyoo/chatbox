import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth'

type N = { id: string; kind: string; text: string; link: string | null; read: boolean; created_at: string }
export default function Notifications({ go }: { go: (link: string) => void }) {
  const { session } = useAuth(); const me = session!.user.id
  const [rows, setRows] = useState<N[]>([]); const [loading, setLoading] = useState(true)
  const load = useCallback(async () => { const { data } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50); setRows((data ?? []) as N[]); setLoading(false) }, [])
  useEffect(() => {
    void load()
    const ch = supabase.channel('notif-page:' + me).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${me}` }, () => void load()).subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [load, me])
  async function readAll() { await supabase.from('notifications').update({ read: true }).eq('user_id', me).eq('read', false); void load() }
  return <div className="p-3 flex flex-col gap-2 scroll-y h-full">
    <button className="btn btn-sm self-start" onClick={() => void readAll()}>MARK ALL READ</button>
    {loading && <p className="text-cyan-300">Loading…</p>}
    {!loading && rows.length === 0 && <p className="text-emerald-200">Nothing yet.</p>}
    {rows.map(n => <button key={n.id} className={'panel p-2 text-left break-words ' + (n.read ? 'opacity-60' : '')}
      onClick={async () => { await supabase.from('notifications').update({ read: true }).eq('id', n.id); if (n.link) go(n.link); void load() }}>
      {n.text}<div className="text-sm text-emerald-200">{new Date(n.created_at).toLocaleString()}</div></button>)}
  </div>
}
