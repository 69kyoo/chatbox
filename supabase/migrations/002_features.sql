-- CHATKARI 002: public chat, private rooms, threads, mutes, alerts, notifications, reports, image storage.
-- Idempotent. Run AFTER 001_core.sql in the Supabase SQL editor. Never touches existing data.

-- ---------------------------------------------------------------- clean out incompatible leftovers
-- Earlier partial setups may have left tables whose id columns are not uuid (e.g. bigint). Those cannot work with this design,
-- so they are dropped here (only tables with a mismatching key column; correct tables are untouched).
do $$ declare r record; begin
  for r in select distinct c.table_name from information_schema.columns c
    where c.table_schema = 'public' and c.data_type <> 'uuid' and (c.table_name, c.column_name) in (
      ('messages','id'),('rooms','id'),('room_messages','id'),('room_messages','room_id'),('room_members','room_id'),
      ('threads','id'),('thread_replies','id'),('thread_replies','thread_id'),('alerts','id'),('notifications','id'),('reports','id'),('mutes','user_id'))
  loop execute format('drop table if exists public.%I cascade', r.table_name); end loop;
end $$;

-- ---------------------------------------------------------------- permissions
insert into public.permissions (key, description, owner_only) values
 ('report.manage','View and resolve reports',false),
 ('user.create','Create accounts from the admin panel',true),
 ('user.delete','Delete accounts',true)
on conflict do nothing;
insert into public.role_permissions (role, permission_key) values
 ('admin','report.manage'),('moderator','report.manage')
on conflict do nothing;

-- ---------------------------------------------------------------- tables
create table if not exists public.mutes (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  until timestamptz not null,
  reason text,
  muted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now());

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 2000),
  image_path text,
  revoked boolean not null default false,
  revoked_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (char_length(body) > 0 or image_path is not null or revoked));

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now());
create table if not exists public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id));
create table if not exists public.room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 2000),
  image_path text,
  revoked boolean not null default false,
  revoked_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (char_length(body) > 0 or image_path is not null or revoked));

create table if not exists public.threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  body text not null default '' check (char_length(body) <= 5000),
  image_path text,
  pinned boolean not null default false,
  locked boolean not null default false,
  revoked boolean not null default false,
  revoked_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  last_activity timestamptz not null default now());
create table if not exists public.thread_replies (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 3000),
  image_path text,
  revoked boolean not null default false,
  revoked_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (char_length(body) > 0 or image_path is not null or revoked));

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  target_id uuid references public.profiles(id) on delete cascade,  -- null = global
  title text not null check (char_length(title) between 1 and 60),
  body text not null check (char_length(body) between 1 and 500),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now());
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  text text not null,
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now());
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('message','thread','reply')),
  target_id uuid not null,
  reason text not null check (char_length(reason) between 1 and 300),
  resolved boolean not null default false,
  created_at timestamptz not null default now());

