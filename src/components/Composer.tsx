import { FormEvent, useEffect, useRef, useState } from 'react'
import { checkImage } from '../lib/media'
import { play } from '../lib/sfx'
import { useAuth } from '../auth'

export type Draft = { body: string; file: File | null }
// Text box + image picker with preview, progress and error display. Blocks double submits. Muted users see a banner,
// but enforcement is in the database (RLS), not here.
export default function Composer({ onSend, placeholder = 'Type a message…', maxLen = 2000, allowEmpty = false }:
  { onSend: (d: Draft, progress: (n: number) => void) => Promise<void>; placeholder?: string; maxLen?: number; allowEmpty?: boolean }) {
  const { muteUntil } = useAuth()
  const [body, setBody] = useState(''); const [file, setFile] = useState<File | null>(null); const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false); const [pct, setPct] = useState(0); const [err, setErr] = useState('')
  const [now, setNow] = useState(Date.now()); const fileRef = useRef<HTMLInputElement>(null)
  const muted = !!muteUntil && muteUntil.getTime() > now

  useEffect(() => { if (!muteUntil) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [muteUntil])
  useEffect(() => { if (!file) { setPreview(null); return } const u = URL.createObjectURL(file); setPreview(u); return () => URL.revokeObjectURL(u) }, [file])

  function pick(f: File | undefined) {
    if (!f) return; const e = checkImage(f); if (e) { setErr(e); play('error'); return }
    setErr(''); setFile(f)
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || (!body.trim() && !file && !allowEmpty)) return
    setBusy(true); setErr(''); setPct(0)
    try { await onSend({ body: body.trim(), file }, setPct); setBody(''); setFile(null); if (fileRef.current) fileRef.current.value = '' }
    catch (x) { setErr((x as Error).message || 'Could not send'); play('error') }
    finally { setBusy(false); setPct(0) }
  }
  const left = muted ? Math.max(0, Math.ceil((muteUntil!.getTime() - now) / 1000)) : 0
  const fmt = left >= 3600 ? `${Math.floor(left / 3600)}h ${Math.floor(left % 3600 / 60)}m` : left >= 60 ? `${Math.floor(left / 60)}m ${left % 60}s` : `${left}s`

  return (
    <form onSubmit={submit} className="safe-b pt-2 px-2 border-t-4 border-black bg-[#150a3a]">
      {muted && <p role="status" className="text-yellow-300 pb-1">You are muted. Messages are blocked for {fmt}.</p>}
      {err && <p role="alert" className="text-pink-300 pb-1 break-words">{err}</p>}
      {preview && <div className="flex items-center gap-2 pb-2"><img src={preview} alt="preview" className="h-16 w-16 object-cover border-2 border-black" />
        <span className="truncate text-sm flex-1">{file?.name}</span><button type="button" className="btn btn-sm btn-alt" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = '' }}>X</button></div>}
      {busy && file && <div className="h-3 border-2 border-black mb-2" aria-label="Upload progress"><div className="h-full bg-yellow-300" style={{ width: pct + '%' }} /></div>}
      <div className="flex gap-2 items-end">
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={e => pick(e.target.files?.[0])} />
        <button type="button" className="btn btn-alt" aria-label="Attach image" disabled={busy || muted} onClick={() => { play('click'); fileRef.current?.click() }}>IMG</button>
        <textarea className="inp resize-none flex-1 !text-[1.1rem]" rows={1} maxLength={maxLen} value={body} placeholder={muted ? 'Muted' : placeholder} disabled={muted}
          onChange={e => setBody(e.target.value)} enterKeyHint="send"
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} />
        <button className="btn" disabled={busy || muted}>{busy ? '…' : 'SEND'}</button>
      </div>
    </form>
  )
}
