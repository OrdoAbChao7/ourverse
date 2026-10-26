-- OURVERSE schema
-- PostgreSQL 15+ (Supabase local uses PostgreSQL 17).
--
-- Security model:
--   * every client-facing table has RLS enabled in the next migration;
--   * clients never write membership, invites, or spaces directly (RPC only);
--   * capsule bodies live in a separate table whose SELECT policy checks server time.
--
-- All timestamps are UTC timestamptz. Calendar dates ("occurred_on", "date") are
-- deliberately stored as date so they do not drift across time zones. The frontend
-- derives occurred_at from the author-entered occurred_on/occurred_time.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- spaces
-- ---------------------------------------------------------------------------
create table if not exists public.spaces (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  relationship_start_at date,
  motto text not null default '把故事留在星光里。',
  accent text not null default 'violet',
  constraint spaces_display_name_check
    check (char_length(display_name) between 1 and 40 and btrim(display_name) <> ''),
  constraint spaces_motto_check
    check (char_length(motto) <= 200),
  constraint spaces_accent_check
    check (accent in ('violet', 'gold', 'cyan'))
);

-- ---------------------------------------------------------------------------
-- space_members
-- ---------------------------------------------------------------------------
create table if not exists public.space_members (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  constraint space_members_role_check check (role in ('owner', 'member')),
  constraint space_members_space_user_key unique (space_id, user_id)
);

-- One person belongs to exactly one space. This is the invariant behind
-- public.current_space_id() and prevents a user from being counted in two
-- relationship spaces at once.
create unique index if not exists space_members_one_space_per_user_idx
  on public.space_members (user_id);

-- A space has at most one owner.
create unique index if not exists space_members_one_owner_idx
  on public.space_members (space_id)
  where role = 'owner';

create index if not exists space_members_space_id_idx
  on public.space_members (space_id);

-- ---------------------------------------------------------------------------
-- space_invites
-- Only the SHA-256 hash of an invite token is stored. The plaintext token is
-- returned once by public.create_space_invite().
-- ---------------------------------------------------------------------------
create table if not exists public.space_invites (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  token_hash text not null,
  invited_email text,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint space_invites_token_hash_key unique (token_hash),
  constraint space_invites_token_hash_format
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint space_invites_expiry_check check (expires_at > created_at)
);

create index if not exists space_invites_space_id_idx
  on public.space_invites (space_id);
create index if not exists space_invites_active_lookup_idx
  on public.space_invites (token_hash)
  where used_at is null and revoked_at is null;

-- ---------------------------------------------------------------------------
-- memories
-- ---------------------------------------------------------------------------
create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  body_md text not null default '',
  occurred_on date not null,
  occurred_time time without time zone,
  occurred_at timestamptz not null,
  visibility text not null default 'shared',
  location_label text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint memories_title_check
    check (char_length(title) between 1 and 120 and btrim(title) <> ''),
  constraint memories_visibility_check
    check (visibility in ('shared', 'private'))
);

create index if not exists memories_space_occurred_idx
  on public.memories (space_id, occurred_at desc)
  where deleted_at is null;
create index if not exists memories_author_idx
  on public.memories (author_id);
create index if not exists memories_tags_idx
  on public.memories using gin (tags);

-- ---------------------------------------------------------------------------
-- attachments
-- storage_path must start with "<space_id>/" (enforced by trigger below).
-- ---------------------------------------------------------------------------
create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  memory_id uuid not null references public.memories (id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  byte_size bigint not null,
  sha256 text,
  kind text not null,
  created_at timestamptz not null default now(),
  constraint attachments_storage_path_key unique (storage_path),
  constraint attachments_byte_size_check check (byte_size > 0),
  constraint attachments_kind_check check (kind in ('image', 'video', 'audio')),
  constraint attachments_sha256_format
    check (sha256 is null or sha256 ~ '^[0-9a-fA-F]{64}$')
);

create index if not exists attachments_memory_id_idx
  on public.attachments (memory_id);
