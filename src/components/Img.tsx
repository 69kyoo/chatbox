import { useEffect, useState } from 'react'
import { signedUrl } from '../lib/media'
export default function Img({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null); const [bad, setBad] = useState(false); const [big, setBig] = useState(false)
  useEffect(() => { let dead = false; void signedUrl(path).then(u => { if (!dead) { if (u) setUrl(u); else setBad(true) } }); return () => { dead = true } }, [path])
  if (bad) return <div className="text-pink-300 text-base">[image unavailable]</div>
  if (!url) return <div className="h-20 w-32 border-2 border-dashed border-emerald-600 text-sm grid place-items-center">loading…</div>
  return <>
    <img src={url} alt="attachment" loading="lazy" className="msg-img" onClick={() => setBig(true)} onError={() => setBad(true)} />
    {big && <div role="dialog" aria-label="Image" className="alert-overlay" onClick={() => setBig(false)}><img src={url} alt="attachment" className="max-w-full max-h-full border-4 border-black" /></div>}
  </>
}
