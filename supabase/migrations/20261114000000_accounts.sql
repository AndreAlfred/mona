-- Mona accounts: each person's history, collection and feed position.
--
-- The browser talks to these tables directly with the public (publishable)
-- key, so the database itself enforces privacy: row-level security (RLS)
-- lets a signed-in person see and change only rows whose user_id is theirs,
-- and someone who isn't signed in sees nothing at all.
--
-- Writes go through the push_* functions below rather than plain upserts,
-- because Mona's merge rules (earliest "seen" wins, newest collect/remove
-- wins, visited artists are a union) have to hold even when two phones
-- write at once. The functions are `security invoker`: they run as the
-- signed-in person, so RLS still applies inside them.

-- ---------------------------------------------------------------- tables

create table public.seen (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null,               -- the card's route, e.g. "w/holbein-ambassadors" or "a/cma-123"
  title text not null,
  artist text not null,
  date text,
  thumb text not null,
  seen_at timestamptz not null,    -- when the person first saw it (device clock)
  updated_at timestamptz not null default now(),  -- set by the database; devices pull "since"
  primary key (user_id, key)
);

create table public.collected (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null,
  title text not null,
  artist text not null,
  date text,
  thumb text not null,
  collected_at timestamptz not null,
  removed_at timestamptz,          -- null while collected; set instead of deleting, so removals reach other devices
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table public.feed_state (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  seed bigint,                     -- the feed's random seed; the first device to sync sets it
  visited_artists text[] not null default '{}',
  last_period text,
  current jsonb,                   -- the artist run in progress: {"artist": "...", "shown": 3}
  position_at timestamptz,         -- device time of the latest change to current / last_period
  cleared_at timestamptz,          -- set by clear_my_data(); other devices wipe their copy when they see it
  updated_at timestamptz not null default now()
);

create index seen_pull on public.seen (user_id, updated_at);
create index collected_pull on public.collected (user_id, updated_at);

-- updated_at always comes from the database clock, never the device's.
create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger touch before insert or update on public.seen
  for each row execute function public.touch_updated_at();
create trigger touch before insert or update on public.collected
  for each row execute function public.touch_updated_at();
create trigger touch before insert or update on public.feed_state
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------- row-level security

alter table public.seen enable row level security;
alter table public.collected enable row level security;
alter table public.feed_state enable row level security;

-- `(select auth.uid())` rather than `auth.uid()` lets Postgres work it out
-- once per query instead of once per row.
create policy "own rows: read" on public.seen for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own rows: add" on public.seen for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own rows: change" on public.seen for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows: delete" on public.seen for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "own rows: read" on public.collected for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own rows: add" on public.collected for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own rows: change" on public.collected for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows: delete" on public.collected for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "own rows: read" on public.feed_state for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own rows: add" on public.feed_state for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own rows: change" on public.feed_state for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows: delete" on public.feed_state for delete to authenticated
  using (user_id = (select auth.uid()));

-- Signed-in people only; nobody who isn't signed in gets anything.
revoke all on public.seen, public.collected, public.feed_state from anon, public;
grant select, insert, update, delete on public.seen, public.collected, public.feed_state to authenticated;

-- ---------------------------------------------------------------- writes

-- True if this person deleted their saved data after the device last pulled.
-- A device that hasn't seen the deletion yet must not upload its old copy
-- back; it pulls, sees cleared_at, and wipes its own copy instead.
create function public.cleared_since(pulled timestamptz) returns boolean
language sql stable security invoker set search_path = '' as $$
  select pulled is not null and exists (
    select 1 from public.feed_state
    where user_id = (select auth.uid()) and cleared_at > pulled
  )
$$;

-- items: [{key, title, artist, date, thumb, seen_at}]. Keeps the earliest seen_at.
create function public.push_seen(items jsonb, pulled timestamptz default null) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  if public.cleared_since(pulled) then return false; end if;
  insert into public.seen as s (key, title, artist, date, thumb, seen_at)
  select r.key, r.title, r.artist, r.date, r.thumb, r.seen_at
  from jsonb_to_recordset(items) as r (key text, title text, artist text, date text, thumb text, seen_at timestamptz)
  on conflict (user_id, key) do update
    set seen_at = excluded.seen_at, title = excluded.title, artist = excluded.artist,
        date = excluded.date, thumb = excluded.thumb
    where excluded.seen_at < s.seen_at;
  return true;
end $$;

-- items: [{key, title, artist, date, thumb, collected_at, removed_at}].
-- Per work, the newest event (collect or remove) wins.
create function public.push_collected(items jsonb, pulled timestamptz default null) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  if public.cleared_since(pulled) then return false; end if;
  insert into public.collected as c (key, title, artist, date, thumb, collected_at, removed_at)
  select r.key, r.title, r.artist, r.date, r.thumb, r.collected_at, r.removed_at
  from jsonb_to_recordset(items) as r (key text, title text, artist text, date text, thumb text,
                                       collected_at timestamptz, removed_at timestamptz)
  on conflict (user_id, key) do update
    set collected_at = excluded.collected_at, removed_at = excluded.removed_at,
        title = excluded.title, artist = excluded.artist, date = excluded.date, thumb = excluded.thumb
    -- greatest() ignores nulls, so this is "when did this event happen".
    where greatest(excluded.collected_at, excluded.removed_at) > greatest(c.collected_at, c.removed_at);
  return true;
end $$;

-- One row per person. Visited artists are merged as a union here, on the
-- server, so two devices can never drop each other's artists; the run in
-- progress takes whichever device moved most recently; the first seed stays.
create function public.push_feed_state(
  seed bigint,
  visited text[],
  last_period text,
  "current" jsonb,
  position_at timestamptz,
  pulled timestamptz default null
) returns boolean
language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_column
begin
  if public.cleared_since(pulled) then return false; end if;
  insert into public.feed_state as f (seed, visited_artists, last_period, "current", position_at)
  values (push_feed_state.seed, coalesce(push_feed_state.visited, '{}'), push_feed_state.last_period,
          push_feed_state."current", push_feed_state.position_at)
  on conflict (user_id) do update set
    seed = coalesce(f.seed, excluded.seed),
    visited_artists = array(
      select a from unnest(f.visited_artists || excluded.visited_artists) with ordinality as t (a, i)
      group by a order by min(i)
    ),
    last_period = case when excluded.position_at >= coalesce(f.position_at, '-infinity')
                       then excluded.last_period else f.last_period end,
    "current" = case when excluded.position_at >= coalesce(f.position_at, '-infinity')
                     then excluded."current" else f."current" end,
    position_at = greatest(f.position_at, excluded.position_at);
  return true;
end $$;

-- "Delete my saved data": removes this person's history and collection and
-- resets their feed position. The feed_state row stays, carrying cleared_at,
-- so the person's other devices clear their copies instead of re-uploading.
create function public.clear_my_data() returns void
language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.seen where user_id = (select auth.uid());
  delete from public.collected where user_id = (select auth.uid());
  insert into public.feed_state (cleared_at) values (now())
  on conflict (user_id) do update set
    visited_artists = '{}', last_period = null, "current" = null, position_at = null, cleared_at = now();
end $$;

revoke execute on function public.touch_updated_at() from public, anon, authenticated;
revoke execute on function public.cleared_since(timestamptz) from public, anon;
revoke execute on function public.push_seen(jsonb, timestamptz) from public, anon;
revoke execute on function public.push_collected(jsonb, timestamptz) from public, anon;
revoke execute on function public.push_feed_state(bigint, text[], text, jsonb, timestamptz, timestamptz) from public, anon;
revoke execute on function public.clear_my_data() from public, anon;
grant execute on function public.cleared_since(timestamptz) to authenticated;
grant execute on function public.push_seen(jsonb, timestamptz) to authenticated;
grant execute on function public.push_collected(jsonb, timestamptz) to authenticated;
grant execute on function public.push_feed_state(bigint, text[], text, jsonb, timestamptz, timestamptz) to authenticated;
grant execute on function public.clear_my_data() to authenticated;
