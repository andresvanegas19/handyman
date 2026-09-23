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
Its separate `recommendations` field is owner-only advisory information.
Recommendation items, questions, and source links are available independently
of model readiness. A confidently identified, non-urgent referral may retrieve
documentation, but never proceeds to hands-on planning. Unsupported or uncertain
repair guidance does not block an approximate image-to-3D preview. Urgent and
uncertain cases skip research and planning, while retaining immediate safety warnings.
Mapped repair steps still
require backend validation and successful browser rendering; a failed model
does not become a successful repair. Cancellation, changed inputs, and revoked
consent withhold old advice.
`repairPipeline.retry({problemId})` resumes eligible failed work rather than
discarding successful earlier artifacts. Existing terminal recognition/planning
failures and referrals can explicitly retry into a preview using their saved
photo; deploying this change does not replay old runs automatically.

A ready model-only result returns `preview: { id: string }`, with no `solution`
or mapped `scene`. Fetch its private GLB using the same authenticated
`GET /repair-scene?id=...` endpoint. `message` states that this is an approximate
visual reference, not instructions, a diagnosis, exact parts, or hidden geometry.
The run's optional `intent: "preview"` and manifest's optional `kind: "preview"`
separate it from existing guided results. Preview manifests have no part mapping
and do not create a repair solution or shared cache entry.
Ready previews keep recommendation `items` and `questions` empty. Tentative
identification, image description/features, and source links remain contextual;
unknown brand/model fields stay unknown. Immediate hazard warnings remain in
`recommendations.summary` with `urgent: true`, rather than becoming repair steps.

Recognition/provider errors preserve an explicit missing-caption message rather
than inventing object identity. Missing evidence, refused plans, and failed
research/planning fall back to a single image-to-model task from the original
validated owner photo. Previews skip segmentation and mapping, but still require
bounded, self-contained GLB ingestion and finite, visible geometry validation.
All consent, owner, input revision, feature-flag, deadline, and Tripo quota checks
remain in force. Failed polls resume the existing task; ambiguous submissions
are never automatically replayed.

The stages identify the product, look for an applicable cache entry, retrieve
missing Firecrawl research, draft cited instructions through OpenRouter, obtain
and segment missing Tripo geometry, and validate step-to-part mappings. Personal
cache entries retain ownership; shared references require explicit editorial
review. Product and symptom resemblance alone cannot authorize a cache hit.

Valid consented photo/text inputs always reach OpenRouter vision unless
configuration, quota, or provider availability prevents the request. Text
safety screening no longer returns an empty keyword-only identification;
its restrictions are enforced after vision and still prevent unsafe repair
plans. Referrals and uncertain recognition produce no repair instructions.
Urgent cases show safety advice immediately; any approximate preview is for
non-instructional context only. Existing keyword-only refusals expose
an explicit retry to run vision on the saved photo; they are not silently
resubmitted or treated as image-recognized results.

Browser manifest, download, rendering, and timeout failures are reported through
`repairPipeline.reportViewerFailure` and appear as `viewer.failed` in terminal
logs. Reports accept only fixed error codes, require current owner/scene/consent
checks, and are capped at 30 per owner per minute. They do not mark a valid
server model broken for other browsers. No raw exception, photo, URL, or key is
sent in these reports. If reporting fails, the browser keeps the model error
visible and reports that diagnostics could not be delivered.

Firecrawl searches web and image results together and scrapes web results into
bounded Markdown evidence. Extra image URLs are retained with their source-page
provenance, not downloaded or passed to Tripo: a search match does not establish
product identity, licensing, or permission to fetch an asset. New geometry uses
the owner's validated photo. Private geometry reuse requires identical photo/text
evidence and compatible recognition; cross-photo reuse requires a reviewed
reference. Unknown identity fields fail compatibility rather than guessing.
Model-only preview reuse is separately limited to identical photo/text evidence,
the same owner, current consent/revision, and a currently authorized ready preview.
It cannot satisfy a guided cache lookup or use an unreviewed cross-user asset.

Ready visual models are delivered through authenticated
`GET /repair-scene?id=...`; no provider URL or public storage bearer URL is
returned to the browser. Browser loading is an additional readiness gate:
instructions remain hidden if geometry cannot render.

