-- OURVERSE — real PostgreSQL RLS / permissions suite.
--
-- Run with:  npx supabase test db
-- Everything runs in one transaction and is rolled back, including local-only
-- auth.users fixtures. No real user data or credentials are used.
--
-- Identity simulation follows Supabase's PostgREST model:
--   set local role authenticated;
--   request.jwt.claims = {"sub":"<uuid>","role":"authenticated"}
-- auth.uid() reads those settings.
--
-- The capsule "time travel" step uses session_replication_role = replica as
-- the local superuser/test harness, then restores it. That is intentionally
-- impossible for client roles; clients cannot disable triggers.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(87);

create schema if not exists tests;
grant usage on schema tests to anon, authenticated;

create or replace function tests.claim(p_sub uuid, p_role text default 'authenticated')
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_sub, 'role', p_role)::text,
    true
  );
  perform set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), true);
end;
$$;

grant execute on function tests.claim(uuid, text) to anon, authenticated;

-- Local-only identities. Password hashes are irrelevant for RLS tests.
insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '11111111-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'alice@ourverse.test',
    extensions.crypt('local-test-only', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"A 星"}'::jsonb,
    now(),
    now()
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'bob@ourverse.test',
    extensions.crypt('local-test-only', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"B 月"}'::jsonb,
    now(),
    now()
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'third@ourverse.test',
    extensions.crypt('local-test-only', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"C 客"}'::jsonb,
    now(),
    now()
  );

set local role authenticated;
select tests.claim('11111111-1111-4111-8111-111111111111');
select public.create_space('星光小屋', '测试格言');
reset role;

select set_config(
  'test.space_id',
  (select id::text from public.spaces where display_name = '星光小屋'),
  true
);

select ok(
  (select count(*) = 1 from public.spaces where display_name = '星光小屋'),
  'A can create exactly one space through the RPC'
);
select is(
  (select count(*)::bigint from public.space_members where role = 'owner'),
  1::bigint,
  'create_space creates one owner membership atomically'
);

-- Create the invites before B joins: after B joins the space is full.
set local role authenticated;
select tests.claim('11111111-1111-4111-8111-111111111111');
select set_config(
  'test.token_b',
  token,
  true
)
from public.create_space_invite('bob@ourverse.test', 72);

select set_config('test.token_exp', token, true),
       set_config('test.exp_invite_id', invite_id::text, true)
from public.create_space_invite(null, 24);

select set_config('test.token_full', token, true)
from public.create_space_invite(null, 72);
reset role;

update public.space_invites
set created_at = now() - interval '2 hours',
    expires_at = now() - interval '1 hour'
where token_hash = encode(
  extensions.digest(current_setting('test.token_exp'), 'sha256'),
  'hex'
);

select ok(
  (
    select token_hash <> current_setting('test.token_b')
    from public.space_invites
    where token_hash = encode(
      extensions.digest(current_setting('test.token_b'), 'sha256'),
      'hex'
    )
  ),
  'invite storage contains only the SHA-256 hash, never the plaintext token'
);

-- Anonymous invite preview: the token holder may see the space name only.
set local role anon;
select tests.claim(null, 'anon');
select is(
  (select space_display_name from public.preview_space_invite(current_setting('test.token_b'))),
  '星光小屋',
  'anonymous invite preview reveals the space name to the token holder'
);
select is(
  (select valid from public.preview_space_invite(current_setting('test.token_b'))),
  true,
  'anonymous invite preview reports a valid invite'
);
select is(
  (select valid from public.preview_space_invite(current_setting('test.token_exp'))),
  false,
  'anonymous invite preview reports an expired invite as invalid'
);
select is(
  (select reason from public.preview_space_invite(current_setting('test.token_exp'))),
  'invite_expired',
  'expired invite preview gives the expected reason'
);
reset role;

-- B accepts the invite.
set local role authenticated;
select tests.claim('22222222-2222-4222-8222-222222222222');
select set_config(
  'test.b_accept_space',
  public.accept_space_invite(current_setting('test.token_b'))::text,
  true
);
reset role;

