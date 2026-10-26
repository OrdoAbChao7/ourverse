# Supabase setup and operations

This document covers the real backend for OURVERSE: local start/reset/test, schema
and RLS layout, storage, invitation RPCs, AI Edge Function secrets, and the checks
required before a real two-person deployment.

No command in this document was used to create a cloud project. Commands that
would do so are labelled **operator only**.

## 1. Prerequisites

- Windows 11 with Docker Desktop running (Linux containers).
- Node.js 20+ (this repository was implemented with Node 24).
- The Supabase CLI is invoked through `npx`; no global install is required.
- No `.env` secret is required for local Supabase. Do not put a provider key or a
  service-role key in a `VITE_*` variable.

```powershell
cd E:\Projects\OURVERSE
npx supabase --version
```

The recorded local evidence used Supabase CLI **2.122.0**, PostgreSQL **17**,
API port **54321**, database port **54322**, Studio **54323**, and Mailpit
**54324**.

## 2. Local start, reset, and RLS tests

```powershell
cd E:\Projects\OURVERSE

# Start the local stack (first run pulls images).
npx supabase start

# Print the local API URL, anon key, and service-role key. Never paste the
# service-role key into frontend environment variables.
npx supabase status

# Apply all migrations to a clean local database and seed.sql.
npx supabase db reset

# Run the pgTAP suite against the local PostgreSQL instance.
npx supabase test db
```

`npx supabase test db` is the exact RLS test command. It uses
`supabase/tests/001_rls_and_capsules.sql`; the suite creates A/B/C fixtures in
`auth.users`, simulates PostgREST with `set local role` plus JWT claims, and ends
with `rollback` so nothing survives the test.

Stop the stack without deleting local data:

```powershell
npx supabase stop
```

Resetting local data is destructive but confined to the local Docker volume:

```powershell
npx supabase db reset
```

If Docker is unavailable, record the test state as **BLOCKED_LOCAL_DOCKER**
rather than claiming a pass. The implementation was not reviewed as passing
until a real `npx supabase test db` run printed `All tests successful.`

## 3. Local environment wiring

Get values from `npx supabase status`:

```dotenv
# .env.local — browser-visible values only
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<local anon key from `npx supabase status`>
VITE_AI_PROXY_ENABLED=false
```

Leave `VITE_AI_PROXY_ENABLED=false` unless `AI_PROVIDER` and `AI_API_KEY` are
configured server-side and the `ai-ask` function is served/deployed. The
frontend can keep retrieval-only mode otherwise.

Local Postgres can be inspected with:

```powershell
npx supabase db psql
```

There is no seed data. `supabase/seed.sql` is intentionally empty; demo content
lives only in the frontend's labelled local seed. Test identities are scoped to
the rolled-back pgTAP transaction.

## 4. What the migrations create

Migrations are forward-only and applied in timestamp order:

| File | Purpose |
| --- | --- |
| `supabase/migrations/20261026090000_schema.sql` | Ten public tables, constraints, indexes, capacity trigger, attachment path trigger, capsule schedule/body seals, `updated_at`/AI-consent triggers |
| `supabase/migrations/20261026090100_helpers_rls_storage.sql` | SECURITY DEFINER membership helpers, grants, all RLS policies, private `memories` bucket and `storage.objects` policies |
| `supabase/migrations/20261026090200_rpc.sql` | SECURITY DEFINER space/invite/member RPCs plus `list_space_members()` |

Core invariants:

- A user belongs to at most one space; a space has at most two members and one
  owner. The `BEFORE INSERT` trigger raises `SPACE_FULL` for a third membership,
  and concurrent invites are serialized by locking the `spaces` row.
- A memory/anniversary/capsule is visible only to a current member of its space
  and only when it is `shared` or the caller is its author. Deleted memories are
  invisible.
- Only the author may update/delete a memory, anniversary, or capsule, and only
  before a capsule opens.
- Capsule metadata is visible; the sealed body is invisible to **everyone**,
  including its author, until the server clock (`now()`) reaches `opens_at`.
  Clients cannot move `opens_at`; a trigger also rejects updates after opening.
- Invitation tokens are 256-bit random values. Only the SHA-256 hex hash is
  stored; plaintext is returned once by `create_space_invite`.
- `anon` has no table privileges. Its only invitation capability is the
  deliberately narrow `preview_space_invite(token)`.
- All client writes to spaces, memberships, and invites go through RPC. RLS is
  enabled on every public table; no policy is disabled.

### RPC signatures

