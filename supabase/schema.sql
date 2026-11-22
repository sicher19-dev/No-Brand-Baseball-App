-- No Brand Baseball backend: remote assessments (video) + messages.
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query -> paste -> Run).
-- Safe to re-run.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Profiles: one row per auth user. Pitchers carry their roster id; coaches have role 'coach'.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  pitcher_id   text unique,
  role         text not null default 'pitcher' check (role in ('pitcher', 'coach')),
  display_name text,
  created_at   timestamptz not null default now()
);

create or replace function public.is_coach() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and role = 'coach');
$$;

create or replace function public.my_pitcher_id() returns text
language sql stable security definer set search_path = public as $$
  select pitcher_id from public.profiles where user_id = auth.uid();
$$;

-- Create the profile automatically when a user is created (metadata comes from the provisioning script).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, pitcher_id, role, display_name)
  values (
    new.id,
    nullif(new.raw_user_meta_data->>'pitcher_id', ''),
    coalesce(nullif(new.raw_user_meta_data->>'role', ''), 'pitcher'),
    coalesce(new.raw_user_meta_data->>'display_name', new.email)
  )
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Assessments: one row per uploaded video.
-- ---------------------------------------------------------------------------
create table if not exists public.assessments (
  id           uuid primary key default gen_random_uuid(),
  pitcher_id   text not null,
  user_id      uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  note         text,
  size_bytes   bigint,
  content_type text,
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz,
  coach_note   text
);
create index if not exists assessments_pitcher_idx on public.assessments (pitcher_id, created_at desc);
-- Added later: who filmed it (a coach can record in person) and when the coaches were emailed about it.
alter table public.assessments add column if not exists uploaded_by_role text not null default 'pitcher'
  check (uploaded_by_role in ('pitcher', 'coach'));
alter table public.assessments add column if not exists uploaded_by_name text;
alter table public.assessments add column if not exists notified_at timestamptz;

-- ---------------------------------------------------------------------------
-- Messages: one thread per pitcher, shared with all coaches.
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  pitcher_id      text not null,
  sender_user_id  uuid not null references auth.users(id) on delete cascade,
  sender_role     text not null check (sender_role in ('pitcher', 'coach')),
  sender_name     text,
  body            text not null check (length(body) between 1 and 4000),
  created_at      timestamptz not null default now(),
  read_by_coach   boolean not null default false,
  read_by_pitcher boolean not null default false
);
create index if not exists messages_pitcher_idx on public.messages (pitcher_id, created_at);
alter table public.messages add column if not exists notified_at timestamptz;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.profiles    enable row level security;
alter table public.assessments enable row level security;
alter table public.messages    enable row level security;

drop policy if exists "profiles: read own or coach reads all" on public.profiles;
create policy "profiles: read own or coach reads all" on public.profiles
  for select to authenticated using (user_id = auth.uid() or public.is_coach());

drop policy if exists "assessments: pitcher reads own, coach reads all" on public.assessments;
create policy "assessments: pitcher reads own, coach reads all" on public.assessments
  for select to authenticated using (pitcher_id = public.my_pitcher_id() or public.is_coach());

drop policy if exists "assessments: pitcher inserts own" on public.assessments;
create policy "assessments: pitcher inserts own" on public.assessments
  for insert to authenticated with check (pitcher_id = public.my_pitcher_id() and user_id = auth.uid());

drop policy if exists "assessments: coach updates review" on public.assessments;
create policy "assessments: coach updates review" on public.assessments
  for update to authenticated using (public.is_coach()) with check (public.is_coach());

drop policy if exists "messages: pitcher reads own thread, coach reads all" on public.messages;
create policy "messages: pitcher reads own thread, coach reads all" on public.messages
  for select to authenticated using (pitcher_id = public.my_pitcher_id() or public.is_coach());

drop policy if exists "messages: pitcher posts to own thread" on public.messages;
create policy "messages: pitcher posts to own thread" on public.messages
  for insert to authenticated
  with check (
    sender_user_id = auth.uid()
    and (
      (sender_role = 'pitcher' and pitcher_id = public.my_pitcher_id())
      or (sender_role = 'coach' and public.is_coach())
    )
  );

drop policy if exists "messages: mark read" on public.messages;
create policy "messages: mark read" on public.messages
  for update to authenticated
  using (pitcher_id = public.my_pitcher_id() or public.is_coach())
  with check (pitcher_id = public.my_pitcher_id() or public.is_coach());

-- ---------------------------------------------------------------------------
-- Storage: private bucket, one folder per pitcher id.
-- NOTE: the bucket limit below must not exceed the project's global upload limit
-- (Free plan: 50 MB. Pro plan: raise it under Storage -> Settings, then set 524288000 here
-- and maxVideoMB: 500 in www/config.js, and re-run this file).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'assessments', 'assessments', false, 52428800,
  array['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/3gpp', 'video/x-matroska']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "assessments bucket: pitcher uploads to own folder" on storage.objects;