select is(
  current_setting('test.b_accept_space'),
  current_setting('test.space_id'),
  'B accepts the one-time invite and joins the expected space'
);
select is(
  (select count(*)::bigint from public.space_members),
  2::bigint,
  'the space now has exactly two members'
);
select is(
  (select role from public.space_members where user_id = '22222222-2222-4222-8222-222222222222'),
  'member',
  'the invitee joins with role member'
);

-- A can see both members; B can see both as well.
set local role authenticated;
select tests.claim('11111111-1111-4111-8111-111111111111');
select results_eq(
  $$ select user_id::text from public.space_members order by user_id $$,
  $$ values ('11111111-1111-4111-8111-111111111111'::text),
            ('22222222-2222-4222-8222-222222222222'::text) $$,
  'A reads exactly the two members of her space'
);
reset role;

set local role authenticated;
select tests.claim('22222222-2222-4222-8222-222222222222');
select is(
  (select count(*)::bigint from public.space_members),
  2::bigint,
  'B reads the same two-member space'
);
reset role;

-- C is authenticated but belongs to no space.
set local role authenticated;
select tests.claim('33333333-3333-4333-8333-333333333333');
select is(
  (select count(*)::bigint from public.spaces),
  0::bigint,
  'C cannot read any space'
);
select is(
  (select count(*)::bigint from public.space_members),
  0::bigint,
  'C cannot read any membership rows'
);
select is(
  (select count(*)::bigint from public.memories),
  0::bigint,
  'C cannot read any memories'
);
select throws_ok(
  $q$
    insert into public.memories (
      space_id, author_id, title, occurred_on, occurred_at, visibility
    )
    values (
      current_setting('test.space_id')::uuid,
      '33333333-3333-4333-8333-333333333333'::uuid,
      'intruder', current_date, now(), 'shared'
    )
  $q$,
  '42501',
  null::text,
  'C cannot insert a memory into a space she does not belong to'
);
select throws_ok(
  $q$
    insert into public.spaces (display_name, created_by)
    values ('rogue space', '33333333-3333-4333-8333-333333333333'::uuid)
  $q$,
  '42501',
  null::text,
  'clients cannot insert into spaces directly'
);
select throws_ok(
  $q$
    insert into public.space_members (space_id, user_id, role)
    values (
      current_setting('test.space_id')::uuid,
      '33333333-3333-4333-8333-333333333333'::uuid,
      'member'
    )
  $q$,
  '42501',
  null::text,
  'clients cannot insert memberships directly'
);
reset role;

-- ---------------------------------------------------------------------------
-- Memories and visibility
-- ---------------------------------------------------------------------------
set local role authenticated;
select tests.claim('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $q$
    insert into public.memories (
      id, space_id, author_id, title, body_md, occurred_on, occurred_time,
      occurred_at, visibility, location_label, tags
    )
    values (
      'a1111111-1111-4111-8111-111111111111',
      current_setting('test.space_id')::uuid,
      '11111111-1111-4111-8111-111111111111',
      'A 的私密记忆', '只有 A 能看到。', '2026-01-02', '20:30',
      now(), 'private', '书房', array['私密','测试']
    )
  $q$,
  'A creates a private memory'
);
select lives_ok(
  $q$
    insert into public.memories (
      id, space_id, author_id, title, body_md, occurred_on, occurred_at, visibility
    )
    values (
      'a2222222-2222-4222-8222-222222222222',
      current_setting('test.space_id')::uuid,
      '11111111-1111-4111-8111-111111111111',
      'A 的共享记忆', 'A 写给两个人的。', '2026-02-03', now(), 'shared'
    )
  $q$,
  'A creates a shared memory'
);
reset role;