```sql
public.create_space(p_display_name text, p_motto text default null) returns public.spaces
public.create_space_invite(
  p_invited_email text default null,
  p_ttl_hours integer default 72
) returns table(invite_id uuid, space_id uuid, token text, expires_at timestamptz)
public.accept_space_invite(p_token text) returns uuid
public.revoke_space_invite(p_invite_id uuid) returns void
public.remove_space_member(p_member_user_id uuid) returns void
public.preview_space_invite(p_token text)
  returns table(space_display_name text, expires_at timestamptz, valid boolean, reason text)
public.list_space_members()
  returns table(id uuid, space_id uuid, user_id uuid, role text, joined_at timestamptz, email text, display_name text)
```

`list_space_members()` is the repository support RPC for
`SpaceMember.profile`/author display names without exposing `auth.users`
directly. It returns only members of the caller's current space.

### Invitation flow

1. The owner (authenticated, member of a space, role `owner`) calls
   `create_space_invite`. The function refuses if the space already has two
   members, stores only the hash, and returns the plaintext token once.
2. Share a link such as `http://localhost:5173/login?invite=<token>`.
3. Before login, the app may call `preview_space_invite(token)` with the anon
   key. It reveals only the space display name, expiry, validity, and a reason
   (`invite_invalid`, `invite_revoked`, `invite_used`, `invite_expired`,
   `space_full`, or `ok`).
4. After authentication, the invitee calls `accept_space_invite(token)`. The
   invite is atomically marked used and the member row is inserted with role
   `member`.
5. The owner can call `revoke_space_invite(invite_id)` (idempotent) or
   `remove_space_member(user_id)`. Removing the membership invalidates subsequent
   RLS checks immediately, even if the removed user still holds a valid JWT.

## 5. Private storage bucket

The migration creates/upserts a **private** bucket named `memories` with:

- bucket maximum/global file size limit: **80 MiB (83,886,080 bytes)**;
- MIME allowlist: JPEG, PNG, WebP, MP4, WebM, MP3, MP4 audio, AAC, OGG, WAV;
- no public-read policy, no anon policy.

Object paths are:

```text
<space_id>/<memory_id>/<file_name>
```

Upload sequence:

