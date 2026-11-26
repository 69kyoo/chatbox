-- CHATKARI 001: profiles, roles, permissions, owner protection, avatars bucket.
-- Idempotent: safe to run more than once. Does not delete data.

do $$ begin create type public.app_role as enum ('owner','admin','moderator','member'); exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists role public.app_role not null default 'member';
alter table public.profiles add column if not exists banned boolean not null default false;
alter table public.profiles add column if not exists last_seen timestamptz default now();
create unique index if not exists profiles_username_lower on public.profiles (lower(username));
alter table public.profiles drop constraint if exists profiles_username_fmt;
alter table public.profiles add constraint profiles_username_fmt check (username ~ '^[A-Za-z0-9_]{3,20}$') not valid;
alter table public.profiles drop constraint if exists profiles_bio_len;
alter table public.profiles add constraint profiles_bio_len check (bio is null or char_length(bio) <= 300);

create table if not exists public.platform_settings (
  id int primary key default 1 check (id = 1),
  registration_enabled boolean not null default true,
  maintenance_mode boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (id) values (1) on conflict do nothing;

create table if not exists public.permissions (
  key text primary key, description text not null, owner_only boolean not null default false);
create table if not exists public.role_permissions (
  role public.app_role not null,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role, permission_key));
create table if not exists public.user_permissions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  granted boolean not null default true,
  primary key (user_id, permission_key));

create table if not exists public.mod_logs (
  id bigserial primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_id uuid,
  details jsonb not null default '{}',
  created_at timestamptz not null default now());
create index if not exists mod_logs_created on public.mod_logs (created_at desc);

insert into public.permissions (key, description, owner_only) values
 ('chat.moderate','Delete/revoke chat messages',false),
 ('chat.mute','Mute and unmute users',false),
 ('thread.moderate','Lock, pin, delete threads and replies',false),
 ('user.ban','Ban and unban users',false),
 ('user.manage','View and search all account info',false),
 ('audit.view','Read moderation logs',false),
 ('role.manage','Assign roles and permissions',true),
 ('alert.send','Send global/user alerts',true),
 ('room.inspect','Invisible private room access',true),
 ('settings.manage','Change platform settings',true)
on conflict do nothing;
insert into public.role_permissions (role, permission_key) values
 ('admin','chat.moderate'),('admin','chat.mute'),('admin','thread.moderate'),('admin','user.ban'),('admin','user.manage'),('admin','audit.view'),
 ('moderator','chat.moderate'),('moderator','chat.mute'),('moderator','thread.moderate')
on conflict do nothing;

-- Core authorization helpers (owner = everything; banned = nothing; per-user overrides never apply to owner_only keys)
create or replace function public.is_owner(uid uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = uid and role = 'owner' and not banned) $$;

