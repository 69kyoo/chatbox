import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth'
import Logo from '../components/Logo'
import RoleBadge from '../components/RoleBadge'
import AlertOverlay from '../components/AlertOverlay'
import ChatPanel from './ChatPanel'
import { emitWorld } from '../lib/bus'
import { play, setSound, soundEnabled, onSoundChange } from '../lib/sfx'

const Rooms = lazy(() => import('./Rooms'))
const Threads = lazy(() => import('./Threads'))
const Notifications = lazy(() => import('./Notifications'))
const Profile = lazy(() => import('./Profile'))
const Settings = lazy(() => import('./Settings'))
const Admin = lazy(() => import('./Admin'))
const Game = lazy(() => import('./Game'))
type Tab = 'chat' | 'rooms' | 'threads' | 'notifs' | 'game' | 'profile' | 'settings' | 'admin'

export default function Lobby() {
  const { profile, session, can } = useAuth(); const me = session!.user.id
  const [tab, setTab] = useState<Tab>('chat'); const [openThread, setOpenThread] = useState<string | null>(null)
  const [unreadChat, setUnreadChat] = useState(0); const [unreadN, setUnreadN] = useState(0); const [toast, setToast] = useState('')
  const [snd, setSnd] = useState(soundEnabled()); const tabRef = useRef(tab); tabRef.current = tab
  useEffect(() => onSoundChange(() => setSnd(soundEnabled())), [])

  const go = useCallback((t: Tab) => { play('click'); emitWorld('nav'); setTab(t); if (t === 'chat') setUnreadChat(0) }, [])
  const onUnread = useCallback(() => { if (tabRef.current !== 'chat') setUnreadChat(n => n + 1) }, [])

  // Background public-chat counter while on another tab + notification toasts
  useEffect(() => {
    const ch = supabase.channel('lobby:' + me)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, p => { if (tabRef.current !== 'chat' && (p.new as { user_id: string }).user_id !== me) { setUnreadChat(n => n + 1); play('receive') } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${me}` }, p => { setUnreadN(n => n + 1); setToast((p.new as { text: string }).text); play('notify'); setTimeout(() => setToast(''), 4000) })
      .subscribe()
    void supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('read', false).then(({ count }) => setUnreadN(count ?? 0))
    return () => { void supabase.removeChannel(ch) }
  }, [me])
  useEffect(() => { if (tab === 'notifs') setUnreadN(0) }, [tab])

  function link(l: string) { if (l.startsWith('thread:')) { setOpenThread(l.slice(7)); go('threads') } else if (l.startsWith('room:')) go('rooms') }
  const isStaff = !!profile && (profile.role !== 'member' || can('user.manage') || can('chat.mute') || can('report.manage') || can('audit.view'))
  const tabs: [Tab, string, number][] = [['chat', 'PUBLIC', unreadChat], ['rooms', 'ROOMS', 0], ['threads', 'THREADS', 0], ['notifs', 'ALERTS', unreadN], ['game', 'GAME', 0], ['profile', 'ME', 0], ['settings', 'SETTINGS', 0]]
  if (isStaff) tabs.push(['admin', 'ADMIN', 0])

  if (profile?.banned) return <main className="p-6"><div className="panel p-5 max-w-md mx-auto"><h2 className="font-pixel text-xs text-yellow-300 mb-2">BANNED</h2><p>This account has been banned.</p><button className="btn mt-3" onClick={() => void supabase.auth.signOut()}>LOG OUT</button></div></main>

  return (
    <div className="flex flex-col h-full max-w-3xl w-full mx-auto">
      <header className="flex items-center gap-2 px-3 pt-2 pb-1">
        <Logo small /><span className="flex-1" />
        <span className="truncate max-w-[8rem] text-lg">{profile?.username}</span>{profile && <RoleBadge role={profile.role} />}
        <button className="btn btn-sm btn-alt" aria-label={snd ? 'Mute sounds' : 'Enable sounds'} onClick={() => { setSound(!snd); if (!snd) setTimeout(() => play('click'), 50) }}>{snd ? 'SND' : 'OFF'}</button>
      </header>
      <nav className="flex gap-1 px-2 overflow-x-auto" aria-label="Sections">
        {tabs.map(([k, l, n]) => <button key={k} className="tab" aria-current={tab === k ? 'page' : undefined} onClick={() => go(k)}>{l}{n > 0 && <span className="dot">{n > 9 ? '9+' : n}</span>}</button>)}
      </nav>
      <main className="panel flex-1 min-h-0 m-2 mb-[max(.5rem,env(safe-area-inset-bottom))] overflow-hidden">
        <Suspense fallback={<p className="p-3 text-cyan-300">Loading…</p>}>
          {tab === 'chat' && <ChatPanel onUnread={onUnread} />}
          {tab === 'rooms' && <Rooms />}
          {tab === 'threads' && <Threads openId={openThread} />}
          {tab === 'notifs' && <Notifications go={link} />}
          {tab === 'game' && <Game />}
          {tab === 'profile' && <Profile />}
          {tab === 'settings' && <Settings />}
          {tab === 'admin' && <Admin />}
        </Suspense>
      </main>
      {toast && <div className="toast panel px-3 py-2" role="status">{toast}</div>}
      <AlertOverlay />
    </div>
  )
}