set local role authenticated;
select tests.claim('22222222-2222-4222-8222-222222222222');
select lives_ok(
  $q$
    insert into public.memories (
      id, space_id, author_id, title, body_md, occurred_on, occurred_at, visibility
    )
    values (
      'b1111111-1111-4111-8111-111111111111',
      current_setting('test.space_id')::uuid,
      '22222222-2222-4222-8222-222222222222',
      'B 的共享记忆', 'B 写给两个人的。', '2026-03-04', now(), 'shared'
    )
  $q$,
  'B creates a shared memory'
);
select lives_ok(
  $q$
    insert into public.memories (
      id, space_id, author_id, title, body_md, occurred_on, occurred_at, visibility
    )
    values (
      'b2222222-2222-4222-8222-222222222222',
      current_setting('test.space_id')::uuid,
      '22222222-2222-4222-8222-222222222222',
      'B 的私密记忆', 'A 不能看到。', '2026-04-05', now(), 'private'
    )
  $q$,
  'B creates a private memory'
);
reset role;

set local role authenticated;
select tests.claim('11111111-1111-4111-8111-111111111111');
select is(
  (select count(*)::bigint from public.memories where id = 'a1111111-1111-4111-8111-111111111111'),
  1::bigint,
  'A reads her own private memory'
);
select is(
  (select count(*)::bigint from public.memories where id = 'b2222222-2222-4222-8222-222222222222'),
  0::bigint,
  'A cannot read B''s private memory'
);
select is(
  (select count(*)::bigint from public.memories where id = 'b1111111-1111-4111-8111-111111111111'),
  1::bigint,
  'A reads B''s shared memory'
);
with changed as (
  update public.memories
  set title = 'A 试图篡改 B'
  where id = 'b1111111-1111-4111-8111-111111111111'
  returning 1
)
select is(
  (select count(*)::bigint from changed),
  0::bigint,
  'A cannot update B''s memory'
);
with deleted as (
  delete from public.memories
  where id = 'b1111111-1111-4111-8111-111111111111'
  returning 1
)
select is(
  (select count(*)::bigint from deleted),
  0::bigint,
  'A cannot delete B''s memory'
);
reset role;

set local role authenticated;
select tests.claim('22222222-2222-4222-8222-222222222222');
select is(
  (select count(*)::bigint from public.memories where id = 'a1111111-1111-4111-8111-111111111111'),
  0::bigint,
  'B cannot read A''s private memory'
);
select is(
  (select count(*)::bigint from public.memories where id = 'a2222222-2222-4222-8222-222222222222'),
  1::bigint,
  'B reads A''s shared memory'
);
with changed as (
  update public.memories
  set title = 'B 试图篡改 A'
  where id = 'a1111111-1111-4111-8111-111111111111'
  returning 1
)
select is(
  (select count(*)::bigint from changed),
  0::bigint,
  'B cannot update A''s private memory'
);
with deleted as (
  delete from public.memories
  where id = 'a1111111-1111-4111-8111-111111111111'
  returning 1
)
select is(
  (select count(*)::bigint from deleted),
  0::bigint,
  'B cannot delete A''s private memory'
);
reset role;

set local role authenticated;
select tests.claim('33333333-3333-4333-8333-333333333333');
select is(
  (select count(*)::bigint from public.memories),
  0::bigint,
  'C reads zero memories even though rows exist'
);
reset role;

set local role anon;
select tests.claim(null, 'anon');
select throws_ok(
  $q$ select * from public.memories $q$,
  '42501',
  null::text,
  'anonymous clients have no SELECT privilege on memories'
);
reset role;

-- Author update is allowed (and RLS with check keeps ownership intact).
set local role authenticated;
select tests.claim('11111111-1111-4111-8111-111111111111');
with changed as (
  update public.memories
  set title = 'A 的共享记忆（更新）'
  where id = 'a2222222-2222-4222-8222-222222222222'
  returning 1
)
select is(
  (select count(*)::bigint from changed),
  1::bigint,
  'the author can update her own memory'
);
reset role;

-- ---------------------------------------------------------------------------
-- Invite edge cases
-- ---------------------------------------------------------------------------
set local role authenticated;
select tests.claim('22222222-2222-4222-8222-222222222222');
select throws_ok(
  $q$ select public.accept_space_invite(current_setting('test.token_b')) $q$,
  'P0001',
  'INVITE_USED',
  'a used invite cannot be accepted again'
);
reset role;

