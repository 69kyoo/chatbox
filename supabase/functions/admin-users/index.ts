// Edge Function: create / delete users for the admin panel. The service-role key lives ONLY here (auto-injected by Supabase).
// Deploy:  supabase functions deploy admin-users
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DOMAIN = 'chatkari.example.com' // internal identifier only; MUST match src/lib/identity.ts
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: u } = await caller.auth.getUser()
    if (!u.user) return json({ error: 'Not signed in' }, 401)
    const { data: perms } = await caller.rpc('my_permissions')
    const has = (k: string) => Array.isArray(perms) && perms.includes(k)
    const body = await req.json()

    if (body.action === 'create') {
      if (!has('user.create')) return json({ error: 'Not allowed' }, 403)
      const username = String(body.username ?? ''), password = String(body.password ?? '')
      if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return json({ error: 'Invalid username' }, 400)
      if (password.length < 8) return json({ error: 'Password needs at least 8 characters' }, 400)
      const { data, error } = await admin.auth.admin.createUser({
        email: `${username.toLowerCase()}@${DOMAIN}`, password, email_confirm: true, user_metadata: { username } })
      if (error) return json({ error: error.message }, 400)
      await admin.from('mod_logs').insert({ actor_id: u.user.id, action: 'create_user', target_id: data.user.id })
      return json({ ok: true, id: data.user.id })
    }
    if (body.action === 'delete') {
      if (!has('user.delete')) return json({ error: 'Not allowed' }, 403)
      const target = String(body.id ?? '')
      const { data: p } = await admin.from('profiles').select('role').eq('id', target).single()
      if (!p) return json({ error: 'No such user' }, 404)
      if (p.role === 'owner') return json({ error: 'The owner account is protected' }, 403)
      const { error } = await admin.auth.admin.deleteUser(target)
      if (error) return json({ error: error.message }, 400)
      await admin.from('mod_logs').insert({ actor_id: u.user.id, action: 'delete_user', details: { id: target } })
      return json({ ok: true })
    }
    return json({ error: 'Unknown action' }, 400)
  } catch (e) { return json({ error: (e as Error).message }, 500) }
})
