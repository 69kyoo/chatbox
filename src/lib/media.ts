import { supabase, rawUrl, rawKey } from './supabase'

export const MAX_BYTES = 5 * 1024 * 1024
export const OK_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

export function checkImage(f: File): string | null {
  if (!OK_TYPES.includes(f.type)) return 'Unsupported format. Use PNG, JPG, WEBP or GIF.'
  if (f.size > MAX_BYTES) return 'Image is too large (max 5 MB).'
  return null
}

// Upload with real progress (XHR) to the private chat-images bucket. Storage policies re-validate path + membership + mute server-side.
export async function uploadImage(path: string, f: File, onProgress: (pct: number) => void): Promise<void> {
  const err = checkImage(f); if (err) throw new Error(err)
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token; if (!token) throw new Error('Not signed in')
  await new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest()
    x.open('POST', `${rawUrl}/storage/v1/object/chat-images/${path.split('/').map(encodeURIComponent).join('/')}`)
    x.setRequestHeader('Authorization', `Bearer ${token}`); x.setRequestHeader('apikey', rawKey)
    x.setRequestHeader('Content-Type', f.type); x.setRequestHeader('x-upsert', 'false')
    x.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100)) }
    x.onload = () => x.status < 300 ? resolve() : reject(new Error(x.status === 403 ? 'Upload refused (are you muted or not a member?)' : 'Upload failed'))
    x.onerror = () => reject(new Error('Network error during upload'))
    x.send(f)
  })
}
export const imagePath = (scope: string, f: File) => `${scope}/${crypto.randomUUID()}.${f.type.split('/')[1].replace('jpeg', 'jpg')}`

const cache = new Map<string, { url: string; exp: number }>()
export async function signedUrl(path: string): Promise<string | null> {
  const c = cache.get(path); if (c && c.exp > Date.now()) return c.url
  const { data, error } = await supabase.storage.from('chat-images').createSignedUrl(path, 3600)
  if (error || !data) return null
  cache.set(path, { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 }); return data.signedUrl
}
