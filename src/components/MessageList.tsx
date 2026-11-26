import { useEffect, useRef } from 'react'
import { useAuth } from '../auth'
import { useProfiles } from '../lib/profiles'
import RoleBadge from './RoleBadge'
import Img from './Img'

export type Msg = { id: string; user_id: string; body: string; image_path: string | null; revoked: boolean; revoked_by: string | null; created_at: string; system?: boolean }
const time = (s: string) => new Date(s).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })

export function MessageBubble({ m, name, role, mine, canMod, onRevoke, onReport }:
  { m: Msg; name: string; role: 'owner' | 'admin' | 'moderator' | 'member'; mine: boolean; canMod: boolean; onRevoke: () => void; onReport?: () => void }) {
  if (m.revoked) return <div className={'flex ' + (mine ? 'justify-end' : '')}><div className="bubble gone text-base">message revoked{m.revoked_by && m.revoked_by !== m.user_id ? ' by moderator' : ''}</div></div>
  return (
    <div className={'flex flex-col ' + (mine ? 'items-end' : 'items-start')}>
      <div className="flex items-center gap-2 text-sm text-violet-200 max-w-full">
        <span className="truncate max-w-[12rem]">{mine ? 'you' : name}</span><RoleBadge role={role} /><span className="shrink-0">{time(m.created_at)}</span>
      </div>
      <div className={'bubble ' + (mine ? 'me' : 'them')}>
        {m.body}
        {m.image_path && <Img path={m.image_path} />}
      </div>
      <div className="flex gap-3 text-sm text-violet-300">
        {(mine || canMod) && <button className="underline" onClick={onRevoke}>{mine ? 'revoke' : 'remove (mod)'}</button>}
        {!mine && onReport && <button className="underline" onClick={onReport}>report</button>}
      </div>
    </div>
  )
}

export default function MessageList({ msgs, canMod, onRevoke, onReport, empty = 'No messages yet. Say hi!' }:
  { msgs: Msg[]; canMod: boolean; onRevoke: (m: Msg) => void; onReport?: (m: Msg) => void; empty?: string }) {
  const { session } = useAuth(); const me = session?.user.id
  const who = useProfiles([...new Set(msgs.map(m => m.user_id))])
  const bottom = useRef<HTMLDivElement>(null); const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useEffect(() => { if (stick.current) bottom.current?.scrollIntoView({ block: 'end' }) }, [msgs])
  return (
    <div ref={box} className="flex-1 scroll-y p-3 flex flex-col gap-3" onScroll={e => { const t = e.currentTarget; stick.current = t.scrollHeight - t.scrollTop - t.clientHeight < 80 }}>
      {msgs.length === 0 && <p className="text-violet-300 text-center mt-8">{empty}</p>}
      {msgs.map(m => {
        if (m.system) return <p key={m.id} className="text-center text-cyan-300 text-base">{m.body}</p>
        const p = who(m.user_id)
        return <MessageBubble key={m.id} m={m} name={p.username} role={p.role} mine={m.user_id === me} canMod={canMod} onRevoke={() => onRevoke(m)} onReport={onReport && (() => onReport(m))} />
      })}
      <div ref={bottom} />
    </div>
  )
}
