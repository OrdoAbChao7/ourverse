-- Server-authoritative timestamps for the Supabase repository.
--
-- Capsule locks and invite expiry must never be decided by the device clock.
-- The repository asks `server_now()` once and then extrapolates locally,
-- refreshing the offset periodically instead of polling every second.
--
-- Idempotent: safe to replay with `supabase db reset`.

create or replace function public.server_now()
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.now();
$$;

revoke all on function public.server_now() from public;
grant execute on function public.server_now() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- soft_delete_memory(memory_id)
--
-- Soft delete needs a SECURITY DEFINER path. The SELECT policy hides rows with
-- `deleted_at` set, and PostgreSQL also requires an UPDATE's new row to remain
-- visible under SELECT policies, so a direct client UPDATE fails with 42501
-- ("new row violates row-level security policy"). This function keeps the row
-- in place, checks the caller is its author and a space member, and stamps the
-- deletion with the server clock rather than a device-supplied timestamp.
-- ---------------------------------------------------------------------------
create or replace function public.soft_delete_memory(p_memory_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.memories m
    where m.id = p_memory_id
      and m.author_id = v_uid
      and m.deleted_at is null
      and public.is_space_member(m.space_id)
  ) then
    raise exception 'MEMORY_NOT_FOUND' using errcode = 'P0001';
  end if;

  update public.memories
  set deleted_at = pg_catalog.now()
  where id = p_memory_id
    and deleted_at is null;
end;
$$;

revoke all on function public.soft_delete_memory(uuid) from public;
grant execute on function public.soft_delete_memory(uuid) to authenticated;