set local role authenticated;
select tests.claim('33333333-3333-4333-8333-333333333333');
select throws_ok(
  $q$ select public.accept_space_invite(current_setting('test.token_exp')) $q$,
  'P0001',
  'INVITE_EXPIRED',
  'an expired invite is rejected'
);
select throws_ok(
  $q$ select public.accept_space_invite(current_setting('test.token_full')) $q$,
  'P0001',
  'SPACE_FULL',
  'the third person is rejected because the space is full'
);
select throws_ok(
  $q$ select public.accept_space_invite('not-a-real-token') $q$,
  'P0001',
  'INVALID_INVITE',
  'an unknown invite token is rejected without leaking data'
);
reset role;

set local role authenticated;
select tests.claim('22222222-2222-4222-8222-222222222222');
select throws_ok(
  $q$ select public.create_space_invite(null, 72) $q$,
  'P0001',
  'NOT_SPACE_OWNER',
  'a non-owner member cannot create invites'
);
select throws_ok(
  $q$ select public.revoke_space_invite(current_setting('test.exp_invite_id')::uuid) $q$,
  'P0001',
  'NOT_SPACE_OWNER',
  'a non-owner member cannot revoke invites'
);
reset role;

-- ---------------------------------------------------------------------------
-- Attachments mirror memory visibility and enforce space-bound paths
-- ---------------------------------------------------------------------------
select set_config(
  'test.path_a',
  current_setting('test.space_id') || '/a1111111-1111-4111-8111-111111111111/a-note.png',
  true
);
select set_config(
  'test.path_b',
  current_setting('test.space_id') || '/b1111111-1111-4111-8111-111111111111/b-note.png',
  true
);

set local role authenticated;
select tests.claim('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $q$
    insert into public.attachments (
      space_id, memory_id, storage_path, file_name, mime_type, byte_size, kind
    )
    values (
      current_setting('test.space_id')::uuid,
      'a1111111-1111-4111-8111-111111111111',
      current_setting('test.path_a'),
      'a-note.png', 'image/png', 42, 'image'
    )
  $q$,
  'A creates an attachment for her own memory'
);
reset role;

set local role authenticated;
select tests.claim('22222222-2222-4222-8222-222222222222');
select lives_ok(
  $q$
    insert into public.attachments (
      space_id, memory_id, storage_path, file_name, mime_type, byte_size, kind
    )
    values (
      current_setting('test.space_id')::uuid,
      'b1111111-1111-4111-8111-111111111111',
      current_setting('test.path_b'),
      'b-note.png', 'image/png', 84, 'image'
    )
  $q$,
  'B creates an attachment for her own memory'
);
reset role;

set local role authenticated;
select tests.claim('11111111-1111-4111-8111-111111111111');
select is(
  (select count(*)::bigint from public.attachments where memory_id = 'a1111111-1111-4111-8111-111111111111'),
  1::bigint,
  'A reads the attachment of her private memory'
);
select is(
  (select count(*)::bigint from public.attachments where memory_id = 'b1111111-1111-4111-8111-111111111111'),
  1::bigint,
  'A reads the attachment of B''s shared memory'
);
select throws_ok(
  $q$
    insert into public.attachments (
      space_id, memory_id, storage_path, file_name, mime_type, byte_size, kind
    )
    values (
      current_setting('test.space_id')::uuid,
      'a1111111-1111-4111-8111-111111111111',
      '00000000-0000-4000-8000-000000000999/wrong-prefix.png',
      'wrong-prefix.png', 'image/png', 10, 'image'
    )
  $q$,
  'P0001',
  'ATTACHMENT_PATH_MISMATCH',
  'the attachment trigger rejects a storage path outside the memory space'
);
select throws_ok(
  $q$
    insert into public.attachments (
      space_id, memory_id, storage_path, file_name, mime_type, byte_size, kind
    )
    values (
      current_setting('test.space_id')::uuid,
      'a1111111-1111-4111-8111-111111111111',
      current_setting('test.space_id') || '/b1111111-1111-4111-8111-111111111111/a-evil.png',
      'a-evil.png', 'image/png', 10, 'image'
    )
  $q$,
  'P0001',
  'ATTACHMENT_PATH_MISMATCH',
  'the attachment trigger binds the storage path to its own memory id'
);
reset role;

