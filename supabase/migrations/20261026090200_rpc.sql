-- OURVERSE RPCs
--
-- These are the only supported write paths for spaces, membership, invites and
-- removal. All are SECURITY DEFINER with an empty search_path. The frontend
-- calls them through supabase-js `.rpc(...)`.

-- ---------------------------------------------------------------------------
-- create_space(display_name, motto = null)
-- Creates the space and its owner membership atomically. A user may only belong
-- to one space. The DB constraint is the final guard against concurrent calls.
-- ---------------------------------------------------------------------------
create or replace function public.create_space(
  p_display_name text,
  p_motto text default null
)
returns public.spaces
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_motto text;
  v_space public.spaces;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  v_name := btrim(coalesce(p_display_name, ''));
  if char_length(v_name) not between 1 and 40 then
    raise exception 'INVALID_DISPLAY_NAME' using errcode = 'P0001';
  end if;

  v_motto := btrim(coalesce(p_motto, ''));
  if v_motto = '' then
    v_motto := '把故事留在星光里。';
  end if;
  if char_length(v_motto) > 200 then
    raise exception 'INVALID_MOTTO' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.space_members sm
    where sm.user_id = v_uid
  ) then
    raise exception 'USER_ALREADY_IN_SPACE' using errcode = 'P0001';
  end if;

  insert into public.spaces (display_name, created_by, motto)
  values (v_name, v_uid, v_motto)
  returning * into v_space;

  insert into public.space_members (space_id, user_id, role)
  values (v_space.id, v_uid, 'owner');

  insert into public.activity_logs (space_id, actor_id, action, target_id)
  values (v_space.id, v_uid, 'space.created', v_space.id);

  return v_space;
end;
$$;

