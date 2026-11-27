import { ChangeEvent, useEffect, useState } from 'react'
import { supabase, rawUrl } from '../lib/supabase'
import { useAuth } from '../auth'
import { invalidateProfile } from '../lib/profiles'
import { USERNAME_RE } from '../lib/identity'
import RoleBadge from '../components/RoleBadge'
import { setSound, soundEnabled, onSoundChange } from '../lib/sfx'

export default function Profile() {
  const { profile, refresh } = useAuth()
  const [name, setName] = useState(profile?.username ?? ''); const [bio, setBio] = useState(profile?.bio ?? ''); const [msg, setMsg] = useState('')
  const [snd, setSnd] = useState(soundEnabled())
  useEffect(() => onSoundChange(() => setSnd(soundEnabled())), [])
  useEffect(() => { setName(profile?.username ?? ''); setBio(profile?.bio ?? '') }, [profile])
  if (!profile) return <p className="p-3">Loading…</p>
  async function save() {
    if (!USERNAME_RE.test(name)) { setMsg('Username: 3-20 letters, numbers or _'); return }
    const { error } = await supabase.from('profiles').update({ username: name, bio: bio.trim() || null }).eq('id', profile!.id)
    setMsg(error ? (/duplicate|unique/i.test(error.message) ? 'That username is taken' : error.message) : 'Saved'); invalidateProfile(profile!.id); refresh()
  }
  async function avatar(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type) || f.size > 2 * 1024 * 1024) { setMsg('Avatar: PNG/JPG/WEBP up to 2 MB'); return }
    const path = `${profile!.id}/avatar-${Date.now()}.${f.type.split('/')[1].replace('jpeg', 'jpg')}`
    const up = await supabase.storage.from('avatars').upload(path, f, { upsert: true }); if (up.error) { setMsg(up.error.message); return }
    const url = `${rawUrl}/storage/v1/object/public/avatars/${path}`
    await supabase.from('profiles').update({ avatar_url: url }).eq('id', profile!.id); invalidateProfile(profile!.id); refresh(); setMsg('Avatar updated')
  }
  return <div className="p-3 scroll-y h-full"><section className="panel p-4 flex flex-col gap-3 max-w-lg mx-auto">
    <div className="flex items-center gap-3">
      {profile.avatar_url ? <img src={profile.avatar_url} alt="" className="w-16 h-16 object-cover border-4 border-black" style={{ imageRendering: 'pixelated' }} /> : <div className="w-16 h-16 border-4 border-black bg-[#1a7a4c] grid place-items-center font-pixel text-xl">{profile.username[0]?.toUpperCase()}</div>}
      <div className="min-w-0"><div className="text-2xl truncate">{profile.username}</div><RoleBadge role={profile.role} /></div></div>
    <label className="lbl">AVATAR</label><input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => void avatar(e)} className="text-sm max-w-full" />
    <label className="lbl" htmlFor="un">USERNAME</label><input id="un" className="inp" value={name} maxLength={20} onChange={e => setName(e.target.value)} />
    <label className="lbl" htmlFor="bio">BIO</label><textarea id="bio" className="inp" rows={3} maxLength={300} value={bio} onChange={e => setBio(e.target.value)} />
    <label className="flex items-center gap-2"><input type="checkbox" checked={snd} onChange={e => setSound(e.target.checked)} className="w-5 h-5" /> Sound effects</label>
    {msg && <p role="status" className="text-cyan-300">{msg}</p>}
    <div className="flex gap-2 flex-wrap"><button className="btn" onClick={() => void save()}>SAVE</button><button className="btn btn-alt" onClick={() => void supabase.auth.signOut()}>LOG OUT</button></div>
  </section></div>
}
