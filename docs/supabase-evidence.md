# Supabase evidence

Evidence recorded on **2026-10-26** for the OURVERSE Supabase backend. This file
contains only real command results from the local Docker stack. It does not
contain anon keys, service-role keys, JWT secrets, provider keys, or source
bodies from real people.

## 1. Environment

| Item | Value |
| --- | --- |
| Working directory | `E:\Projects\OURVERSE` |
| OS | Windows NT 10.0.26200.0 (Windows 11) |
| Node | v24.19.0 |
| Docker | 29.7.2 |
| Supabase CLI | 2.122.0 (`npx`) |
| Local Postgres | 17.11 |
| Edge runtime | supabase-edge-runtime 1.77.8 (Deno 2.1.4 compatible) |
| Local API | `http://127.0.0.1:54321` |
| Local DB | `127.0.0.1:54322` |
| Studio | `http://127.0.0.1:54323` |
| Cloud project used | none |
| Deployment performed | none |

**No cloud project was created, no function was deployed, and no service-role
key was used in a client or outside the local stack.**

## 2. Local stack and CLI

```powershell
npx supabase --version
```

Timestamp `2026-10-26T10:01:42.6569680+08:00` — **PASS**:

```text
2.122.0
```

The initial `npx supabase start` completed with exit code 0 after pulling the
local images. The successful start output included:

```text
Starting database...
Initialising schema...
Seeding globals from roles.sql...
Applying migration 20261026090000_schema.sql...
Applying migration 20261026090100_helpers_rls_storage.sql...
Applying migration 20261026090200_rpc.sql...
Seeding data from supabase/seed.sql...
```

`npx supabase status` reported API `http://127.0.0.1:54321`, DB
`postgresql://127.0.0.1:54322/postgres`, and Studio
`http://127.0.0.1:54323`. No key values are reproduced here.

## 3. Database reset and pgTAP tests

### First run — FAIL (test SQL bug, not schema)

Command at `2026-10-26T10:02:32.7046553+08:00`:

```powershell
npx supabase test db
```

Result: **FAIL**, exit 1. It ran 25 of the planned 86 assertions, then hit:

```text
psql:/Projects/OURVERSE/supabase/tests/001_rls_and_capsules.sql:383: ERROR:
WITH clause containing a data-modifying statement must be at the top level
...
Failed 61/86 subtests
...
Parse errors: Bad plan. You planned 86 tests but ran 25.
```

Cause: six permission assertions wrapped a data-modifying CTE inside a scalar
subquery. PostgreSQL requires a data-modifying `WITH` to be top level.

Fix: the test file was changed to put each data-modifying CTE at the top level of
the statement that calls pgTAP `is()`; the number of assertions remains 86. No
schema security rule was weakened.

### Second run — FAIL (one assertion expected the trigger, column grant fired first)

Command at `2026-10-26T10:03:21.9525505+08:00`:

```powershell
npx supabase test db
```

Result: **FAIL** — 85/86 passed:

```text
# Failed test 56: "an authenticated client cannot move opens_at"
#       caught: 42501: permission denied for table capsules
#       wanted: P0001: CAPSULE_OPEN_TIME_IMMUTABLE
...
Failed 1/86 subtests
Result: FAIL
```

At that point column-level grants on `capsules` excluded `opens_at`, so the
privilege check fired before the intended `BEFORE UPDATE` trigger. The grant was
deliberately widened to include `opens_at` so the trigger is the tested
enforcement point; the trigger still rejects every distinct value and every update
after opening. This is the defence-in-depth behaviour intended by the design.

### Third run — PASS

Reset at `2026-10-26T10:03:38.9403077+08:00`:

```powershell
npx supabase db reset
```

**PASS**:

```text
Resetting local database...
Recreating database...
Initialising schema...
Seeding globals from roles.sql...
Applying migration 20261026090000_schema.sql...
Applying migration 20261026090100_helpers_rls_storage.sql...
Applying migration 20261026090200_rpc.sql...
Seeding data from supabase/seed.sql...
Restarting containers...
Finished supabase db reset on branch master.
{"target":"local","version":"","message":"Reset local database."}
```

Test at `2026-10-26T10:04:13.1029142+08:00`:

```powershell
npx supabase test db
```

**PASS**:

```text
Connecting to local database...
psql:/Projects/OURVERSE/supabase/tests/001_rls_and_capsules.sql:18: NOTICE:
extension "pgtap" already exists, skipping
/Projects/OURVERSE/supabase/tests/001_rls_and_capsules.sql .. ok
All tests successful.
Files=1, Tests=86,  0 wallclock secs ( 0.02 usr  0.01 sys +  0.00 cusr  0.02 csys =  0.05 CPU)
Result: PASS
```

