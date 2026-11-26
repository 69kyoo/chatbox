import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth'
import { play } from '../lib/sfx'
import { emitWorld } from '../lib/bus'

type A = { id: string; target_id: string | null; title: string; body: string; created_at: string }
const KEY = 'ck_alerts_seen'
const seenSet = () => { try { return new Set<string>(JSON.parse(localStorage.getItem(KEY) ?? '[]')) } catch { return new Set<string>() } }
export default function AlertOverlay() {
  const { session } = useAuth(); const me = session!.user.id
  const [queue, setQueue] = useState<A[]>([])
  useEffect(() => {
    const mine = (a: A) => a.target_id === me || a.target_id === null   // owner can read all alerts via RLS; only show those meant for me
    const push = (a: A) => { if (!mine(a) || seenSet().has(a.id)) return; setQueue(q => q.some(x => x.id === a.id) ? q : [...q, a]); play('alert'); emitWorld('alert') }
    // catch alerts that arrived while offline (last 10 minutes)
    void supabase.from('alerts').select('*').gt('created_at', new Date(Date.now() - 600000).toISOString()).order('created_at').then(({ data }) => (data as A[] | null)?.forEach(push))
    const ch = supabase.channel('alerts:' + me).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts' }, p => push(p.new as A)).subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [me])
  const a = queue[0]; if (!a) return null
  const dismiss = () => { const s = seenSet(); s.add(a.id); try { localStorage.setItem(KEY, JSON.stringify([...s].slice(-50))) } catch { /* ignore */ } setQueue(q => q.slice(1)); play('click') }
  return <div className="alert-overlay" role="alertdialog" aria-modal="true" aria-label={a.title}>
    <div className="panel alert-box w-full max-w-lg p-5 flex flex-col gap-4 text-center max-h-full overflow-y-auto">
      <h2 className="font-pixel text-yellow-300 alert-flash px-2 py-3 border-4 border-black break-words" style={{ fontSize: 'clamp(.9rem,5vw,1.6rem)', lineHeight: 1.3 }}>{a.title}</h2>
      <p className="text-2xl break-words whitespace-pre-wrap">{a.body}</p>
      <button className="btn" autoFocus onClick={dismiss}>OK</button>
    </div></div>
}
