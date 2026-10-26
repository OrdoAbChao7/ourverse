# ai-ask

`ai-ask` is OURVERSE's retrieval-first AI proxy. It is a Deno Edge Function.

The browser never holds a model key. The function:

1. verifies the caller's Supabase access token with the project's anon/publishable key;
2. re-fetches every proposed memory id through the caller's RLS and silently drops
   ids they cannot see (private memories of the other member, deleted memories,
   invalid ids, ids from another space);
3. refuses in retrieval mode if no visible sources remain;
4. requires the caller's `user_ai_preferences.enabled` row to be true;
5. calls the configured provider only when `AI_PROVIDER` and `AI_API_KEY` are set
   server-side;
6. validates every `[n]` citation against the re-fetched source set and returns
   `502 AI_OUTPUT_INVALID` rather than echoing an uncited or out-of-range answer.

Request and source bodies are never logged. The function never uses a service-role
key and never writes to memories.

## Request

`POST /functions/v1/ai-ask`

```json
{
  "question": "我们第一次一起看海是什么时候？",
  "sources": [
    {
      "id": "0e6a6f1e-2b1b-4d3b-8f1e-9c2f3a4b5c6d",
      "title": "第一次看海",
      "occurredOn": "2025-08-16",
      "occurredTime": "19:40:00",
      "authorName": "阿岚",
      "excerpt": "……"
    }
  ],
  "spaceName": "星轨之间"
}
```

Only `sources[].id` is trusted, and only after the RLS re-fetch. The client's
`title`, `occurredOn`, `occurredTime`, `authorName`, and `excerpt` fields are
accepted by the contract but ignored; the function uses database values and the
caller's visible space member display names instead. `spaceName` is only a fallback
for the system prompt when the database name cannot be read.

Limits: question 1–2000 characters; at most 20 source ids; request body at most
1 MB. Duplicate and malformed UUIDs are ignored.

## Responses

Success:

```json
{ "answerMd": "……[1]", "citedMemoryIds": ["0e6a6f1e-2b1b-4d3b-8f1e-9c2f3a4b5c6d"], "mode": "ai" }
```

No visible source / provider-less retrieval refusal (HTTP 200):

```json
{ "answerMd": "暂无足够记录。", "citedMemoryIds": [], "mode": "retrieval", "code": "NO_VISIBLE_SOURCES" }
```

Errors are JSON with `code` and `error` identical:

| HTTP | code | meaning |
| --- | --- | --- |
| 400 | `INVALID_INPUT` | malformed request |
| 401 | `AUTH_REQUIRED` | missing or invalid bearer token |
| 403 | `ORIGIN_NOT_ALLOWED` | browser origin is not `AI_ALLOWED_ORIGIN` |
| 403 | `AI_CONSENT_REQUIRED` | user has not enabled the memory assistant |
| 405 | `METHOD_NOT_ALLOWED` | not POST/OPTIONS |
| 413 | `PAYLOAD_TOO_LARGE` | request body over 1 MB |
| 500 | `RETRIEVAL_FAILED` / `PREFERENCE_LOOKUP_FAILED` / `SERVER_MISCONFIGURED` | server-side data/config failure |
| 502 | `AI_PROVIDER_ERROR` / `AI_PROVIDER_REFUSED` / `AI_OUTPUT_INVALID` | provider failure or failed citation validation |
| 503 | `AI_NOT_CONFIGURED` | no provider configured; the app should stay in retrieval mode |
| 504 | `AI_TIMEOUT` | provider exceeded the 10 second limit |

The function deliberately does not return provider response bodies, model output
that failed validation, or any secret. It does not log either.

## Required environment

Supabase injects these automatically for a deployed function:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (or `SUPABASE_PUBLISHABLE_KEY`)

Optional / operator-configured:

- `AI_PROVIDER` — `anthropic` (default recommended) or `openai`; unset means retrieval only
- `AI_API_KEY` — provider key; required with `AI_PROVIDER`
- `AI_MODEL` — default `claude-sonnet-5-5` for Anthropic, `gpt-4.1-mini` for OpenAI
- `AI_ALLOWED_ORIGIN` — exactly one browser origin, default `http://localhost:5173`;
  `*` is rejected and replaced with the local default. No wildcard is ever emitted.

Anthropic requests are plain `fetch` to `https://api.anthropic.com/v1/messages`
with `anthropic-version: 2023-06-01` and a 10-second `AbortController` timeout.

## Deploy (operator action; not performed by this repository task)

Never put `AI_API_KEY` in `.env`, `VITE_*`, Supabase `config.toml`, this repo, or
client code.

```powershell
cd E:\Projects\OURVERSE

# Link only when a real, approved pre-production project exists.
npx supabase link --project-ref <project-ref>

# Server-side secrets. Use an operator terminal, not CI logs.
npx supabase secrets set AI_PROVIDER=anthropic AI_ALLOWED_ORIGIN=https://your-app.example
npx supabase secrets set AI_API_KEY=<provider-key>

# Deploy with gateway JWT verification intact; the function validates as well.
npx supabase functions deploy ai-ask
```

Local invocation (no provider configured by default):

```powershell
npx supabase functions serve ai-ask --env-file supabase/functions/.env.local
```

`supabase/functions/.env.local` is local-only and must not be committed. It is not
part of this implementation. Without `AI_PROVIDER`/`AI_API_KEY` the function
returns `503 AI_NOT_CONFIGURED`; the frontend must keep `VITE_AI_PROXY_ENABLED`
false or handle that code as retrieval-only.

## Verification notes

- RLS revalidation depends on the schema's `public.memories` policies and on
  `public.list_space_members()`; both are created by the migrations.
- Consent depends on `public.user_ai_preferences` defaulting to disabled.
- `AI_MODEL` must be a model available to the operator's key. The default
  `claude-sonnet-5-5` is intentional but was not called during local evidence
  collection because no provider key is used in this task.
- This function has not been deployed and no cloud resource was created.