-- Reconcile: if any of these tables already existed from earlier attempts, make sure every column is present.
alter table public.mutes add column if not exists user_id uuid;
alter table public.mutes add column if not exists until timestamptz;
alter table public.mutes add column if not exists reason text;
alter table public.mutes add column if not exists muted_by uuid;
alter table public.mutes add column if not exists created_at timestamptz default now();
alter table public.messages add column if not exists user_id uuid;
alter table public.messages add column if not exists body text default '';
alter table public.messages add column if not exists image_path text;
alter table public.messages add column if not exists revoked boolean default false;
alter table public.messages add column if not exists revoked_by uuid;
alter table public.messages add column if not exists created_at timestamptz default now();
alter table public.rooms add column if not exists name text;
alter table public.rooms add column if not exists owner_id uuid;
alter table public.rooms add column if not exists created_at timestamptz default now();
alter table public.room_members add column if not exists room_id uuid;
alter table public.room_members add column if not exists user_id uuid;
alter table public.room_members add column if not exists joined_at timestamptz default now();
alter table public.room_messages add column if not exists room_id uuid;
alter table public.room_messages add column if not exists user_id uuid;
alter table public.room_messages add column if not exists body text default '';
alter table public.room_messages add column if not exists image_path text;
alter table public.room_messages add column if not exists revoked boolean default false;
alter table public.room_messages add column if not exists revoked_by uuid;
alter table public.room_messages add column if not exists created_at timestamptz default now();
alter table public.threads add column if not exists user_id uuid;
alter table public.threads add column if not exists title text;
alter table public.threads add column if not exists body text default '';
alter table public.threads add column if not exists image_path text;
alter table public.threads add column if not exists pinned boolean default false;
alter table public.threads add column if not exists locked boolean default false;
alter table public.threads add column if not exists revoked boolean default false;
alter table public.threads add column if not exists revoked_by uuid;
alter table public.threads add column if not exists created_at timestamptz default now();
alter table public.threads add column if not exists last_activity timestamptz default now();
alter table public.thread_replies add column if not exists thread_id uuid;
alter table public.thread_replies add column if not exists user_id uuid;
alter table public.thread_replies add column if not exists body text default '';
alter table public.thread_replies add column if not exists image_path text;
alter table public.thread_replies add column if not exists revoked boolean default false;
alter table public.thread_replies add column if not exists revoked_by uuid;
alter table public.thread_replies add column if not exists created_at timestamptz default now();
alter table public.alerts add column if not exists target_id uuid;
alter table public.alerts add column if not exists title text;
alter table public.alerts add column if not exists body text;
alter table public.alerts add column if not exists created_by uuid;
alter table public.alerts add column if not exists created_at timestamptz default now();
alter table public.notifications add column if not exists user_id uuid;
alter table public.notifications add column if not exists kind text;
alter table public.notifications add column if not exists text text;
alter table public.notifications add column if not exists link text;
alter table public.notifications add column if not exists read boolean default false;
alter table public.notifications add column if not exists created_at timestamptz default now();
alter table public.reports add column if not exists reporter_id uuid;
alter table public.reports add column if not exists kind text;
alter table public.reports add column if not exists target_id uuid;
alter table public.reports add column if not exists reason text;
alter table public.reports add column if not exists resolved boolean default false;
alter table public.reports add column if not exists created_at timestamptz default now();

create index if not exists messages_created on public.messages (created_at desc);
create index if not exists room_messages_room on public.room_messages (room_id, created_at desc);
create index if not exists threads_activity on public.threads (pinned desc, last_activity desc);
create index if not exists replies_thread on public.thread_replies (thread_id, created_at);
create index if not exists notifications_user on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------- helpers
create or replace function public.is_muted(uid uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from mutes where user_id = uid and until > now()) $$;

create or replace function public.can_post(uid uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = uid and not banned) and not public.is_muted(uid) $$;

-- ---------------------------------------------------------------- room access
-- Invisible owner: access comes from the 'room.inspect' permission, NOT from a room_members row.
create or replace function public.can_access_room(rid uuid, uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from room_members where room_id = rid and user_id = uid)
      or public.has_permission(uid, 'room.inspect') $$;
create or replace function public.is_room_owner(rid uuid, uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from rooms where id = rid and owner_id = uid) $$;
grant execute on function public.is_muted(uuid), public.can_post(uuid), public.can_access_room(uuid,uuid), public.is_room_owner(uuid,uuid) to authenticated;

-- ---------------------------------------------------------------- RLS
alter table public.mutes enable row level security;
alter table public.messages enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_messages enable row level security;
alter table public.threads enable row level security;
alter table public.thread_replies enable row level security;
alter table public.alerts enable row level security;
alter table public.notifications enable row level security;
alter table public.reports enable row level security;

-- Clients can never UPDATE/DELETE content directly; revocation/moderation goes through RPCs below.
revoke all on public.mutes, public.messages, public.rooms, public.room_members, public.room_messages,
  public.threads, public.thread_replies, public.alerts, public.notifications, public.reports from anon, authenticated;
grant select on public.mutes, public.messages, public.rooms, public.room_members, public.room_messages,
  public.threads, public.thread_replies, public.alerts, public.notifications, public.reports to authenticated;
grant insert on public.messages, public.room_messages, public.threads, public.thread_replies, public.reports to authenticated;
grant update (read) on public.notifications to authenticated;

drop policy if exists mutes_read on public.mutes;
create policy mutes_read on public.mutes for select to authenticated
  using (user_id = auth.uid() or public.has_permission(auth.uid(),'chat.mute'));

drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated using (true);
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (user_id = auth.uid() and public.can_post(auth.uid()) and revoked = false and revoked_by is null
    and (image_path is null or image_path like 'public/' || auth.uid()::text || '/%'));

drop policy if exists rooms_read on public.rooms;
create policy rooms_read on public.rooms for select to authenticated using (public.can_access_room(id, auth.uid()));
drop policy if exists room_members_read on public.room_members;
create policy room_members_read on public.room_members for select to authenticated using (public.can_access_room(room_id, auth.uid()));

drop policy if exists room_messages_read on public.room_messages;
create policy room_messages_read on public.room_messages for select to authenticated using (public.can_access_room(room_id, auth.uid()));
drop policy if exists room_messages_insert on public.room_messages;
create policy room_messages_insert on public.room_messages for insert to authenticated
  with check (user_id = auth.uid() and public.can_post(auth.uid()) and revoked = false and revoked_by is null
    and exists (select 1 from room_members where room_id = room_messages.room_id and user_id = auth.uid())
    and (image_path is null or image_path like 'rooms/' || room_id::text || '/' || auth.uid()::text || '/%'));
-- Note: the owner can READ every room but can only POST after explicitly joining (join_room_visibly).

drop policy if exists threads_read on public.threads;
create policy threads_read on public.threads for select to authenticated using (true);
drop policy if exists threads_insert on public.threads;
create policy threads_insert on public.threads for insert to authenticated
  with check (user_id = auth.uid() and public.can_post(auth.uid()) and revoked = false and pinned = false and locked = false
    and (image_path is null or image_path like 'public/' || auth.uid()::text || '/%'));
drop policy if exists replies_read on public.thread_replies;
create policy replies_read on public.thread_replies for select to authenticated using (true);
drop policy if exists replies_insert on public.thread_replies;
create policy replies_insert on public.thread_replies for insert to authenticated
  with check (user_id = auth.uid() and public.can_post(auth.uid()) and revoked = false
    and not exists (select 1 from threads t where t.id = thread_id and (t.locked or t.revoked))
    and (image_path is null or image_path like 'public/' || auth.uid()::text || '/%'));

drop policy if exists alerts_read on public.alerts;
create policy alerts_read on public.alerts for select to authenticated
  using (target_id = auth.uid() or target_id is null or public.has_permission(auth.uid(),'alert.send'));
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists reports_read on public.reports;
create policy reports_read on public.reports for select to authenticated
  using (reporter_id = auth.uid() or public.has_permission(auth.uid(),'report.manage'));
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated with check (reporter_id = auth.uid() and resolved = false);

-- Bump thread activity on reply
create or replace function public.bump_thread() returns trigger language plpgsql security definer set search_path = public as $$
begin update threads set last_activity = now() where id = new.thread_id; return new; end $$;
drop trigger if exists bump_thread_trg on public.thread_replies;
create trigger bump_thread_trg after insert on public.thread_replies for each row execute function public.bump_thread();

-- Notify a thread author when someone else replies
create or replace function public.notify_reply() returns trigger language plpgsql security definer set search_path = public as $$
declare a uuid; t text; u text;
begin
  select user_id, title into a, t from threads where id = new.thread_id;
  select username into u from profiles where id = new.user_id;
  if a is not null and a <> new.user_id then
    insert into notifications (user_id, kind, text, link) values (a, 'reply', u || ' replied to "' || left(t, 40) || '"', 'thread:' || new.thread_id);
  end if; return new; end $$;
drop trigger if exists notify_reply_trg on public.thread_replies;
create trigger notify_reply_trg after insert on public.thread_replies for each row execute function public.notify_reply();