set local role authenticated;
select tests.claim('22222222-2222-4222-8222-222222222222');
select is(
  (select count(*)::bigint from public.attachments where memory_id = 'a1111111-1111-4111-8111-111111111111'),
  0::bigint,
  'B cannot read the attachment of A''s private memory'
);
select throws_ok(
  $q$
    insert into public.attachments (
      space_id, memory_id, storage_path, file_name, mime_type, byte_size, kind
    )
    values (
      current_setting('test.space_id')::uuid,
      'a1111111-1111-4111-8111-111111111111',
      current_setting('test.path_a') || '.evil',
      'evil.png', 'image/png', 10, 'image'
    )
  $q$,
  '42501',
  null::text,
  'B cannot attach a file to A''s memory'
);
reset role;

set local role authenticated;
select tests.claim('33333333-3333-4333-8333-333333333333');
select is(
  (select count(*)::bigint from public.attachments),
  0::bigint,
  'C cannot read any attachments'
);
reset role;

set local role anon;
select tests.claim(null, 'anon');
select throws_ok(
  $q$ select * from public.attachments $q$,
  '42501',
  null::text,
  'anonymous clients have no SELECT privilege on attachments'
);
reset role;

-- ---------------------------------------------------------------------------
-- Capsule: metadata before open, sealed body, server clock enforcement
-- ---------------------------------------------------------------------------
set local role authenticated;
select tests.claim('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $q$
    insert into public.capsules (
      id, space_id, author_id, title, opens_at, visibility
    )
    values (
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      current_setting('test.space_id')::uuid,
      '11111111-1111-4111-8111-111111111111',
      '两年后再见', now() + interval '2 hours', 'shared'
    )
  $q$,
  'A creates a capsule with a future opens_at'
);
select lives_ok(
  $q$
    insert into public.capsule_contents (capsule_id, body_md)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '封存在星光里的正文。')
  $q$,
  'A writes the sealed body before the capsule opens'
);
reset role;