Configure `VISUAL_REPAIR_ENABLED=true` in Convex and
`NEXT_PUBLIC_VISUAL_REPAIR_ENABLED=true` in the frontend. Keep all provider keys
in Convex: `FIRECRAWL_API_KEY`, `OPENROUTER_API_KEY`, and `TRIPO_API_KEY`.
Set `FIRECRAWL_DAILY_LIMIT` explicitly between 1 and 10000. Existing
`AI_DAILY_LIMIT` applies to OpenRouter stages as well as legacy AI calls;
`TRIPO_DAILY_LIMIT` (1-100) is shared with legacy/editorial generation and counts
both visual generation and segmentation. Visual segmentation currently uses
`v2.0-20260430`; image generation uses `TRIPO_MODEL_VERSION`.
OpenRouter task-specific allowlists use `OPENROUTER_RECOGNITION_MODELS`,
`OPENROUTER_PLANNING_MODELS`, and `OPENROUTER_MAPPING_MODELS`. Recognition needs
image input; all selected tasks need supported structured output. Price-based
provider routing does not itself select a cheaper model. Each stage selects the
lowest estimated total-cost capable model from its configured allowlist using
current model metadata. The default allowlist contains only `openai/gpt-4o-mini`;
configure multiple approved models to enable cost comparisons.
An explicit `OPENROUTER_PLANNING_MODEL` pins the user-facing model instead of
cost-ranking it, and must be included in the planning allowlist. A pin that is
unavailable or incapable fails without substitution.
An HTTP 429 rejection triggers bounded automatic recovery: honor `Retry-After`
(up to 60 seconds within the stage deadline), then try the next-cheapest eligible
model, or the same model when pinned/when no alternatives remain. At most three
completion attempts are made. Capability, cost, provider, and privacy restrictions
stay unchanged. Network failures, moderation refusals, and errors after a
completion starts are never replayed automatically. Persistent rate limits and
credential/billing problems appear as specific errors in the saved workspace;
retrying a mapping provider failure retains the completed Tripo model.
`OPENROUTER_MAX_ESTIMATED_COST_USD` defaults to `0.05` per
request; this bounds an estimate, not actual provider billing.
`OPENROUTER_IMAGE_TOKEN_ESTIMATE` defaults to `4096`. Optional
`OPENROUTER_PROVIDER_ALLOWLIST` further restricts providers. Zero-data-retention
and no-data-collection routing are mandatory: unavailable compliant endpoints
fail rather than relaxing privacy. Configure provider-level account budgets too.

Unlike the legacy suffix-based download allowlist, visual model downloads accept
exact `TRIPO_ASSET_HOSTS` only; `cdn.tripo3d.ai` is always allowed. Add only verified
Tripo CDN hosts, never user-controlled or private-network addresses.

All provider calls run in actions, with transactional claims and persisted
results through internal mutations. Uncertain paid submission outcomes must be
reconciled rather than blindly retried. Cancelling locally does not cancel or
refund a task already accepted by a provider. Segmentation labels are not proof
of mechanical accuracy; uncertain part mappings fail instead of revealing
invented instructions.

Automated mechanical drafting currently supports only hand-tightening an
already visible accessible cabinet/drawer handle or knob screw on stable,
non-powered furniture with matching source evidence. Visible inspection and
exterior dry-cloth care are also supported. These are source-quoted private
drafts, not certification of arbitrary repairs; other procedures require reviewed
guidance. Every new run performs fresh recognition before full or partial cache
reuse. Private generated scenes require identical image/text evidence;
cross-image matching uses reviewed reference cache entries.

`repairPipeline.registerReviewedReference` is an admin-only API for registering
a currently published reviewed guide and its reviewed assembly with recognized
product applicability, supporting sources, and explicit safety/rights approval.
It never publishes a draft. Publication, withdrawal, and the existing assembly
editor remain the source of editorial review. There is no automatic registration
of generated private models into the shared catalog.

`problems.create` accepts optional `clientRequestId` for owner-scoped deduplication
of retries; the visual intake supplies a stable UUID. Conflicting inputs under
the same request ID reject. `repairPipeline.cancel({problemId})` persists mismatch
stops, invalidates the private cache, and revokes private scene access.

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

`seed.run({})` creates eight drafts, including the washing-machine knob and smart thermostat examples,
never published instructions.
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
