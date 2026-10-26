-- OURVERSE — security helpers, grants, RLS, private storage.
--
-- Design notes:
--   * SECURITY DEFINER helpers are owned by the migration role and use
--     `set search_path = ''` plus fully-qualified names.
--   * policies never query a protected table in a way that re-enters the same
--     policy recursively; membership is checked through helper functions.
--   * anon has no table privileges at all. An anonymous visitor can only call
--     preview_space_invite(token), which intentionally reveals the space name
--     to the holder of an unguessable invitation token.
--   * writes to spaces / space_members / invites go through RPC only.

-- ---------------------------------------------------------------------------
-- Membership helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_space_member(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and exists (
       select 1
       from public.space_members sm
       where sm.space_id = p_space_id
         and sm.user_id = auth.uid()
     );
$$;

create or replace function public.is_space_owner(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and exists (
       select 1
       from public.space_members sm
       where sm.space_id = p_space_id
         and sm.user_id = auth.uid()
         and sm.role = 'owner'
     );
$$;

-- Each user has exactly one space (enforced by a unique index on
-- space_members.user_id). Returns null for anonymous/non-members.
create or replace function public.current_space_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select sm.space_id
  from public.space_members sm
  where sm.user_id = auth.uid()
  order by sm.joined_at
  limit 1;
$$;

-- A memory is visible when the caller is a current member and the memory is
-- shared or authored by the caller. Deleted memories are never visible.
create or replace function public.memory_visible(p_memory_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and exists (
       select 1
       from public.memories m
       where m.id = p_memory_id
         and m.deleted_at is null
         and public.is_space_member(m.space_id)
         and (m.visibility = 'shared' or m.author_id = auth.uid())
     );
$$;

create or replace function public.can_write_memory(p_memory_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and exists (
       select 1
       from public.memories m
       where m.id = p_memory_id
         and m.deleted_at is null
         and m.author_id = auth.uid()
         and public.is_space_member(m.space_id)
     );
$$;

revoke all on function public.is_space_member(uuid) from public;
revoke all on function public.is_space_owner(uuid) from public;
revoke all on function public.current_space_id() from public;
revoke all on function public.memory_visible(uuid) from public;
revoke all on function public.can_write_memory(uuid) from public;
grant execute on function public.is_space_member(uuid) to anon, authenticated, service_role;
grant execute on function public.is_space_owner(uuid) to anon, authenticated, service_role;
grant execute on function public.current_space_id() to anon, authenticated, service_role;
grant execute on function public.memory_visible(uuid) to anon, authenticated, service_role;
grant execute on function public.can_write_memory(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Storage path helpers
-- New uploads use "<space_id>/<memory_id>/<file>". Attachment rows must at
-- minimum start with "<space_id>/" (trigger enforced independently).
-- ---------------------------------------------------------------------------
create or replace function public.storage_space_id(p_object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_segment text;
begin
  if p_object_name is null then
    return null;
  end if;

  v_segment := split_part(p_object_name, '/', 1);
  if v_segment !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;

  return v_segment::uuid;
exception
  when others then
    return null;
end;
$$;

create or replace function public.storage_memory_id(p_object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_segment text;
begin
  if p_object_name is null
     or array_length(string_to_array(p_object_name, '/'), 1) < 3 then
    return null;
  end if;

  v_segment := split_part(p_object_name, '/', 2);
  if v_segment !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;

  return v_segment::uuid;
exception
  when others then
    return null;
end;
$$;

create or replace function public.can_read_storage_object(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and exists (
       select 1
       from public.attachments a
       join public.memories m on m.id = a.memory_id
       where a.storage_path = p_object_name
         and a.space_id = m.space_id
         and public.storage_space_id(a.storage_path) = a.space_id
         and public.storage_memory_id(a.storage_path) = a.memory_id
         and m.deleted_at is null
         and public.is_space_member(m.space_id)
         and (m.visibility = 'shared' or m.author_id = auth.uid())
     );
$$;

create or replace function public.can_upload_storage_object(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and position('..' in p_object_name) = 0
     and split_part(p_object_name, '/', 3) <> ''
     and public.storage_space_id(p_object_name) is not null
     and public.storage_space_id(p_object_name) = public.current_space_id()
     and public.storage_memory_id(p_object_name) is not null
     and exists (
       select 1
       from public.memories m
       where m.id = public.storage_memory_id(p_object_name)
         and m.space_id = public.current_space_id()
         and m.author_id = auth.uid()
         and m.deleted_at is null
         and public.is_space_member(m.space_id)
     );
$$;

create or replace function public.can_write_storage_object(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and exists (
       select 1
       from public.attachments a
       join public.memories m on m.id = a.memory_id
       where a.storage_path = p_object_name
         and a.space_id = m.space_id
         and public.storage_space_id(a.storage_path) = a.space_id
         and public.storage_memory_id(a.storage_path) = a.memory_id
         and m.deleted_at is null
         and m.author_id = auth.uid()
         and public.is_space_member(m.space_id)
     );
$$;

revoke all on function public.storage_space_id(text) from public;
revoke all on function public.storage_memory_id(text) from public;
revoke all on function public.can_read_storage_object(text) from public;
revoke all on function public.can_upload_storage_object(text) from public;
revoke all on function public.can_write_storage_object(text) from public;
grant execute on function public.storage_space_id(text) to authenticated, service_role;
grant execute on function public.storage_memory_id(text) to authenticated, service_role;
grant execute on function public.can_read_storage_object(text) to authenticated, service_role;
grant execute on function public.can_upload_storage_object(text) to authenticated, service_role;
grant execute on function public.can_write_storage_object(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Table privileges: anon gets nothing. Authenticated gets only what the client
-- repository needs. Membership/invite/space creation is RPC-only.
-- ---------------------------------------------------------------------------
revoke all on table public.spaces from public, anon, authenticated;
revoke all on table public.space_members from public, anon, authenticated;
revoke all on table public.space_invites from public, anon, authenticated;
revoke all on table public.memories from public, anon, authenticated;
revoke all on table public.attachments from public, anon, authenticated;
revoke all on table public.anniversaries from public, anon, authenticated;
revoke all on table public.capsules from public, anon, authenticated;
revoke all on table public.capsule_contents from public, anon, authenticated;
revoke all on table public.activity_logs from public, anon, authenticated;
revoke all on table public.user_ai_preferences from public, anon, authenticated;

grant select on table public.spaces to authenticated;
grant update (display_name, relationship_start_at, motto, accent)
  on table public.spaces to authenticated;
grant select on table public.space_members to authenticated;
grant select on table public.space_invites to authenticated;

grant select, insert, delete on table public.memories to authenticated;
grant update (
  title,
  body_md,
  occurred_on,
  occurred_time,
  occurred_at,
  visibility,
  location_label,
  tags,
  deleted_at
) on table public.memories to authenticated;

grant select, insert, delete on table public.attachments to authenticated;
grant update (file_name, mime_type, byte_size, sha256, kind, storage_path)
  on table public.attachments to authenticated;

grant select, insert, delete on table public.anniversaries to authenticated;
grant update (name, date, repeat, visibility, note)
  on table public.anniversaries to authenticated;

grant select, insert, delete on table public.capsules to authenticated;
-- opens_at is granted so the BEFORE trigger, not only a column privilege, is the
-- tested enforcement point; the trigger rejects every distinct value and all
-- updates after opening.
grant update (title, visibility, opens_at)
  on table public.capsules to authenticated;

grant select, insert on table public.capsule_contents to authenticated;
grant update (body_md) on table public.capsule_contents to authenticated;

grant select, insert on table public.activity_logs to authenticated;

grant select, delete on table public.user_ai_preferences to authenticated;
grant insert (user_id, enabled)
  on table public.user_ai_preferences to authenticated;
grant update (enabled) on table public.user_ai_preferences to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.space_invites enable row level security;
alter table public.memories enable row level security;
alter table public.attachments enable row level security;
alter table public.anniversaries enable row level security;
alter table public.capsules enable row level security;
alter table public.capsule_contents enable row level security;
alter table public.activity_logs enable row level security;
alter table public.user_ai_preferences enable row level security;

-- spaces: members can read and update, but cannot create/delete directly.
drop policy if exists spaces_select_members on public.spaces;
create policy spaces_select_members
  on public.spaces for select to authenticated
  using (public.is_space_member(id));

drop policy if exists spaces_update_members on public.spaces;
create policy spaces_update_members
  on public.spaces for update to authenticated
  using (public.is_space_member(id))
  with check (public.is_space_member(id));

-- space_members: co-members only. No client writes.
drop policy if exists space_members_select_same_space on public.space_members;
create policy space_members_select_same_space
  on public.space_members for select to authenticated
  using (public.is_space_member(space_id));

-- space_invites: owner can inspect invite metadata. Writes are RPC-only and
-- the token hash is never useful as a credential.
drop policy if exists space_invites_select_owner on public.space_invites;
create policy space_invites_select_owner
  on public.space_invites for select to authenticated
  using (public.is_space_owner(space_id));

-- memories
drop policy if exists memories_select_visible on public.memories;
create policy memories_select_visible
  on public.memories for select to authenticated
  using (
    deleted_at is null
    and public.is_space_member(space_id)
    and (visibility = 'shared' or author_id = auth.uid())
  );

drop policy if exists memories_insert_author on public.memories;
create policy memories_insert_author
  on public.memories for insert to authenticated
  with check (
    author_id = auth.uid()
    and deleted_at is null
    and public.is_space_member(space_id)
  );

drop policy if exists memories_update_author on public.memories;
create policy memories_update_author
  on public.memories for update to authenticated
  using (
    author_id = auth.uid()
    and deleted_at is null
    and public.is_space_member(space_id)
  )
  with check (
    author_id = auth.uid()
    and public.is_space_member(space_id)
  );

drop policy if exists memories_delete_author on public.memories;
create policy memories_delete_author
  on public.memories for delete to authenticated
  using (author_id = auth.uid() and public.is_space_member(space_id));

-- attachments inherit the parent memory's visibility.
drop policy if exists attachments_select_visible on public.attachments;
create policy attachments_select_visible
  on public.attachments for select to authenticated
  using (public.memory_visible(memory_id) and public.is_space_member(space_id));

drop policy if exists attachments_insert_author on public.attachments;
create policy attachments_insert_author
  on public.attachments for insert to authenticated
  with check (
    public.is_space_member(space_id)
    and public.can_write_memory(memory_id)
  );

drop policy if exists attachments_update_author on public.attachments;
create policy attachments_update_author
  on public.attachments for update to authenticated
  using (public.is_space_member(space_id) and public.can_write_memory(memory_id))
  with check (public.is_space_member(space_id) and public.can_write_memory(memory_id));

drop policy if exists attachments_delete_author on public.attachments;
create policy attachments_delete_author
  on public.attachments for delete to authenticated
  using (public.is_space_member(space_id) and public.can_write_memory(memory_id));

-- anniversaries
drop policy if exists anniversaries_select_visible on public.anniversaries;
create policy anniversaries_select_visible
  on public.anniversaries for select to authenticated
  using (
    public.is_space_member(space_id)
    and (visibility = 'shared' or author_id = auth.uid())
  );

drop policy if exists anniversaries_insert_author on public.anniversaries;
create policy anniversaries_insert_author
  on public.anniversaries for insert to authenticated
  with check (author_id = auth.uid() and public.is_space_member(space_id));

drop policy if exists anniversaries_update_author on public.anniversaries;
create policy anniversaries_update_author
  on public.anniversaries for update to authenticated
  using (author_id = auth.uid() and public.is_space_member(space_id))
  with check (author_id = auth.uid() and public.is_space_member(space_id));

drop policy if exists anniversaries_delete_author on public.anniversaries;
create policy anniversaries_delete_author
  on public.anniversaries for delete to authenticated
  using (author_id = auth.uid() and public.is_space_member(space_id));

-- capsules: metadata may be seen by the same audience as a memory.
drop policy if exists capsules_select_visible on public.capsules;
create policy capsules_select_visible
  on public.capsules for select to authenticated
  using (
    public.is_space_member(space_id)
    and (visibility = 'shared' or author_id = auth.uid())
  );

drop policy if exists capsules_insert_author on public.capsules;
create policy capsules_insert_author
  on public.capsules for insert to authenticated
  with check (author_id = auth.uid() and public.is_space_member(space_id));

drop policy if exists capsules_update_author_before_open on public.capsules;
create policy capsules_update_author_before_open
  on public.capsules for update to authenticated
  using (
    author_id = auth.uid()
    and public.is_space_member(space_id)
    and now() < opens_at
  )
  with check (
    author_id = auth.uid()
    and public.is_space_member(space_id)
    and now() < opens_at
  );

drop policy if exists capsules_delete_author on public.capsules;
create policy capsules_delete_author
  on public.capsules for delete to authenticated
  using (author_id = auth.uid() and public.is_space_member(space_id));

-- capsule_contents: the server-side seal. The row is invisible to every client
-- (including the author) until the database clock reaches opens_at.
drop policy if exists capsule_contents_select_after_open on public.capsule_contents;
create policy capsule_contents_select_after_open
  on public.capsule_contents for select to authenticated
  using (
    exists (
      select 1
      from public.capsules c
      where c.id = capsule_id
        and public.is_space_member(c.space_id)
        and (c.visibility = 'shared' or c.author_id = auth.uid())
        and now() >= c.opens_at
    )
  );

drop policy if exists capsule_contents_insert_author_before_open on public.capsule_contents;
create policy capsule_contents_insert_author_before_open
  on public.capsule_contents for insert to authenticated
  with check (
    exists (
      select 1
      from public.capsules c
      where c.id = capsule_id
        and c.author_id = auth.uid()
        and public.is_space_member(c.space_id)
        and now() < c.opens_at
    )
  );

drop policy if exists capsule_contents_update_author_before_open on public.capsule_contents;
create policy capsule_contents_update_author_before_open
  on public.capsule_contents for update to authenticated
  using (
    exists (
      select 1
      from public.capsules c
      where c.id = capsule_id
        and c.author_id = auth.uid()
        and public.is_space_member(c.space_id)
        and now() < c.opens_at
    )
  )
  with check (
    exists (
      select 1
      from public.capsules c
      where c.id = capsule_id
        and c.author_id = auth.uid()
        and public.is_space_member(c.space_id)
        and now() < c.opens_at
    )
  );

-- activity_logs: minimal audit entries, no content. Members can read and write
-- only as themselves.
drop policy if exists activity_logs_select_members on public.activity_logs;
create policy activity_logs_select_members
  on public.activity_logs for select to authenticated
  using (public.is_space_member(space_id));

drop policy if exists activity_logs_insert_actor on public.activity_logs;
create policy activity_logs_insert_actor
  on public.activity_logs for insert to authenticated
  with check (actor_id = auth.uid() and public.is_space_member(space_id));

-- user_ai_preferences: strictly self-service.
drop policy if exists user_ai_preferences_select_own on public.user_ai_preferences;
create policy user_ai_preferences_select_own
  on public.user_ai_preferences for select to authenticated
  using (user_id = auth.uid());

drop policy if exists user_ai_preferences_insert_own on public.user_ai_preferences;
create policy user_ai_preferences_insert_own
  on public.user_ai_preferences for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists user_ai_preferences_update_own on public.user_ai_preferences;
create policy user_ai_preferences_update_own
  on public.user_ai_preferences for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists user_ai_preferences_delete_own on public.user_ai_preferences;
create policy user_ai_preferences_delete_own
  on public.user_ai_preferences for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Private storage bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'memories',
  'memories',
  false,
  83886080,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/webm',
    'audio/mpeg',
    'audio/mp4',
    'audio/aac',
    'audio/ogg',
    'audio/wav'
  ]::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Storage SELECT: only a co-member who can see the matching attachment's
-- parent memory. The existence of an attachments row is mandatory.
drop policy if exists ourverse_memories_select on storage.objects;
create policy ourverse_memories_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'memories'
    and public.can_read_storage_object(name)
  );

-- Storage INSERT: path must be "<current_space>/<authored_memory>/<file>".
drop policy if exists ourverse_memories_insert on storage.objects;
create policy ourverse_memories_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'memories'
    and public.can_upload_storage_object(name)
  );

-- Storage UPDATE / DELETE: only the memory's author.
drop policy if exists ourverse_memories_update on storage.objects;
create policy ourverse_memories_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'memories'
    and public.can_write_storage_object(name)
  )
  with check (
    bucket_id = 'memories'
    and public.can_write_storage_object(name)
  );

drop policy if exists ourverse_memories_delete on storage.objects;
create policy ourverse_memories_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'memories'
    and public.can_write_storage_object(name)
  );