### Hardening pass — 87 assertions (current final)

After the passing run above, the attachment path binding was tightened so an
attachment's storage path must contain **its own memory id** in the second path
segment, not merely the correct space id. One pgTAP assertion was added to prove
A cannot point an attachment for A's memory at B's memory path.

Reset at `2026-10-26T10:11:18.4815509+08:00` — **PASS**
(`Finished supabase db reset on branch master.`).

Test at `2026-10-26T10:11:52.0603399+08:00`:

```text
Connecting to local database...
psql:/Projects/OURVERSE/supabase/tests/001_rls_and_capsules.sql:18: NOTICE:
extension "pgtap" already exists, skipping
/Projects/OURVERSE/supabase/tests/001_rls_and_capsules.sql .. ok
All tests successful.
Files=1, Tests=87,  0 wallclock secs ( 0.02 usr  0.00 sys +  0.01 cusr  0.01 csys =  0.04 CPU)
Result: PASS
```

This 87/87 run is the current final database evidence, and its reset removed the
earlier manual evidence users and test space. The suite itself rolls back all
fixtures.

### Earlier cleanup

Before the hardening pass, the manual function-test users and space were removed
by a separate reset:

- Reset at `2026-10-26T10:08:13.7389815+08:00`: **PASS**
  (`Finished supabase db reset on branch master.`)
- Test at `2026-10-26T10:08:47.3175929+08:00`: **PASS**
  (`All tests successful. Files=1, Tests=86 ... Result: PASS`)

### What the 87 assertions cover

| Area | Verified behaviour |
| --- | --- |
| Space and membership | A creates a space atomically; B accepts one invite; exactly two members; C is not a member |
| Memory visibility | shared visible to both members, private only to author; C sees none; anon has no privilege |
| Memory ownership | author can update; another member cannot update/delete; direct inserts as C fail |
| Invitations | hash-only storage, anonymous preview, valid/expired reasons, used invite rejected, expired rejected, third person `SPACE_FULL`, non-owner cannot create/revoke |
| Attachments and storage | attachment mirrors memory visibility; path trigger rejects wrong space prefix and a path bound to another memory id; B cannot attach to A's memory; storage policies allow A's own path, reject B's path/foreign space, deny B's read of A's private object, deny anon |
| Capsule | metadata visible; body invisible before open to B **and A**; client `opens_at` update raises `CAPSULE_OPEN_TIME_IMMUTABLE`; simulated server-time passage lets A and B read; post-open client update affects zero rows; direct trigger still raises `CAPSULE_ALREADY_OPEN` |
| AI preferences | only own row readable/writable; B cannot read/update/insert A's row; anon has no privilege |
| Member removal | B cannot remove owner; owner removes B; B immediately reads zero spaces/members/memories/attachments/capsule bodies/storage objects and cannot insert |

## 4. Database metadata checks

Run against the local Postgres container after the implementation. The same
metadata was re-checked after the final 87-assertion pass:

```text
--- public tables and RLS ---
activity_logs:true
anniversaries:true
attachments:true
capsule_contents:true
capsules:true
memories:true
space_invites:true
space_members:true
spaces:true
user_ai_preferences:true

rls_true=10
public_tables=10
anon_privileged_tables=0
public_policies=29
storage_policies=4
storage_rls=true
security_definer_unsafe=0
mime_types=image/jpeg,image/png,image/webp,video/mp4,video/webm,audio/mpeg,audio/mp4,audio/aac,audio/ogg,audio/wav
bucket=memories:public=false:limit=83886080:mimes=10
created_by_update=false,display_name_update=true
```

`security_definer_unsafe=0` means every SECURITY DEFINER function in `public` has
the exact `search_path=""` configuration.

## 5. ai-ask local function verification

Served locally at `2026-10-26T02:04:42Z` (UTC):

```text
Serving functions on http://127.0.0.1:54321/functions/v1/<function-name>
 - http://127.0.0.1:54321/functions/v1/ai-ask
Using supabase-edge-runtime-1.77.8 (compatible with Deno v2.1.4)
```

The function imported `npm:@supabase/supabase-js@2.118.0` and started with no
runtime errors. No provider key existed in the environment.

