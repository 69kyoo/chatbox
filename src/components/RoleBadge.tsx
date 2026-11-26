import type { Role } from '../auth'
const S: Record<Role, [string, string] | null> = { owner: ['OWNER', '#ff4d4d'], admin: ['ADMIN', '#ff9f1c'], moderator: ['MOD', '#3ddc97'], member: null }
// Members get no badge (less clutter); staff get one small badge.
export default function RoleBadge({ role }: { role: Role }) {
  const s = S[role]; if (!s) return null
  return <span className="badge shrink-0" style={{ background: s[1] }}>{s[0]}</span>
}
