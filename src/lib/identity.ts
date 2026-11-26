// Users only ever type a USERNAME. Supabase Auth needs an email-shaped identifier internally,
// so we derive one deterministically. It is never shown, asked for, or stored in any profile field.
// Must match DOMAIN in supabase/functions/admin-users/index.ts.
const DOMAIN = 'chatkari.example.com'
export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/
export const internalId = (username: string) => `${username.trim().toLowerCase()}@${DOMAIN}`