create index if not exists attachments_space_id_idx
  on public.attachments (space_id);

-- ---------------------------------------------------------------------------
-- anniversaries
-- ---------------------------------------------------------------------------
create table if not exists public.anniversaries (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  date date not null,
  repeat text not null default 'yearly',
  visibility text not null default 'shared',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint anniversaries_name_check
    check (char_length(name) between 1 and 120 and btrim(name) <> ''),
  constraint anniversaries_repeat_check check (repeat in ('yearly', 'once')),
  constraint anniversaries_visibility_check
    check (visibility in ('shared', 'private'))
);

create index if not exists anniversaries_space_date_idx
  on public.anniversaries (space_id, date);

-- ---------------------------------------------------------------------------
-- capsules (metadata only)
-- ---------------------------------------------------------------------------
create table if not exists public.capsules (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  opens_at timestamptz not null,
  visibility text not null default 'shared',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint capsules_title_check
    check (char_length(title) between 1 and 120 and btrim(title) <> ''),
  constraint capsules_visibility_check
    check (visibility in ('shared', 'private'))
);

create index if not exists capsules_space_opens_idx
  on public.capsules (space_id, opens_at);

-- ---------------------------------------------------------------------------
-- capsule_contents (sealed body)
-- ---------------------------------------------------------------------------
create table if not exists public.capsule_contents (
  capsule_id uuid primary key references public.capsules (id) on delete cascade,
  body_md text not null default '',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- activity_logs (never contains body_md or other content)
-- ---------------------------------------------------------------------------
create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  actor_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  target_id uuid,
  created_at timestamptz not null default now(),
  constraint activity_logs_action_check
    check (char_length(action) between 1 and 80 and btrim(action) <> '')
);

create index if not exists activity_logs_space_created_idx
  on public.activity_logs (space_id, created_at desc);

-- ---------------------------------------------------------------------------
-- user_ai_preferences (default: AI external calls disabled)
-- ---------------------------------------------------------------------------
create table if not exists public.user_ai_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default false,
  consent_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Generic updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists memories_set_updated_at on public.memories;
create trigger memories_set_updated_at
  before update on public.memories
  for each row execute function public.set_updated_at();

drop trigger if exists anniversaries_set_updated_at on public.anniversaries;
create trigger anniversaries_set_updated_at
  before update on public.anniversaries
  for each row execute function public.set_updated_at();

drop trigger if exists capsules_set_updated_at on public.capsules;
create trigger capsules_set_updated_at
  before update on public.capsules
  for each row execute function public.set_updated_at();

drop trigger if exists user_ai_preferences_set_updated_at on public.user_ai_preferences;
create trigger user_ai_preferences_set_updated_at
  before update on public.user_ai_preferences
  for each row execute function public.set_updated_at();

-- Record the moment a user first explicitly enables AI. Disabling does not
-- erase the historical consent timestamp.
create or replace function public.set_ai_consent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.enabled and new.consent_at is null then
    new.consent_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists user_ai_preferences_set_consent on public.user_ai_preferences;
create trigger user_ai_preferences_set_consent
  before insert or update on public.user_ai_preferences
  for each row execute function public.set_ai_consent();

-- ---------------------------------------------------------------------------
-- Capacity: at most two members. Also lock the space row so two concurrent
-- accepts cannot both observe capacity 1 and insert a third member.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_space_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform 1
  from public.spaces s
  where s.id = new.space_id
  for update;

  if not found then
    raise exception 'SPACE_NOT_FOUND' using errcode = 'P0001';
  end if;

  select count(*)::integer
  into v_count
  from public.space_members sm
  where sm.space_id = new.space_id;

  if v_count >= 2 then
    raise exception 'SPACE_FULL' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists space_members_capacity on public.space_members;
create trigger space_members_capacity
  before insert on public.space_members
  for each row execute function public.enforce_space_capacity();