| Test | Result |
| --- | --- |
| POST with a valid payload but no JWT | HTTP 401 from the local gateway (`UNAUTHORIZED_NO_AUTH_HEADER`); the request did not reach the function |
| POST with a valid JWT and empty `sources` | **PASS** — HTTP 200 `{"answerMd":"暂无足够记录。","citedMemoryIds":[],"mode":"retrieval","code":"NO_VISIBLE_SOURCES"}` |
| POST with a valid JWT, a source visible to that user, no provider configured | **PASS** — HTTP 503 `{"code":"AI_NOT_CONFIGURED","error":"AI_NOT_CONFIGURED","message":"AI 提供商未配置，当前仅可使用检索模式。"}` |
| POST with a valid JWT from a user outside the space, supplying A's memory id | **PASS** — HTTP 200 `NO_VISIBLE_SOURCES`; the RLS re-fetch dropped the source |
| POST with a disallowed `Origin: http://evil.example` and valid JWT | **PASS (function policy)** — HTTP 403 `{"code":"ORIGIN_NOT_ALLOWED","error":"ORIGIN_NOT_ALLOWED"}`; no memory data returned |
| OPTIONS preflight, allowed origin | HTTP 200 from local Kong |
| OPTIONS preflight, disallowed origin | HTTP 200 from local Kong |

A second local serve at `2026-10-26T02:10:00Z` used
`--no-verify-jwt` **only to exercise the function's own auth code** (not a
deployment configuration; the operator instructions deploy with gateway
verification intact). Results at `2026-10-26T02:10:07Z`:

| Test | Result |
| --- | --- |
| POST with no `Authorization` header | **PASS** — HTTP 401 `{"code":"AUTH_REQUIRED","error":"AUTH_REQUIRED"}` from the function |
| POST with `Authorization: Bearer not-a-jwt` | **PASS** — HTTP 401 `{"code":"AUTH_REQUIRED","error":"AUTH_REQUIRED"}` from the function |
| POST with disallowed origin | **PASS (function policy)** — HTTP 403 `ORIGIN_NOT_ALLOWED` |

### Local CORS caveat (important)

The local CLI's Kong layer answers `OPTIONS` itself and returns:

```text
Access-Control-Allow-Origin: *
```

for **both** the allowed and disallowed origins. It also added `*` to the actual
POST responses, including the function's 403. The committed function code never
emits `*` and has no `Access-Control-Allow-Credentials` header; it rejects a
disallowed `Origin` on the POST before doing any memory query. However, the local
gateway's wildcard means **end-to-end preflight CORS limitation cannot be proven
locally**. The hosted/deployed preflight must be verified on the real origin. This
is recorded as a local environment limitation, not as a passed CORS test.

### Not executed

- Anthropic or OpenAI provider calls: **BLOCKED_NO_PROVIDER_KEY**. No provider
  key was used, so no external AI call was made.
- `AI_CONSENT_REQUIRED` (403): not separately called; the code path is present and
  is after the no-provider check.
- `AI_OUTPUT_INVALID` citation rejection, `AI_TIMEOUT`, and provider failure
  branches: **NOT_EXECUTED** because they require a real/mock provider response.
- Cloud deployment, cloud RLS test, hosted CORS, and production secrets:
  **NOT_RUN_BY_DESIGN**.

## 6. Acceptance status

| Requirement | Status | Evidence |
| --- | --- | --- |
| Versioned schema migrations | **PASS** | three migrations applied by `db reset`; final reset PASS |
| Tables, checks, indexes, capacity trigger, capsule triggers | **PASS** | migrations applied; 87/87 pgTAP PASS |
| RLS, grants, private 80 MiB bucket, storage policies | **PASS** | 10/10 public tables RLS; 29 public policies + 4 storage policies; anon privileged tables = 0; `memories` bucket private, 80 MiB, MIME-limited |
| Secure space/invite/accept/revoke/remove RPCs | **PASS** | invite/edge-case/removal assertions in 87/87 suite |
| Client cannot update capsule `opens_at` | **PASS** | pgTAP test 56 expects `CAPSULE_OPEN_TIME_IMMUTABLE`; direct post-open update expects `CAPSULE_ALREADY_OPEN` |
| pgTAP suite on real Postgres | **PASS** | final `npx supabase test db`: `Tests=87`, `Result: PASS` |
| Real local-start/reset/test output captured | **PASS** | command outputs and timestamps above |
| `ai-ask` function source and README | **PASS (implemented and locally smoke-tested)** | serves under Edge runtime; valid JWT, empty-source refusal, source revalidation, disallowed origin, and no-provider 503 observed |
| AI provider call and citation validation | **BLOCKED_NO_PROVIDER_KEY / NOT_EXECUTED** | no provider key; no cloud/deploy |
| Hosted CORS and cloud security checks | **NOT_RUN_BY_DESIGN** | local Kong wildcard caveat; operator checklist in `docs/supabase-setup.md` |

## 7. Deviations and implementation notes

1. **Extra support RPC `list_space_members()`** was added so the existing
   `SpaceMember.profile`/author-display contract can be implemented without
   exposing `auth.users` to clients.
