# MVP backend

The website has no registration or sign-in screen. Convex Auth's Anonymous
provider automatically issues a private browser session. Catalog browsing is
public; submissions and media remain private to the verified anonymous user.
Ownership uses the user portion of the token subject, not its session suffix.

## Setup

```sh
npx convex dev
npx @convex-dev/auth --web-server-url http://localhost:3000
```

The second command configures `JWT_PRIVATE_KEY`, `JWKS`, and `SITE_URL`.
Convex supplies `CONVEX_SITE_URL`. No external login provider is required.
Never commit the generated keys or put them in browser environment variables.

Set these additional values in the Convex deployment:

- `APP_ORIGINS`: exact allowed web origins, including a LAN origin for phone previews.
- `OPENAI_API_KEY`; optional `OPENAI_ANALYSIS_MODEL` (`gpt-4.1-mini`) and
  `OPENAI_TRANSCRIPTION_MODEL` (`whisper-1`).
- `AI_DAILY_LIMIT`: shared daily analysis/transcription request budget, default 100.
  It applies across anonymous users so clearing browser storage does not bypass it.
- Optional `ADMIN_SUBJECTS`: approved anonymous user IDs from the dashboard.
- `TRIPO_API_KEY`, `TRIPO_MODEL_VERSION`, and `TRIPO_DAILY_LIMIT` (1-100).
  Tripo generation is disabled unless explicitly budgeted.
- Optional `TRIPO_ASSET_HOSTS`: trusted download hostname suffixes, default
  `tripo3d.ai,tripo3d.com`. Only add independently verified provider CDN hosts.

For binding generation without changing a deployment:

```sh
npx convex codegen --typecheck disable
```

## Main API

- `catalog.list({category?,search?})` and `catalog.detail({slug})` expose published guides.
- `catalog.version({guideVersionId})` preserves exact historical revisions;
  drafts and withdrawn revisions remain unavailable.
- `problems.create({text,consent})`, `list({})`, `get({problemId})`,
  `update({problemId,text,transcript?,transcriptConfirmed})`, and `remove({problemId})`
  enforce private ownership.
- `problems.transcribe({problemId})` and `analyze({problemId})` return persistent job IDs.
  Confirm the edited transcript before analysis.
- `problems.selectGuide({problemId,guideVersionId})` records the chosen revision.
- `uploads.reserve({problemId,kind})` returns an upload URL and reservation ID.
  POST the file, then call the `uploads.finalize` action with reservation and storage IDs.
- `feedback.save({problemId,guideVersionId,outcome,comment?})` upserts an outcome.
  Outcomes are `worked`, `partly`, and `not_worked`; comments remain private.
- `tripo.scene({problemId})` returns owner-only availability and persistent scene
  status, never a public storage URL.
- `tripo.requestScene({problemId,photoId,consent})` submits a budgeted image-to-model
  job after explicit Tripo consent and a current low-risk reviewed-guide match.
  Only a ready photo owned by that repair can be submitted. Pending and completed
  generation is deduplicated per analysis; failures require explicit retries.
  Photo jobs use the documented v3 API at `https://openapi.tripo3d.ai/v3`:
  multipart `POST /files` returns `data.file_token`, then
  `POST /generation/image-to-model` sends `{input,model,face_limit,texture,pbr}`.
  `GET /tasks/{task_id}` returns `data.output.model_url` on success.
  The requested face limit is 100,000; ingestion still enforces 150,000 triangles
  and 10 MB. Signed asset URLs are downloaded immediately, not saved for later.
  Existing editorial text jobs retain their v2 endpoint and polling contract.
  The API version is persisted on photo jobs so polling uses the correct host.

Private files use `GET /media?id=...` on the Convex site URL. Authenticate with the
JWT returned by `useAuthToken()` from `@convex-dev/auth/react`. Responses use
`private, no-store` and never redirect to a storage bearer URL.
Private generated scenes use `GET /scene?id=...` with the same authentication.
Scene access also requires the original current analysis and still-published
guidance. The browser creates a temporary local blob URL for preview/download;
it never receives a provider URL or API key.

## Media and safety

Limits: three 10 MB JPEG/PNG/WebP photos and one 15 MB audio clip up to 60 seconds.
The browser normally converts audio to mono WAV. The server validates PCM headers
and sample duration, MP4 duration, or WebM Opus blocks independently. Unsupported
containers fail explicitly. Abandoned storage is swept after 24 hours.