-- ---------------------------------------------------------------------------
-- Attachment path / space binding.
-- A path must be "<memory.space_id>/<memory_id>/<file>". The storage policy
-- applies the same shape for new uploads, and read/write helpers re-check it.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_attachment_path()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space_id uuid;
begin
  select m.space_id
  into v_space_id
  from public.memories m
  where m.id = new.memory_id;

  if not found then
    raise exception 'ATTACHMENT_MEMORY_NOT_FOUND' using errcode = 'P0001';
  end if;

  if new.space_id is distinct from v_space_id then
    raise exception 'ATTACHMENT_SPACE_MISMATCH' using errcode = 'P0001';
  end if;

  if new.storage_path is null
     or split_part(new.storage_path, '/', 1) <> v_space_id::text
     or split_part(new.storage_path, '/', 2) <> new.memory_id::text
     or split_part(new.storage_path, '/', 3) = '' then
    raise exception 'ATTACHMENT_PATH_MISMATCH' using errcode = 'P0001';
  end if;

  if position('..' in new.storage_path) > 0 then
    raise exception 'ATTACHMENT_PATH_INVALID' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists attachments_enforce_path on public.attachments;
create trigger attachments_enforce_path
  before insert or update on public.attachments
  for each row execute function public.enforce_attachment_path();

-- ---------------------------------------------------------------------------
-- Capsule schedule rules.
--   * a capsule is created with a future opens_at;
--   * opens_at, space_id and author_id are immutable;
--   * no update is accepted once the server clock reaches opens_at.
-- Tests simulate the passage of time with session_replication_role = replica
-- (superuser-only) and then re-enable triggers.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_capsule_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.opens_at <= now() then
      raise exception 'CAPSULE_OPEN_TIME_MUST_BE_FUTURE' using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.opens_at is distinct from old.opens_at then
    raise exception 'CAPSULE_OPEN_TIME_IMMUTABLE' using errcode = 'P0001';
  end if;

  if new.space_id is distinct from old.space_id
     or new.author_id is distinct from old.author_id then
    raise exception 'CAPSULE_OWNER_IMMUTABLE' using errcode = 'P0001';
  end if;

  if now() >= old.opens_at then
    raise exception 'CAPSULE_ALREADY_OPEN' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists capsules_enforce_write on public.capsules;
create trigger capsules_enforce_write
  before insert or update on public.capsules
  for each row execute function public.enforce_capsule_write();

-- Server-side defence in depth for the sealed body. RLS already hides the row
-- before open; this trigger also refuses writes that would create/alter a body
-- after the capsule has opened.
create or replace function public.enforce_capsule_content_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opens_at timestamptz;
begin
  if tg_op = 'UPDATE' and new.capsule_id is distinct from old.capsule_id then
    raise exception 'CAPSULE_CONTENT_IMMUTABLE' using errcode = 'P0001';
  end if;

  select c.opens_at
  into v_opens_at
  from public.capsules c
  where c.id = new.capsule_id;

  if not found then
    raise exception 'CAPSULE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if now() >= v_opens_at then
    raise exception 'CAPSULE_SEALED' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists capsule_contents_enforce_seal on public.capsule_contents;
create trigger capsule_contents_enforce_seal
  before insert or update on public.capsule_contents
  for each row execute function public.enforce_capsule_content_write();

-- ---------------------------------------------------------------------------
-- Small immutable guards for ownership columns (defence beyond RLS).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_memory_immutable_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.space_id is distinct from old.space_id
     or new.author_id is distinct from old.author_id then
    raise exception 'MEMORY_OWNER_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists memories_immutable_owner on public.memories;
create trigger memories_immutable_owner
  before update on public.memories
  for each row execute function public.enforce_memory_immutable_owner();

create or replace function public.enforce_anniversary_immutable_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.space_id is distinct from old.space_id
     or new.author_id is distinct from old.author_id then
    raise exception 'ANNIVERSARY_OWNER_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists anniversaries_immutable_owner on public.anniversaries;
create trigger anniversaries_immutable_owner
  before update on public.anniversaries
  for each row execute function public.enforce_anniversary_immutable_owner();