2. **One-space-per-user unique index** was added. It makes `current_space_id()`
   deterministic and prevents a user from belonging to multiple two-person spaces.
3. **Column-level grants** restrict client updates to fields the repository needs.
   `spaces.created_by` is not updateable by clients. `capsules.opens_at` is
   updateable at the privilege layer specifically so the immutable-schedule
   trigger is the tested enforcement point.
4. **AI source revalidation is stronger than the minimum**: the function ignores
   client-supplied titles/excerpts/authors and re-reads database values through
   RLS, using only the supplied ids.
5. **AI consent is enforced**: if a provider is configured, the caller's
   `user_ai_preferences.enabled` must be true. This makes the PRD's opt-in/default-
   off rule a server-side gate as well as a UI preference.
6. **Local Kong wildcard CORS**: the function itself is restricted to one origin,
   but local preflight is answered by Kong with `*`. This is documented above and
   in `docs/supabase-setup.md`; it was not hidden or claimed as a pass.
7. **No provider secrets and no deployment.** The default Anthropic model id and
   request shape are in `supabase/functions/ai-ask/index.ts`; the README explains
   operator secret setup.

## 8. Reproduce

```powershell
cd E:\Projects\OURVERSE
npx supabase --version
npx supabase start
npx supabase db reset
npx supabase test db
```

Exact RLS test command: **`npx supabase test db`**

## 9. Final clean rerun — 2026-10-26 11:47–11:49 (+08:00)

The Docker Desktop daemon had exited during an earlier attempt. After restarting
it and confirming `docker info` returned `29.7.2`, the local stack was recovered
without changing any test or policy. The following is a clean, current rerun.

### 9.1 Reset

```powershell
npx supabase db reset
```

Exit **0**; log `artifacts/db-reset.log`:

```text
Applying migration 20261026090000_schema.sql...
Applying migration 20261026090100_helpers_rls_storage.sql...
Applying migration 20261026090200_rpc.sql...
Applying migration 20261026090300_server_now.sql...
Seeding data from supabase/seed.sql...
Restarting containers...
Finished supabase db reset on branch master.
```

### 9.2 pgTAP

```powershell
npx supabase test db
```

Exit **0**; log `artifacts/pgtap.log`:

```text
Connecting to local database...
/Projects/OURVERSE/supabase/tests/001_rls_and_capsules.sql .. ok
All tests successful.
Files=1, Tests=87,  0 wallclock secs
Result: PASS
```

### 9.3 Repository integration tests

Environment came from `npx supabase status -o env` (values not reproduced here)
and was exported as `SUPABASE_LOCAL_URL`, `SUPABASE_LOCAL_ANON_KEY`, and
`SUPABASE_LOCAL_SERVICE_ROLE_KEY`.

```powershell
npx vitest run tests/supabase/repository.integration.test.ts
```

Exit **0**; log `artifacts/supabase-integration.log`:

```text
Test Files  1 passed (1)
Tests       12 passed (12)
Duration    7.86s
```

This includes the 5 MB private-storage upload/serve/delete test and the capsule
authoritative-clock test.

### 9.4 Real Supabase UI E2E

A Vite server was started with `VITE_BACKEND=supabase` on port 5174 using the
local URL / anon key. No secret was written to a file in the repository.

```powershell
$env:E2E_SUPABASE_APP_URL = 'http://localhost:5174'
npx playwright test e2e/supabase-local.spec.ts --project=desktop
```

Exit **0**; log `artifacts/supabase-ui-e2e.log`:

```text
Running 1 test using 1 worker
✓ 1 [desktop] › e2e\supabase-local.spec.ts:28:3 › real Supabase backend acceptance ›
  A creates a space, B accepts a one-time invite, both see shared but not private (9.6s)
1 passed (13.6s)
```

This exercises the real UI against the real local stack: sign-up, space creation,
one-time invite acceptance, shared/private visibility, direct-URL refusal, and a
third account being rejected.

### 9.5 Local backup command check

```powershell
npx supabase db dump --db-url 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -f <schema.sql>
npx supabase db dump --data-only --db-url 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -f <data.sql>
```

Both exited **0** against the local database. No cloud backup or restore was
performed. See `docs/backup-and-restore.md`.

### 9.6 Environment note

Docker Desktop's daemon exited once during an earlier Supabase attempt, which
produced `LocalDbRunningError` / `ECONNREFUSED 127.0.0.1:54322`. This was an
environment failure, not an RLS failure. Restarting Docker Desktop and confirming
`docker info` restored the stack; all three evidence layers then passed as shown
above. `docs/ISSUES.md` records this as ISSUE-20 / LIM-07.