create or replace function public.has_permission(uid uuid, perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p.id is null or p.banned then false
    when p.role = 'owner' then true
    else coalesce(
      (select up.granted from user_permissions up
        where up.user_id = uid and up.permission_key = perm
          and not exists (select 1 from permissions x where x.key = perm and x.owner_only)),
      exists (select 1 from role_permissions rp where rp.role = p.role and rp.permission_key = perm))
  end
  from (select 1) d left join profiles p on p.id = uid
$$;

-- New-user trigger: validates username, honours "registration disabled"
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare uname text;
begin
  if not (select registration_enabled from platform_settings where id = 1) then
    raise exception 'Registration is currently disabled';
  end if;
  uname := coalesce(nullif(new.raw_user_meta_data->>'username',''), 'user' || substr(replace(new.id::text,'-',''),1,8));
  if uname !~ '^[A-Za-z0-9_]{3,20}$' then raise exception 'Invalid username'; end if;
  if exists (select 1 from profiles where lower(username) = lower(uname)) then raise exception 'Username already taken'; end if;
  insert into profiles (id, username) values (new.id, uname);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Backfill profiles for accounts that already exist
insert into public.profiles (id, username)
select u.id, 'user' || substr(replace(u.id::text,'-',''),1,8) from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

-- Owner protection: owner row can't be demoted, banned or deleted except via claim_owner()
create or replace function public.protect_owner() returns trigger
language plpgsql as $$
begin
  if old.role = 'owner' and coalesce(current_setting('chatkari.allow_owner_change', true),'') <> 'on' then
    if tg_op = 'DELETE' or new.role <> 'owner' or new.banned then
      raise exception 'The owner account is protected';
    end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists protect_owner_trg on public.profiles;
create trigger protect_owner_trg before update or delete on public.profiles for each row execute function public.protect_owner();

-- Owner initialisation: runs ONLY from the SQL editor (not callable by app users)
create or replace function public.claim_owner(owner_email text) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if exists (select 1 from profiles where role = 'owner') then raise exception 'An owner already exists'; end if;
  select id into uid from auth.users where lower(email) = lower(owner_email);
  if uid is null then raise exception 'No account with that email. Register on the site first.'; end if;
  perform set_config('chatkari.allow_owner_change','on',true);
  update profiles set role = 'owner' where id = uid;
  insert into mod_logs (actor_id, action, target_id) values (uid, 'owner_claimed', uid);
  return 'OK: owner set for ' || owner_email;
end $$;
revoke all on function public.claim_owner(text) from public, anon, authenticated;

-- Owner-only role / permission management (client calls these via supabase.rpc)
create or replace function public.set_user_role(target uuid, new_role public.app_role) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner(auth.uid()) then raise exception 'Owner only'; end if;
  if new_role = 'owner' then raise exception 'Cannot assign owner'; end if;
  if exists (select 1 from profiles where id = target and role = 'owner') then raise exception 'Cannot change the owner'; end if;
  update profiles set role = new_role where id = target;
  insert into mod_logs (actor_id, action, target_id, details) values (auth.uid(),'set_role',target,jsonb_build_object('role',new_role));
end $$;

create or replace function public.set_user_permission(target uuid, perm text, is_granted boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner(auth.uid()) then raise exception 'Owner only'; end if;
  if exists (select 1 from profiles where id = target and role = 'owner') then raise exception 'Cannot change the owner'; end if;
  if not exists (select 1 from permissions where key = perm and not owner_only) then raise exception 'Unknown or owner-only permission'; end if;
  insert into user_permissions (user_id, permission_key, granted) values (target, perm, is_granted)
    on conflict (user_id, permission_key) do update set granted = excluded.granted;
  insert into mod_logs (actor_id, action, target_id, details) values (auth.uid(),'set_permission',target,jsonb_build_object('perm',perm,'granted',is_granted));
end $$;

revoke all on function public.set_user_role(uuid, public.app_role), public.set_user_permission(uuid,text,boolean) from public, anon;
grant execute on function public.set_user_role(uuid, public.app_role), public.set_user_permission(uuid,text,boolean) to authenticated;
grant execute on function public.is_owner(uuid), public.has_permission(uuid,text) to anon, authenticated;

-- Row Level Security
alter table public.profiles enable row level security;
alter table public.platform_settings enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_permissions enable row level security;
alter table public.mod_logs enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (true);
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists settings_read on public.platform_settings;
create policy settings_read on public.platform_settings for select using (true);
drop policy if exists perms_read on public.permissions;
create policy perms_read on public.permissions for select to authenticated using (true);
drop policy if exists roleperms_read on public.role_permissions;
create policy roleperms_read on public.role_permissions for select to authenticated using (true);
drop policy if exists userperms_read on public.user_permissions;
create policy userperms_read on public.user_permissions for select to authenticated
  using (user_id = auth.uid() or public.has_permission(auth.uid(),'user.manage'));
drop policy if exists logs_read on public.mod_logs;
create policy logs_read on public.mod_logs for select to authenticated using (public.has_permission(auth.uid(),'audit.view'));

-- Column-level lock: users may only edit these profile columns (role/banned/id are untouchable from the client)
revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant update (username, avatar_url, bio, last_seen) on public.profiles to authenticated;
revoke insert, update, delete on public.platform_settings, public.permissions, public.role_permissions, public.user_permissions, public.mod_logs from anon, authenticated;

-- Avatars bucket (public read, users write only inside their own folder <uid>/...)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars','avatars',true,2097152, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists avatars_write on storage.objects;
create policy avatars_write on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
