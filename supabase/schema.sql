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
-- NOTE: the bucket limit below (500 MB) only applies if the project's global upload limit
-- (Dashboard -> Storage -> Settings) is at least as high. Raise it there on the Pro plan.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'assessments', 'assessments', false, 524288000,
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
         coalesce((select count(*) from public.assessments a where a.pitcher_id = p.pitcher_id and a.reviewed_at is null), 0),
         coalesce((select count(*) from public.messages m where m.pitcher_id = p.pitcher_id and m.sender_role = 'pitcher' and not m.read_by_coach), 0),
         greatest(
           (select max(created_at) from public.assessments a where a.pitcher_id = p.pitcher_id),
           (select max(created_at) from public.messages m where m.pitcher_id = p.pitcher_id)
         )
  from (select distinct pitcher_id from public.assessments
        union select distinct pitcher_id from public.messages) p
  where public.is_coach();
$$;