Legacy AI analysis matches published catalog revisions; it does not supply new repair procedures.
Hazardous or unsupported work is referred to professionals. Scheduled failures,
deadlines, duplicate jobs, and stale results are recorded without fabricated success.
Deleting a repair removes application media/results and blocks late resurrection.
Private Tripo scenes live in `repairScenes`, not the public editorial assemblies.
Legacy scenes have no inferred part mappings, explosion controls, or repair instructions.
Changing inputs cancels running jobs and hides stale assets. Submitted provider
work may still finish or incur costs; application cancellation is not a provider
refund or deletion request.

## Automatic visual pipeline

The opt-in visual workflow is separate from legacy catalog analysis and does
not auto-publish any guide or generated assembly. `problems.create` accepts a
visual workflow marker; after photo upload finalization,
`repairPipeline.start({problemId})` starts one durable run. Both a written prompt
and a ready photo are mandatory. `repairPipeline.get({problemId})` reports
progress and exposes the solution/model only after backend readiness.
`repairPipeline.retry({problemId})` resumes eligible failed work rather than
discarding successful earlier artifacts.

The stages identify the product, look for an applicable cache entry, retrieve
missing Firecrawl research, draft cited instructions through OpenRouter, obtain
and segment missing Tripo geometry, and validate step-to-part mappings. Personal
cache entries retain ownership; shared references require explicit editorial
review. Product and symptom resemblance alone cannot authorize a cache hit.

Ready visual models are delivered through authenticated
`GET /repair-scene?id=...`; no provider URL or public storage bearer URL is
returned to the browser. Browser loading is an additional readiness gate:
instructions remain hidden if geometry cannot render.

Configure `VISUAL_REPAIR_ENABLED=true` in Convex and
`NEXT_PUBLIC_VISUAL_REPAIR_ENABLED=true` in the frontend. Keep all provider keys
in Convex: `FIRECRAWL_API_KEY`, `OPENROUTER_API_KEY`, and `TRIPO_API_KEY`.
OpenRouter task-specific allowlists use `OPENROUTER_RECOGNITION_MODELS`,
`OPENROUTER_PLANNING_MODELS`, and `OPENROUTER_MAPPING_MODELS`. Recognition needs
image input; all selected tasks need supported structured output. Price-based
provider routing does not itself select a cheaper model. The preferred default
is `qwen/qwen3.8-flash`, including the user-facing solution response; explicitly
configure another allowlist only when a different model is intended.

All provider calls run in actions, with transactional claims and persisted
results through internal mutations. Uncertain paid submission outcomes must be
reconciled rather than blindly retried. Cancelling locally does not cancel or
refund a task already accepted by a provider. Segmentation labels are not proof
of mechanical accuracy; uncertain part mappings fail instead of revealing
invented instructions.

## Backup, rollout, and recovery

Take a Convex backup including file storage before production schema rollout.
The migration is additive: old repairs retain their existing workflow and
publication rules. Enable the new flow only after configuring provider
capabilities, explicit budgets, and inspecting representative mapped outputs.

Convex backups contain table data and optionally stored files, not code,
environment variables, or scheduled functions. Keep configuration recovery
separate. After restoring, reconcile persisted active runs and provider task IDs
before scheduling work again, especially ambiguous paid submissions. A restore
overwrites table data and needs explicit operator approval; it is not a normal
cache refresh. See https://docs.convex.dev/database/backup-restore.

## Editorial assets

`seed.run({})` creates six drafts, never published instructions.
Admin APIs support draft editing, publication/withdrawal, and asset review.
Guide steps may include optional visual cues: `location`, `lookFor`, `motion`,
`force`, `risk`, and `check` inside a `visual` object. All six strings must be
nonempty and at most 800 characters; review them with the instructions. A `door`
assembly kind is supported alongside hinge, knob, and aerator. The tutorial never
derives real movement or force instructions from model explode offsets.
`tripo.request({prompt,source,license})` submits a budgeted text-to-model task.
Editorial text generation uses its legacy v2 task API, bounded polling, and validated GLB ingestion.
Cleaned Blender output can be uploaded with `reserveCleanedUpload` and
`finalizeCleanedUpload`; `admin.reviewAssembly` requires complete part mappings
and explicit geometry, applicability, rights, and mobile-review confirmations.

GLBs must be self-contained, at most 10 MB and 150,000 triangles. Generated assets
are not published automatically. Real credentials, authorized live-provider
validation, and human-reviewed assets remain release requirements.

Anonymous history belongs to the browser. Clearing its storage or losing the
session can lose access; this MVP has no cross-device recovery.