1. Create the memory (the storage INSERT policy checks that the caller authored
   it and that it belongs to the caller's current space).
2. Upload the object to `<space_id>/<memory_id>/<file_name>`.
3. Insert the matching `public.attachments` row. The attachment trigger verifies
   the memory exists, `attachments.space_id` matches the memory, and the path's
   first segment equals that space id. The storage SELECT policy requires the
   attachment row and inherits the memory's visibility.

The bucket must not be made public. If an operator changes the bucket to public,
private-memory media would become readable outside RLS; treat that as a security
incident.

## 6. Capsule operation

1. Insert a capsule with `opens_at` in the future (`now() + interval ...`).
   Insertion of a past time is rejected.
2. Insert exactly one `capsule_contents` row for that capsule before opening.
3. Clients can read capsule metadata, but the body returns zero rows until
   `now() >= opens_at` on the database server. Authors are not exempt.
4. Do not attempt to update `opens_at`: it is immutable. After opening, capsule
   and body writes are rejected by triggers as well as RLS.
5. To test lock behaviour locally without waiting, use `npx supabase test db`
   (the suite simulates time as the local superuser only). There is no client
   path to disable triggers.

## 7. Deploying the AI function

See `supabase/functions/ai-ask/README.md` for the full contract and status codes.
Operator-only summary:

```powershell
cd E:\Projects\OURVERSE

# 1. Link to an approved pre-production project (creates a cloud linkage).
npx supabase link --project-ref <project-ref>

# 2. Set server-side secrets. Do not put these in .env or a VITE_* variable.
npx supabase secrets set AI_PROVIDER=anthropic AI_ALLOWED_ORIGIN=https://your-app.example
npx supabase secrets set AI_API_KEY=<provider-key>
# Optional: AI_MODEL=claude-sonnet-5-5

# 3. Deploy. Do not use --no-verify-jwt.
npx supabase functions deploy ai-ask
```

- `SUPABASE_URL` and `SUPABASE_ANON_KEY`/`SUPABASE_PUBLISHABLE_KEY` are injected
  by the Supabase function runtime.
- `AI_PROVIDER` must be `anthropic` or `openai`. Anthropic is the documented
  default and uses `https://api.anthropic.com/v1/messages`,
  `anthropic-version: 2023-06-01`, and default model `claude-sonnet-5-5`.
- `AI_ALLOWED_ORIGIN` must be one exact origin (default
  `http://localhost:5173`). The function never emits `*`; a configured `*` is
  replaced with the local default.
- The function validates the caller's JWT with the anon/publishable key, re-fetches
  every source id through RLS, requires the caller's AI preference to be enabled,
  and returns `503 AI_NOT_CONFIGURED` when no provider is configured.
- The function never receives a service-role key. Do not set one for it.
- **Local gateway CORS caveat:** the Supabase CLI's local Kong layer answers
  `OPTIONS` itself and currently returns `Access-Control-Allow-Origin: *` before
  the function runs. The function still rejects a disallowed `Origin` on the
  actual POST with `403 ORIGIN_NOT_ALLOWED`, and it never emits a wildcard itself.
  Do not treat the local preflight response as production CORS evidence; verify
  the deployed function's preflight on the real origin.

For local function testing without a provider:

```powershell
npx supabase functions serve ai-ask --env-file supabase/functions/.env.local
```

The env file is local-only and must not be committed. With no provider, expect
`503 AI_NOT_CONFIGURED`; with a provider, citations are validated server-side and
invalid output is rejected with `502 AI_OUTPUT_INVALID`.

## 8. Cloud pre-production checklist (operator only, not executed here)

Do not use production data for the first deployment.

1. **Backup/restore**: enable PITR or a documented backup; record the restore
   procedure and test it on staging.
2. **Link and dry-run**: `npx supabase link --project-ref <staging-ref>` then
   `npx supabase db push --dry-run`. Review every migration. Apply only to
   staging first.
3. **Auth configuration**: set the production site URL and allowed redirects to
   the exact app origin; require email confirmation as appropriate; verify the
   two-person invite flow with two real test accounts. Prevent open third-party
   signups after both members are established if the product has no invitation
   gate at signup.
4. **RLS verification**: run the pgTAP suite against a staging database with the
   same migrations; additionally use the anon key to confirm zero rows from
   `memories`, `attachments`, `capsules`, `capsule_contents`,
   `space_members`, and `user_ai_preferences`.
5. **Storage**: confirm the `memories` bucket is private, 80 MiB, MIME-limited,
   and that direct public URLs fail. Test a private-memory upload as A and a read
   attempt as B.
6. **Capsule clock**: create a capsule that opens one minute in the future and
   verify the body is hidden before the server time and visible after. Do not
   manipulate production time.
7. **Invites**: verify expiry, single use, revocation, third-person rejection, and
   immediate access loss after `remove_space_member`.
8. **AI secrets**: set `AI_PROVIDER`, `AI_API_KEY`, `AI_ALLOWED_ORIGIN`, and
   optionally `AI_MODEL` with `npx supabase secrets set`. Never put a provider key
   in the browser bundle. Verify `AI_NOT_CONFIGURED` when the secrets are absent,
   and test refusal when there are no visible sources.
9. **CORS and JWT**: deploy without `--no-verify-jwt`; send one request from the
   configured origin and one from a disallowed origin. Confirm the latter has no
   `Access-Control-Allow-Origin`.
10. **Key hygiene**: rotate any key that was ever pasted into a terminal record,
    ticket, or chat. The service-role key must exist only in trusted server
    contexts, never in this repo, `.env.example`, or client code.

## 9. Migration and rollback policy

Migrations are forward-only. There are no `DOWN` migrations.

- Local rollback/replay: `npx supabase db reset` recreates the database from all
  migrations and the empty seed. This is destructive to local data only.
- Before a cloud push: `npx supabase db push --dry-run`.
- If a production migration is wrong, write a new forward migration that corrects
  it. Do not edit an applied migration or run ad-hoc destructive SQL from a
  client.
- For data loss, restore from the backup/PITR plan; do not rely on a schema
  rollback to restore deleted rows.
- `npx supabase migration list` shows local vs remote migration state. Resolve
  divergences deliberately; never use `migration repair` merely to silence a
  mismatch.

## 10. Troubleshooting

| Symptom | Check |
| --- | --- |
| `supabase start` fails or hangs | Docker Desktop is running; enough disk; first image pull can be slow. Rerun and inspect `npx supabase status`. |
| Port already in use | Change ports in `supabase/config.toml` or stop the conflicting process. Update `VITE_SUPABASE_URL` to match the API port. |
| Tests cannot find pgTAP | The suite runs `create extension if not exists pgtap with schema extensions`; use the local Supabase Postgres image, which includes pgTAP. |
| `db reset` applies no schema | Confirm migration files are under `supabase/migrations/` and prefixed with a sortable timestamp. |
| Invite acceptance says `SPACE_FULL` | A space is limited to two members; remove the other member or use the correct space. |
| AI returns `503 AI_NOT_CONFIGURED` | No server-side provider key. Keep the app in retrieval-only mode or configure `AI_PROVIDER` and `AI_API_KEY`. |
| AI returns `403 AI_CONSENT_REQUIRED` | The caller's `user_ai_preferences.enabled` is not true. AI is opt-in. |
| AI returns `502 AI_OUTPUT_INVALID` | The model answer had no valid citation or cited a source number outside the re-fetched source set. It is intentionally not echoed. |
