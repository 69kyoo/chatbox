-- CHATKARI 003: thread deletion + Flappy leaderboard. Idempotent. Run in Supabase SQL Editor.

-- Delete a thread (and its replies) if you wrote it, or have the thread.moderate permission.
create or replace function public.delete_thread(tid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a uuid;
begin
  select user_id into a from threads where id = tid;
  if a is null then raise exception 'Thread not found'; end if;
  if a <> auth.uid() and not has_permission(auth.uid(), 'thread.moderate') then raise exception 'Not allowed'; end if;
  delete from threads where id = tid;
  if a <> auth.uid() then
    insert into mod_logs (actor_id, action, target_id, details) values (auth.uid(), 'delete_thread', a, jsonb_build_object('id', tid));
  end if;
end $$;
revoke all on function public.delete_thread(uuid) from public, anon;
grant execute on function public.delete_thread(uuid) to authenticated;

-- Flappy leaderboard: one row per player, written only through submit_flappy().
create table if not exists public.flappy_scores (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  best int not null default 0,
  plays int not null default 0,
  updated_at timestamptz not null default now());
alter table public.flappy_scores enable row level security;
revoke all on public.flappy_scores from anon, authenticated;
grant select on public.flappy_scores to authenticated;
drop policy if exists flappy_read on public.flappy_scores;
create policy flappy_read on public.flappy_scores for select to authenticated using (true);

create or replace function public.submit_flappy(s int) returns int
language plpgsql security definer set search_path = public as $$
declare b int;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if s < 0 or s > 2000 then raise exception 'Invalid score'; end if;
  insert into flappy_scores (user_id, best, plays) values (auth.uid(), s, 1)
    on conflict (user_id) do update set best = greatest(flappy_scores.best, excluded.best), plays = flappy_scores.plays + 1, updated_at = now()
    returning best into b;
  return b;
end $$;
revoke all on function public.submit_flappy(int) from public, anon;
grant execute on function public.submit_flappy(int) to authenticated;
