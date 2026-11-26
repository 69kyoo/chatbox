import { createClient } from '@supabase/supabase-js'

// GitHub Actions passes an EMPTY STRING (not undefined) when a repo variable is missing,
// so we must use || (not ??) and validate the URL before calling createClient.
export const rawUrl = ((import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '').trim()
export const rawKey = ((import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? '').trim()

function validUrl(u: string) {
  try { const p = new URL(u); return p.protocol === 'https:' || p.protocol === 'http:' } catch { return false }
}

export const configured = validUrl(rawUrl) && rawKey.length > 0

// Never throw at import time: a throw here = blank page.
export const supabase = createClient(
  configured ? rawUrl : 'http://localhost',
  configured ? rawKey : 'missing',
  { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }
)
