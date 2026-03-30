create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key,
  name text not null,
  role text default 'member',
  homeroom text,
  avatar_url text,
  created_at timestamptz default now()
);

create table if not exists public.messenger_channels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  type text default 'channel',
  sort_order int default 0,
  member_count int default 0,
  created_at timestamptz default now()
);

create table if not exists public.messenger_channel_members (
  channel_id uuid not null references public.messenger_channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  user_name text not null,
  role text default 'member',
  joined_at timestamptz default now(),
  primary key (channel_id, user_id)
);

create table if not exists public.messenger_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.messenger_channels(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  sender_name text not null,
  content text,
  reply_to uuid references public.messenger_messages(id) on delete set null,
  attachment_url text,
  created_at timestamptz default now()
);

create table if not exists public.messenger_mentions (
  id bigint generated always as identity primary key,
  message_id uuid not null references public.messenger_messages(id) on delete cascade,
  channel_id uuid not null references public.messenger_channels(id) on delete cascade,
  mentioned_user_id uuid not null references public.profiles(id) on delete cascade,
  mentioned_by_id uuid not null references public.profiles(id) on delete cascade,
  mentioned_by_name text not null,
  created_at timestamptz default now()
);

create table if not exists public.messenger_read_receipts (
  id bigint generated always as identity primary key,
  message_id uuid not null references public.messenger_messages(id) on delete cascade,
  channel_id uuid not null references public.messenger_channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz default now(),
  unique (message_id, user_id)
);

create table if not exists public.messenger_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  user_name text not null,
  status text not null default 'offline',
  last_seen_at timestamptz default now()
);

create table if not exists public.messenger_bookmarks (
  id bigint generated always as identity primary key,
  message_id uuid not null references public.messenger_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel_id uuid not null references public.messenger_channels(id) on delete cascade,
  created_at timestamptz default now(),
  unique (message_id, user_id)
);

create or replace function public.is_admin(check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = check_user_id
      and role = 'admin'
  );
$$;

alter table public.profiles enable row level security;
alter table public.messenger_channels enable row level security;
alter table public.messenger_channel_members enable row level security;
alter table public.messenger_messages enable row level security;
alter table public.messenger_mentions enable row level security;
alter table public.messenger_read_receipts enable row level security;
alter table public.messenger_presence enable row level security;
alter table public.messenger_bookmarks enable row level security;

drop policy if exists "profiles read for authenticated" on public.profiles;
create policy "profiles read for authenticated" on public.profiles for select to authenticated using (true);
drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "channels read for authenticated" on public.messenger_channels;
create policy "channels read for authenticated" on public.messenger_channels for select to authenticated using (true);
drop policy if exists "channels admin insert" on public.messenger_channels;
create policy "channels admin insert" on public.messenger_channels for insert to authenticated with check (public.is_admin(auth.uid()));
drop policy if exists "channels admin update" on public.messenger_channels;
create policy "channels admin update" on public.messenger_channels for update to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
drop policy if exists "channels admin delete" on public.messenger_channels;
create policy "channels admin delete" on public.messenger_channels for delete to authenticated using (public.is_admin(auth.uid()));
drop policy if exists "channel members read for authenticated" on public.messenger_channel_members;
create policy "channel members read for authenticated" on public.messenger_channel_members for select to authenticated using (true);
drop policy if exists "channel members admin insert" on public.messenger_channel_members;
create policy "channel members admin insert" on public.messenger_channel_members for insert to authenticated with check (public.is_admin(auth.uid()));
drop policy if exists "channel members admin update" on public.messenger_channel_members;
create policy "channel members admin update" on public.messenger_channel_members for update to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
drop policy if exists "channel members admin delete" on public.messenger_channel_members;
create policy "channel members admin delete" on public.messenger_channel_members for delete to authenticated using (public.is_admin(auth.uid()));
drop policy if exists "messages read for authenticated" on public.messenger_messages;
create policy "messages read for authenticated" on public.messenger_messages for select to authenticated using (true);
drop policy if exists "messages insert own" on public.messenger_messages;
create policy "messages insert own" on public.messenger_messages for insert to authenticated with check (auth.uid() = sender_id);
drop policy if exists "mentions insert own" on public.messenger_mentions;
create policy "mentions insert own" on public.messenger_mentions for insert to authenticated with check (auth.uid() = mentioned_by_id);
drop policy if exists "mentions read if mentioned or sender" on public.messenger_mentions;
create policy "mentions read if mentioned or sender" on public.messenger_mentions for select to authenticated using (auth.uid() = mentioned_user_id or auth.uid() = mentioned_by_id);
drop policy if exists "read receipts own" on public.messenger_read_receipts;
create policy "read receipts own" on public.messenger_read_receipts for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "bookmarks own" on public.messenger_bookmarks;
create policy "bookmarks own" on public.messenger_bookmarks for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "presence read for authenticated" on public.messenger_presence;
create policy "presence read for authenticated" on public.messenger_presence for select to authenticated using (true);
drop policy if exists "presence upsert own" on public.messenger_presence;
create policy "presence upsert own" on public.messenger_presence for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);