set local role authenticated;
select tests.claim('22222222-2222-4222-8222-222222222222');
select is(
  (select count(*)::bigint from public.capsules where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  1::bigint,
  'B sees shared capsule metadata before it opens'
);
select is(
  (select count(*)::bigint from public.capsule_contents where capsule_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  0::bigint,
  'B cannot read the sealed body before opens_at'
);
with changed as (
  update public.capsules
  set title = 'B 试图改动'
  where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  returning 1
)
select is(
  (select count(*)::bigint from changed),
  0::bigint,
  'B cannot update A''s capsule'
);
reset role;

set local role authenticated;
select tests.claim('11111111-1111-4111-8111-111111111111');
select is(
  (select count(*)::bigint from public.capsule_contents where capsule_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  0::bigint,
  'even the author cannot read the sealed body before opens_at'
);
select throws_ok(
  $q$
    update public.capsules
    set opens_at = now() - interval '1 hour'
    where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  $q$,
  'P0001',
  'CAPSULE_OPEN_TIME_IMMUTABLE',
  'an authenticated client cannot move opens_at'
);
reset role;

set local role authenticated;
select tests.claim('33333333-3333-4333-8333-333333333333');
select is(
  (select count(*)::bigint from public.capsule_contents where capsule_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  0::bigint,
  'C cannot read the sealed body before or before membership'
);
reset role;

set local role anon;
select tests.claim(null, 'anon');
select throws_ok(
  $q$ select * from public.capsule_contents $q$,
  '42501',
  null::text,
  'anonymous clients have no SELECT privilege on capsule bodies'
);
reset role;

-- Local test harness only: simulate server time passing. Client roles cannot set
-- session_replication_role, so this does not create a client path to unlock.
set local session_replication_role = replica;
update public.capsules
set opens_at = now() - interval '1 minute'
where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
set local session_replication_role = origin;

set local role authenticated;
select tests.claim('11111111-1111-4111-8111-111111111111');
select results_eq(
  $q$
    select body_md
    from public.capsule_contents
    where capsule_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  $q$,
  $$ values ('封存在星光里的正文。'::text) $$,
  'the author can read the body after the server clock passes opens_at'
);
with changed as (
  update public.capsules
  set title = 'unlock edit'
  where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  returning 1
)
select is(
  (select count(*)::bigint from changed),
  0::bigint,
  'client updates to an opened capsule affect zero rows'
);
reset role;

set local role authenticated;
select tests.claim('22222222-2222-4222-8222-222222222222');
select results_eq(
  $q$
    select body_md
    from public.capsule_contents
    where capsule_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  $q$,
  $$ values ('封存在星光里的正文。'::text) $$,
  'the other member can read the shared capsule body after it opens'
);
reset role;

-- The trigger still rejects an update that somehow reaches it after opening.
select throws_ok(
  $q$
    update public.capsules
    set title = 'direct update'
    where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  $q$,
  'P0001',
  'CAPSULE_ALREADY_OPEN',
  'the capsule trigger rejects any update after opens_at'
);

-- ---------------------------------------------------------------------------
-- AI preferences isolation
-- ---------------------------------------------------------------------------
set local role authenticated;
select tests.claim('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $q$
    insert into public.user_ai_preferences (user_id, enabled)
    values ('11111111-1111-4111-8111-111111111111', true)
  $q$,
  'A can enable AI for herself and consent is recorded'
);
select is(
  (
    select count(*)::bigint
    from public.user_ai_preferences
    where user_id = '11111111-1111-4111-8111-111111111111'
      and enabled
      and consent_at is not null
  ),
  1::bigint,
  'A''s AI preference is enabled with a consent timestamp'
);
reset role;

set local role authenticated;
select tests.claim('22222222-2222-4222-8222-222222222222');
select is(
  (select count(*)::bigint from public.user_ai_preferences where user_id = '11111111-1111-4111-8111-111111111111'),
  0::bigint,
  'B cannot read A''s AI preference'
);
select lives_ok(
  $q$
    insert into public.user_ai_preferences (user_id, enabled)
    values ('22222222-2222-4222-8222-222222222222', false)
  $q$,
  'B can create her own disabled AI preference'
);
with changed as (
  update public.user_ai_preferences
  set enabled = true
  where user_id = '11111111-1111-4111-8111-111111111111'
  returning 1
)
select is(
  (select count(*)::bigint from changed),
  0::bigint,
  'B cannot update A''s AI preference'
);
select throws_ok(
  $q$
    insert into public.user_ai_preferences (user_id, enabled)
    values ('11111111-1111-4111-8111-111111111111', true)
  $q$,
  '42501',
  null::text,
  'B cannot insert a preference row owned by A'
);
reset role;

set local role authenticated;
select tests.claim('33333333-3333-4333-8333-333333333333');
select is(
  (select count(*)::bigint from public.user_ai_preferences where user_id = '11111111-1111-4111-8111-111111111111'),
  0::bigint,
  'C cannot read A''s AI preference'
);
reset role;

set local role anon;
select tests.claim(null, 'anon');
select throws_ok(
  $q$ select * from public.user_ai_preferences $q$,
  '42501',
  null::text,
  'anonymous clients have no SELECT privilege on AI preferences'
);
reset role;

-- ---------------------------------------------------------------------------
-- Storage RLS (tested directly on storage.objects; owner is set explicitly)
-- ---------------------------------------------------------------------------
set local role authenticated;
select tests.claim('11111111-1111-4111-8111-111111111111');
select lives_ok(
  format(
    $q$
      insert into storage.objects (id, bucket_id, name, owner, metadata)
      values (gen_random_uuid(), 'memories', %L, %L::uuid,
              '{"mimetype":"image/png","size":42}'::jsonb)
    $q$,
    current_setting('test.path_a'),
    '11111111-1111-4111-8111-111111111111'
  ),
  'A can insert a storage object under her own space and memory path'
);
select is(
  (
    select count(*)::bigint
    from storage.objects
    where bucket_id = 'memories'
      and name = current_setting('test.path_a')
  ),
  1::bigint,
  'A can read the storage object that matches her visible attachment'
);
select throws_ok(
  format(
    $q$
      insert into storage.objects (id, bucket_id, name, owner, metadata)
      values (gen_random_uuid(), 'memories', %L, %L::uuid,
              '{"mimetype":"image/png","size":42}'::jsonb)
    $q$,
    current_setting('test.space_id') || '/b1111111-1111-4111-8111-111111111111/a-evil.png',
    '11111111-1111-4111-8111-111111111111'
  ),
  '42501',
  null::text,
  'A cannot upload under B''s authored memory path'
);
select throws_ok(
  format(
    $q$
      insert into storage.objects (id, bucket_id, name, owner, metadata)
      values (gen_random_uuid(), 'memories', %L, %L::uuid,
              '{"mimetype":"image/png","size":42}'::jsonb)
    $q$,
    '00000000-0000-4000-8000-000000000999/a1111111-1111-4111-8111-111111111111/a-evil.png',
    '11111111-1111-4111-8111-111111111111'
  ),
  '42501',
  null::text,
  'A cannot upload under a different space path'
);
reset role;

set local role authenticated;
select tests.claim('22222222-2222-4222-8222-222222222222');
select is(
  (
    select count(*)::bigint
    from storage.objects
    where bucket_id = 'memories'
      and name = current_setting('test.path_a')
  ),
  0::bigint,
  'B cannot read the storage object for A''s private memory'
);
reset role;

set local role anon;
select tests.claim(null, 'anon');
select throws_ok(
  format(
    $q$
      insert into storage.objects (id, bucket_id, name, owner, metadata)
      values (gen_random_uuid(), 'memories', %L, null,
              '{"mimetype":"image/png","size":42}'::jsonb)
    $q$,
    current_setting('test.path_a')
  ),
  '42501',
  null::text,
  'anonymous clients cannot insert storage objects'
);
reset role;

-- ---------------------------------------------------------------------------
-- Removing a member blocks subsequent reads immediately
-- ---------------------------------------------------------------------------
set local role authenticated;
select tests.claim('22222222-2222-4222-8222-222222222222');
select throws_ok(
  $q$ select public.remove_space_member('11111111-1111-4111-8111-111111111111') $q$,
  'P0001',
  'NOT_SPACE_OWNER',
  'a member cannot remove the owner'
);
reset role;

set local role authenticated;
select tests.claim('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $q$ select public.remove_space_member('22222222-2222-4222-8222-222222222222') $q$,
  'the owner removes B'
);
select is(
  (select count(*)::bigint from public.space_members),
  1::bigint,
  'the space is back to one member'
);
reset role;

set local role authenticated;
select tests.claim('22222222-2222-4222-8222-222222222222');
select is(
  (select count(*)::bigint from public.spaces),
  0::bigint,
  'B immediately loses space access after removal'
);
select is(
  (select count(*)::bigint from public.space_members),
  0::bigint,
  'B immediately loses membership visibility'
);
select is(
  (select count(*)::bigint from public.memories),
  0::bigint,
  'B immediately loses memory access, including her former shared rows'
);
select is(
  (select count(*)::bigint from public.attachments),
  0::bigint,
  'B immediately loses attachment access'
);
select is(
  (select count(*)::bigint from public.capsule_contents),
  0::bigint,
  'B immediately loses capsule body access even though it is open'
);
select is(
  (select count(*)::bigint from storage.objects where bucket_id = 'memories'),
  0::bigint,
  'B immediately loses storage object visibility'
);
select throws_ok(
  $q$
    insert into public.memories (
      space_id, author_id, title, occurred_on, occurred_at, visibility
    )
    values (
      current_setting('test.space_id')::uuid,
      '22222222-2222-4222-8222-222222222222'::uuid,
      'after removal', current_date, now(), 'shared'
    )
  $q$,
  '42501',
  null::text,
  'B cannot insert memories after removal'
);
reset role;

select * from finish();
rollback;
