-- CHATKARI 004: per-user site themes. Idempotent. Run in Supabase SQL Editor.
-- Themes: christmas (default), outside, kitty, nyc, horror.
-- 'horror' can ONLY be applied by an owner/admin (to anyone, incl. themselves). When staff apply it, it is LOCKED on the target
-- until staff set another theme. Clients never write these columns directly (no column grant); only the RPCs below can.

alter table public.profiles add column if not exists theme text not null default 'christmas';
alter table public.profiles add column if not exists theme_locked boolean not null default false;
alter table public.profiles drop constraint if exists profiles_theme_chk;
alter table public.profiles add constraint profiles_theme_chk check (theme in ('christmas','outside','kitty','nyc','horror'));

-- A user changes THEIR OWN theme. Horror is staff-only; a staff-locked theme can't be changed by the user.
create or replace function public.set_my_theme(t text) returns text
language plpgsql security definer set search_path = public as $$
declare me profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if t not in ('christmas','outside','kitty','nyc','horror') then raise exception 'Unknown theme'; end if;
  select * into me from profiles where id = auth.uid();
  if me.banned then raise exception 'Not allowed'; end if;
  if me.theme_locked and me.role not in ('owner','admin') then raise exception 'Your theme was set by staff'; end if;
  if t = 'horror' and me.role not in ('owner','admin') then raise exception 'Horror theme is staff only'; end if;
  update profiles set theme = t, theme_locked = false where id = auth.uid();
  return t;
end $$;
revoke all on function public.set_my_theme(text) from public, anon;
grant execute on function public.set_my_theme(text) to authenticated;

-- Staff (owner/admin) set ANYONE's theme. Only the owner may change the owner's theme. Horror => locked on the target.
create or replace function public.admin_set_theme(target uuid, t text) returns text
language plpgsql security definer set search_path = public as $$
declare me profiles%rowtype; tr profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if t not in ('christmas','outside','kitty','nyc','horror') then raise exception 'Unknown theme'; end if;
  select * into me from profiles where id = auth.uid();
  if me.banned or me.role not in ('owner','admin') then raise exception 'Owner or admin only'; end if;
  select * into tr from profiles where id = target;
  if tr.id is null then raise exception 'User not found'; end if;
  if tr.role = 'owner' and me.role <> 'owner' then raise exception 'Only the owner can change the owner''s theme'; end if;
  update profiles set theme = t, theme_locked = (t = 'horror' and target <> auth.uid()) where id = target;
  insert into mod_logs (actor_id, action, target_id, details) values (auth.uid(), 'set_theme', target, jsonb_build_object('theme', t));
  return t;
end $$;
revoke all on function public.admin_set_theme(uuid, text) from public, anon;
grant execute on function public.admin_set_theme(uuid, text) to authenticated;