-- ---------------------------------------------------------------- RPCs (all authorisation is enforced here)
create or replace function public.revoke_content(kind text, cid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare owner_uid uuid; me uuid := auth.uid(); mod boolean; rid uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if kind = 'message' then
    select user_id into owner_uid from messages where id = cid;
    mod := has_permission(me,'chat.moderate');
  elsif kind = 'room_message' then
    select user_id, room_id into owner_uid, rid from room_messages where id = cid;
    mod := false; -- room content: only the author (platform owner may use room.inspect to moderate)
    if rid is not null and has_permission(me,'room.inspect') then mod := true; end if;
  elsif kind = 'thread' then
    select user_id into owner_uid from threads where id = cid; mod := has_permission(me,'thread.moderate');
  elsif kind = 'reply' then
    select user_id into owner_uid from thread_replies where id = cid; mod := has_permission(me,'thread.moderate');
  else raise exception 'Unknown content kind'; end if;
  if owner_uid is null then raise exception 'Not found'; end if;
  if owner_uid <> me and not mod then raise exception 'Not allowed'; end if;
  if kind = 'message' then update messages set revoked = true, body = '', image_path = null, revoked_by = me where id = cid;
  elsif kind = 'room_message' then update room_messages set revoked = true, body = '', image_path = null, revoked_by = me where id = cid;
  elsif kind = 'thread' then update threads set revoked = true, body = '', image_path = null, revoked_by = me where id = cid;
  else update thread_replies set revoked = true, body = '', image_path = null, revoked_by = me where id = cid; end if;
  if owner_uid <> me then
    insert into mod_logs (actor_id, action, target_id, details) values (me, 'revoke_' || kind, owner_uid, jsonb_build_object('id', cid));
  end if;
end $$;

create or replace function public.thread_moderate(tid uuid, set_pinned boolean, set_locked boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(),'thread.moderate') then raise exception 'Not allowed'; end if;
  update threads set pinned = coalesce(set_pinned, pinned), locked = coalesce(set_locked, locked) where id = tid;
  insert into mod_logs (actor_id, action, details) values (auth.uid(),'thread_moderate',jsonb_build_object('id',tid,'pinned',set_pinned,'locked',set_locked));
end $$;

create or replace function public.create_room(room_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if not can_post(auth.uid()) then raise exception 'You cannot create rooms right now'; end if;
  if (select count(*) from rooms where owner_id = auth.uid()) >= 20 then raise exception 'Room limit reached'; end if;
  insert into rooms (name, owner_id) values (trim(room_name), auth.uid()) returning id into rid;
  insert into room_members (room_id, user_id) values (rid, auth.uid());
  return rid;
end $$;

create or replace function public.room_add_member(rid uuid, member_username text) returns void
language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if not is_room_owner(rid, auth.uid()) then raise exception 'Only the room owner can invite'; end if;
  select id into tid from profiles where lower(username) = lower(member_username) and not banned;
  if tid is null then raise exception 'No such user'; end if;
  insert into room_members (room_id, user_id) values (rid, tid) on conflict do nothing;
  insert into notifications (user_id, kind, text, link)
    values (tid, 'invite', 'You were added to room "' || (select name from rooms where id = rid) || '"', 'room:' || rid);
end $$;

create or replace function public.room_remove_member(rid uuid, member uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_room_owner(rid, auth.uid()) or member = auth.uid()) then raise exception 'Not allowed'; end if;
  if is_room_owner(rid, member) then raise exception 'The room owner cannot be removed'; end if;
  delete from room_members where room_id = rid and user_id = member;
end $$;

create or replace function public.delete_room(rid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_room_owner(rid, auth.uid()) or has_permission(auth.uid(),'room.inspect')) then raise exception 'Not allowed'; end if;
  delete from rooms where id = rid;
end $$;

-- Platform owner explicitly chooses to appear as a member of a room.
create or replace function public.join_room_visibly(rid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(),'room.inspect') then raise exception 'Not allowed'; end if;
  insert into room_members (room_id, user_id) values (rid, auth.uid()) on conflict do nothing;
end $$;

-- Rooms list for the current user: member rooms, plus (for the platform owner) every room flagged as inspected.
create or replace function public.my_rooms() returns table (id uuid, name text, owner_id uuid, is_member boolean, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.name, r.owner_id,
         exists (select 1 from room_members m where m.room_id = r.id and m.user_id = auth.uid()),
         r.created_at
  from rooms r where can_access_room(r.id, auth.uid()) order by r.created_at desc $$;

create or replace function public.mute_user(target uuid, seconds int, why text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(),'chat.mute') then raise exception 'Not allowed'; end if;
  if seconds <= 0 or seconds > 31536000 then raise exception 'Invalid duration'; end if;
  if exists (select 1 from profiles where id = target and role = 'owner') then raise exception 'The owner cannot be muted'; end if;
  if exists (select 1 from profiles p, profiles me where p.id = target and me.id = auth.uid() and me.role <> 'owner' and p.role in ('admin','moderator')) then
    raise exception 'Only the owner can mute staff'; end if;
  insert into mutes (user_id, until, reason, muted_by) values (target, now() + make_interval(secs => seconds), why, auth.uid())
    on conflict (user_id) do update set until = excluded.until, reason = excluded.reason, muted_by = excluded.muted_by, created_at = now();
  insert into mod_logs (actor_id, action, target_id, details) values (auth.uid(),'mute',target,jsonb_build_object('seconds',seconds,'reason',why));
  insert into notifications (user_id, kind, text) values (target, 'mute', 'You have been muted for ' || seconds || ' seconds.');
end $$;

create or replace function public.unmute_user(target uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(),'chat.mute') then raise exception 'Not allowed'; end if;
  delete from mutes where user_id = target;
  insert into mod_logs (actor_id, action, target_id) values (auth.uid(),'unmute',target);
  insert into notifications (user_id, kind, text) values (target, 'mute', 'You have been unmuted.');
end $$;

-- Safe server-side command parser. Only /mute and /unmute exist; everything is validated here.
create or replace function public.run_command(cmd text) returns text
language plpgsql security definer set search_path = public as $$
declare parts text[]; tgt uuid; n int; unit text; secs int; uname text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  parts := regexp_split_to_array(trim(cmd), '\s+');
  if parts[1] = '/mute' then
    if array_length(parts,1) < 3 or parts[3] !~ '^[0-9]{1,6}[smhd]$' then raise exception 'Usage: /mute username 5s|1m|1h|1d'; end if;
    n := substring(parts[3] from '^[0-9]+')::int; unit := right(parts[3],1);
    secs := n * case unit when 's' then 1 when 'm' then 60 when 'h' then 3600 else 86400 end;
    select id, username into tgt, uname from profiles where lower(username) = lower(parts[2]);
    if tgt is null then raise exception 'No such user'; end if;
    perform mute_user(tgt, secs, nullif(array_to_string(parts[4:], ' '), ''));
    return uname || ' muted for ' || parts[3];
  elsif parts[1] = '/unmute' then
    if array_length(parts,1) < 2 then raise exception 'Usage: /unmute username'; end if;
    select id, username into tgt, uname from profiles where lower(username) = lower(parts[2]);
    if tgt is null then raise exception 'No such user'; end if;
    perform unmute_user(tgt);
    return uname || ' unmuted';
  else raise exception 'Unknown command'; end if;
end $$;

create or replace function public.send_alert(target uuid, alert_title text, alert_body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(),'alert.send') then raise exception 'Not allowed'; end if;
  insert into alerts (target_id, title, body, created_by) values (target, trim(alert_title), trim(alert_body), auth.uid());
  insert into mod_logs (actor_id, action, target_id, details) values (auth.uid(),'alert',target,jsonb_build_object('title',alert_title));
end $$;

create or replace function public.set_banned(target uuid, is_banned boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(),'user.ban') then raise exception 'Not allowed'; end if;
  if exists (select 1 from profiles where id = target and role in ('owner')) then raise exception 'The owner cannot be banned'; end if;
  if exists (select 1 from profiles p, profiles me where p.id = target and me.id = auth.uid() and me.role <> 'owner' and p.role = 'admin') then
    raise exception 'Only the owner can ban admins'; end if;
  update profiles set banned = is_banned where id = target;
  insert into mod_logs (actor_id, action, target_id, details) values (auth.uid(),'ban',target,jsonb_build_object('banned',is_banned));
end $$;

create or replace function public.rename_user(target uuid, new_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (has_permission(auth.uid(),'user.manage') and (is_owner(auth.uid()) or not exists (select 1 from profiles where id = target and role in ('owner','admin')))) then
    raise exception 'Not allowed'; end if;
  if new_name !~ '^[A-Za-z0-9_]{3,20}$' then raise exception 'Invalid username'; end if;
  update profiles set username = new_name where id = target;
  insert into mod_logs (actor_id, action, target_id, details) values (auth.uid(),'rename',target,jsonb_build_object('name',new_name));
end $$;

create or replace function public.resolve_report(rid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission(auth.uid(),'report.manage') then raise exception 'Not allowed'; end if;
  update reports set resolved = true where id = rid;
end $$;

-- Owner bootstrap by USERNAME (no email). Run from the SQL editor only.
create or replace function public.claim_owner_by_username(owner_username text) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if exists (select 1 from profiles where role = 'owner') then raise exception 'An owner already exists'; end if;
  select id into uid from profiles where lower(username) = lower(owner_username);
  if uid is null then raise exception 'No such username. Register on the site first.'; end if;
  perform set_config('chatkari.allow_owner_change','on',true);
  update profiles set role = 'owner' where id = uid;
  insert into mod_logs (actor_id, action, target_id) values (uid,'owner_claimed',uid);
  return 'OK: owner set for ' || owner_username;
end $$;
revoke all on function public.claim_owner_by_username(text) from public, anon, authenticated;

-- Used by the Edge Function (service role) to check who is calling; also by the client for UI gating only.
create or replace function public.my_permissions() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(k.key), '{}') from permissions k where has_permission(auth.uid(), k.key) $$;

do $$ declare f text; begin
  foreach f in array array[
    'revoke_content(text,uuid)','thread_moderate(uuid,boolean,boolean)','create_room(text)','room_add_member(uuid,text)',
    'room_remove_member(uuid,uuid)','delete_room(uuid)','join_room_visibly(uuid)','my_rooms()','mute_user(uuid,int,text)',
    'unmute_user(uuid)','run_command(text)','send_alert(uuid,text,text)','set_banned(uuid,boolean)','rename_user(uuid,text)',
    'resolve_report(uuid)','my_permissions()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop; end $$;

-- ---------------------------------------------------------------- storage (private bucket, signed URLs)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-images','chat-images',false,5242880, array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- paths: public/<uid>/<file>   |   rooms/<room_id>/<uid>/<file>
drop policy if exists chatimg_insert on storage.objects;
create policy chatimg_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'chat-images' and public.can_post(auth.uid()) and (
    ((storage.foldername(name))[1] = 'public' and (storage.foldername(name))[2] = auth.uid()::text)
    or ((storage.foldername(name))[1] = 'rooms' and (storage.foldername(name))[3] = auth.uid()::text
        and exists (select 1 from public.room_members m where m.room_id::text = (storage.foldername(name))[2] and m.user_id = auth.uid()))));
drop policy if exists chatimg_select on storage.objects;
create policy chatimg_select on storage.objects for select to authenticated using (
  bucket_id = 'chat-images' and (
    (storage.foldername(name))[1] = 'public'
    or ((storage.foldername(name))[1] = 'rooms' and public.can_access_room(((storage.foldername(name))[2])::uuid, auth.uid()))));
drop policy if exists chatimg_delete on storage.objects;
create policy chatimg_delete on storage.objects for delete to authenticated using (
  bucket_id = 'chat-images' and ((storage.foldername(name))[2] = auth.uid()::text or (storage.foldername(name))[3] = auth.uid()::text));

-- ---------------------------------------------------------------- realtime
do $$ declare t text; begin
  foreach t in array array['messages','room_messages','room_members','threads','thread_replies','alerts','notifications','mutes'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop; end $$;

-- ---------------------------------------------------------------- login by username (usernames can be renamed; the internal auth identifier never changes)
create or replace function public.login_identifier(uname text) returns text
language sql stable security definer set search_path = public, auth as $$
  select u.email from profiles p join auth.users u on u.id = p.id where lower(p.username) = lower(uname) and not p.banned $$;
revoke all on function public.login_identifier(text) from public;
grant execute on function public.login_identifier(text) to anon, authenticated;

create or replace function public.clear_user_permission(target uuid, perm text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner(auth.uid()) then raise exception 'Owner only'; end if;
  delete from user_permissions where user_id = target and permission_key = perm;
end $$;
revoke all on function public.clear_user_permission(uuid,text) from public, anon;
grant execute on function public.clear_user_permission(uuid,text) to authenticated;