create policy "assessments bucket: pitcher uploads to own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'assessments' and (storage.foldername(name))[1] = public.my_pitcher_id());

drop policy if exists "assessments bucket: pitcher reads own, coach reads all" on storage.objects;
create policy "assessments bucket: pitcher reads own, coach reads all" on storage.objects
  for select to authenticated
  using (bucket_id = 'assessments' and ((storage.foldername(name))[1] = public.my_pitcher_id() or public.is_coach()));

-- ---------------------------------------------------------------------------
-- Coach overview: unread counts per pitcher, computed server-side (coaches only).
-- ---------------------------------------------------------------------------
create or replace function public.coach_overview()
returns table (pitcher_id text, new_assessments bigint, unread_messages bigint, last_activity timestamptz)
language sql stable security definer set search_path = public as $$
  select p.pitcher_id,
         coalesce((select count(*) from public.assessments a where a.pitcher_id = p.pitcher_id and a.reviewed_at is null and a.uploaded_by_role = 'pitcher'), 0),
         coalesce((select count(*) from public.messages m where m.pitcher_id = p.pitcher_id and m.sender_role = 'pitcher' and not m.read_by_coach), 0),
         greatest(
           (select max(created_at) from public.assessments a where a.pitcher_id = p.pitcher_id),
           (select max(created_at) from public.messages m where m.pitcher_id = p.pitcher_id)
         )
  from (select distinct pitcher_id from public.assessments
        union select distinct pitcher_id from public.messages) p
  where public.is_coach();
$$;

-- ---------------------------------------------------------------------------
-- Coaches record assessments in person (added 2026-11-17).
-- A coach can film a pitcher on the coach's own phone and upload it to that pitcher's folder.
-- ---------------------------------------------------------------------------

drop policy if exists "assessments: pitcher inserts own" on public.assessments;
create policy "assessments: pitcher inserts own" on public.assessments
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (
      (uploaded_by_role = 'pitcher' and pitcher_id = public.my_pitcher_id())
      or (uploaded_by_role = 'coach' and public.is_coach())
    )
  );

drop policy if exists "assessments bucket: pitcher uploads to own folder" on storage.objects;
create policy "assessments bucket: pitcher uploads to own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'assessments' and ((storage.foldername(name))[1] = public.my_pitcher_id() or public.is_coach()));

-- ---------------------------------------------------------------------------
-- Coach email alerts (tools/notify_coaches.mjs, run by the notify-coaches workflow).
-- notified_at is stamped once an email about the row has gone out.
-- ---------------------------------------------------------------------------
create index if not exists assessments_unnotified_idx on public.assessments (created_at) where notified_at is null;
create index if not exists messages_unnotified_idx    on public.messages (created_at) where notified_at is null;

-- ---------------------------------------------------------------------------
-- Push notification devices (added 2026-11-17). One row per phone; the app upserts the APNs token after sign-in
-- and deletes it on sign-out. supabase/functions/push sends to these (see supabase/push_webhook.sql).
-- ---------------------------------------------------------------------------
create table if not exists public.devices (
  token      text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  platform   text not null default 'ios',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists devices_user_idx on public.devices (user_id);
alter table public.devices enable row level security;
drop policy if exists "devices: own rows" on public.devices;
create policy "devices: own rows" on public.devices
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Last sign-in on the coach list (added 2026-11-22).
-- auth.users.last_sign_in_at only moves on a password sign-in, and the app keeps a session for weeks,
-- so the app also stamps the profile each time it opens with a live session (touch_profile). The
-- overview reports the later of the two, and now lists every pitcher with a profile, active or not.
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists last_seen_at timestamptz;

create or replace function public.touch_profile() returns void
language sql security definer set search_path = public as $$
  update public.profiles set last_seen_at = now() where user_id = auth.uid();
$$;

drop function if exists public.coach_overview();
create function public.coach_overview()
returns table (pitcher_id text, new_assessments bigint, unread_messages bigint, last_activity timestamptz, last_seen timestamptz)
language sql stable security definer set search_path = public as $$
  select pr.pitcher_id,
         coalesce((select count(*) from public.assessments a where a.pitcher_id = pr.pitcher_id and a.reviewed_at is null and a.uploaded_by_role = 'pitcher'), 0),
         coalesce((select count(*) from public.messages m where m.pitcher_id = pr.pitcher_id and m.sender_role = 'pitcher' and not m.read_by_coach), 0),
         greatest(
           (select max(created_at) from public.assessments a where a.pitcher_id = pr.pitcher_id),
           (select max(created_at) from public.messages m where m.pitcher_id = pr.pitcher_id)
         ),
         greatest(pr.last_seen_at, u.last_sign_in_at)
  from public.profiles pr
  left join auth.users u on u.id = pr.user_id
  where pr.pitcher_id is not null and public.is_coach();
$$;
