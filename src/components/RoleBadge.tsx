import type { Role } from '../auth'
const S: Record<Role, [string, string]> = { owner: ['OWNER', '#ff4d4d'], admin: ['ADMIN', '#ff9f1c'], moderator: ['MOD', '#3ddc97'], member: ['MEMBER', '#9ab'] }
export default function RoleBadge({ role }: { role: Role }) {
  return <span className="badge" style={{ background: S[role][1] }}>{S[role][0]}</span>
}