revoke all on function public.create_space(text, text) from public;
grant execute on function public.create_space(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- create_space_invite(invited_email = null, ttl_hours = 72)
-- Owner-only. Stores only SHA-256(token). Returns the plaintext token once.
-- ---------------------------------------------------------------------------
create or replace function public.create_space_invite(
  p_invited_email text default null,
  p_ttl_hours integer default 72
)
returns table (
  invite_id uuid,
  space_id uuid,
  token text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_space_id uuid;
  v_email text;
  v_token text;
  v_hash text;
  v_expires_at timestamptz;
  v_invite_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select sm.space_id
  into v_space_id
  from public.space_members sm
  where sm.user_id = v_uid
    and sm.role = 'owner'
  limit 1;

  if v_space_id is null then
    raise exception 'NOT_SPACE_OWNER' using errcode = 'P0001';
  end if;

  -- Serialize invite creation against membership changes.
  perform 1
  from public.spaces s
  where s.id = v_space_id
  for update;

  if (
    select count(*)
    from public.space_members sm
    where sm.space_id = v_space_id
  ) >= 2 then
    raise exception 'SPACE_FULL' using errcode = 'P0001';
  end if;

  if p_ttl_hours is null or p_ttl_hours < 1 or p_ttl_hours > 720 then
    raise exception 'INVALID_TTL' using errcode = 'P0001';
  end if;

  if p_invited_email is not null and btrim(p_invited_email) <> '' then
    v_email := lower(btrim(p_invited_email));
    if char_length(v_email) > 320
       or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'INVALID_EMAIL' using errcode = 'P0001';
    end if;
  end if;

  -- 256 bits of CSPRNG entropy. Hex keeps the token URL-safe.
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
  v_expires_at := now() + make_interval(hours => p_ttl_hours);

  insert into public.space_invites (
    space_id,
    token_hash,
    invited_email,
    expires_at,
    created_by
  )
  values (
    v_space_id,
    v_hash,
    v_email,
    v_expires_at,
    v_uid
  )
  returning id into v_invite_id;

  return query
    select v_invite_id, v_space_id, v_token, v_expires_at;
end;
$$;

revoke all on function public.create_space_invite(text, integer) from public;
grant execute on function public.create_space_invite(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- accept_space_invite(token)
-- Locks invite and space, validates every condition, inserts the member and
-- marks the invite used. Returns the joined space id.
-- ---------------------------------------------------------------------------
create or replace function public.accept_space_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_invite public.space_invites%rowtype;
  v_member_count integer;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  if p_token is null or btrim(p_token) = '' then
    raise exception 'INVALID_INVITE' using errcode = 'P0001';
  end if;

  v_hash := encode(extensions.digest(btrim(p_token), 'sha256'), 'hex');

  select *
  into v_invite
  from public.space_invites si
  where si.token_hash = v_hash
  for update;

  if not found then
    raise exception 'INVALID_INVITE' using errcode = 'P0001';
  end if;

  if v_invite.revoked_at is not null then
    raise exception 'INVITE_REVOKED' using errcode = 'P0001';
  end if;

  if v_invite.used_at is not null then
    raise exception 'INVITE_USED' using errcode = 'P0001';
  end if;

  if v_invite.expires_at <= now() then
    raise exception 'INVITE_EXPIRED' using errcode = 'P0001';
  end if;

  perform 1
  from public.spaces s
  where s.id = v_invite.space_id
  for update;

  if not found then
    raise exception 'INVALID_INVITE' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.space_members sm
    where sm.space_id = v_invite.space_id
      and sm.user_id = v_uid
  ) then
    raise exception 'INVITE_ALREADY_MEMBER' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.space_members sm
    where sm.user_id = v_uid
  ) then
    raise exception 'USER_ALREADY_IN_SPACE' using errcode = 'P0001';
  end if;

  select count(*)::integer
  into v_member_count
  from public.space_members sm
  where sm.space_id = v_invite.space_id;

  if v_member_count >= 2 then
    raise exception 'SPACE_FULL' using errcode = 'P0001';
  end if;

  insert into public.space_members (space_id, user_id, role)
  values (v_invite.space_id, v_uid, 'member');

  update public.space_invites
  set used_at = now()
  where id = v_invite.id
    and used_at is null;

  if not found then
    raise exception 'INVITE_USED' using errcode = 'P0001';
  end if;

  insert into public.activity_logs (space_id, actor_id, action, target_id)
  values (v_invite.space_id, v_uid, 'member.joined', v_uid);

  return v_invite.space_id;
end;
$$;

revoke all on function public.accept_space_invite(text) from public;
grant execute on function public.accept_space_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- revoke_space_invite(invite_id)
-- Owner-only. Idempotent: revoking an already inactive invite is a no-op.
-- ---------------------------------------------------------------------------
create or replace function public.revoke_space_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_space_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select si.space_id
  into v_space_id
  from public.space_invites si
  where si.id = p_invite_id;

  if not found then
    raise exception 'INVITE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not public.is_space_owner(v_space_id) then
    raise exception 'NOT_SPACE_OWNER' using errcode = 'P0001';
  end if;

  update public.space_invites
  set revoked_at = now()
  where id = p_invite_id
    and revoked_at is null
    and used_at is null;
end;
$$;

revoke all on function public.revoke_space_invite(uuid) from public;
grant execute on function public.revoke_space_invite(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- remove_space_member(member_user_id)
-- Owner-only. Deleting the membership row makes every subsequent RLS check fail
-- immediately; existing JWTs do not preserve access.
-- ---------------------------------------------------------------------------
create or replace function public.remove_space_member(p_member_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_space_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select sm.space_id
  into v_space_id
  from public.space_members sm
  where sm.user_id = v_uid
    and sm.role = 'owner'
  limit 1;

  if v_space_id is null then
    raise exception 'NOT_SPACE_OWNER' using errcode = 'P0001';
  end if;

  if p_member_user_id = v_uid then
    raise exception 'CANNOT_REMOVE_OWNER' using errcode = 'P0001';
  end if;

  delete from public.space_members sm
  where sm.space_id = v_space_id
    and sm.user_id = p_member_user_id
    and sm.role = 'member';

  if not found then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.remove_space_member(uuid) from public;
grant execute on function public.remove_space_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- preview_space_invite(token)
-- Callable by anon so /login?invite=... can show a neutral preview. It exposes
-- only the space display name, expiry and a validity reason — never member
-- identities, emails, contents or counts.
-- ---------------------------------------------------------------------------
create or replace function public.preview_space_invite(p_token text)
returns table (
  space_display_name text,
  expires_at timestamptz,
  valid boolean,
  reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_invite public.space_invites%rowtype;
  v_name text;
  v_member_count integer;
begin
  if p_token is null or btrim(p_token) = '' then
    return query select null::text, null::timestamptz, false, 'invite_invalid';
    return;
  end if;

  v_hash := encode(extensions.digest(btrim(p_token), 'sha256'), 'hex');

  select *
  into v_invite
  from public.space_invites si
  where si.token_hash = v_hash;

  if not found then
    return query select null::text, null::timestamptz, false, 'invite_invalid';
    return;
  end if;

  select s.display_name
  into v_name
  from public.spaces s
  where s.id = v_invite.space_id;

  if v_invite.revoked_at is not null then
    return query select v_name, v_invite.expires_at, false, 'invite_revoked';
    return;
  end if;

  if v_invite.used_at is not null then
    return query select v_name, v_invite.expires_at, false, 'invite_used';
    return;
  end if;

  if v_invite.expires_at <= now() then
    return query select v_name, v_invite.expires_at, false, 'invite_expired';
    return;
  end if;

  select count(*)::integer
  into v_member_count
  from public.space_members sm
  where sm.space_id = v_invite.space_id;

  if v_member_count >= 2 then
    return query select v_name, v_invite.expires_at, false, 'space_full';
    return;
  end if;

  return query select v_name, v_invite.expires_at, true, 'ok';
end;
$$;

revoke all on function public.preview_space_invite(text) from public;
grant execute on function public.preview_space_invite(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- list_space_members()
-- Support RPC for the repository's SpaceMember.profile field. It returns only
-- members of the caller's own space. auth.users is not exposed directly.
-- ---------------------------------------------------------------------------
create or replace function public.list_space_members()
returns table (
  id uuid,
  space_id uuid,
  user_id uuid,
  role text,
  joined_at timestamptz,
  email text,
  display_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    sm.id,
    sm.space_id,
    sm.user_id,
    sm.role,
    sm.joined_at,
    u.email,
    coalesce(
      nullif(u.raw_user_meta_data ->> 'display_name', ''),
      nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
      '成员'
    ) as display_name
  from public.space_members sm
  join auth.users u on u.id = sm.user_id
  where sm.space_id = public.current_space_id()
  order by sm.joined_at;
$$;

revoke all on function public.list_space_members() from public;
grant execute on function public.list_space_members() to authenticated;
