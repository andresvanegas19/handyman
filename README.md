# handyman

A responsive home-repair MVP built with Next.js and Convex. Describe a problem
with text, photos, or audio; explore catalog guides and interactive parts; report
whether a solution helped.

**No accounts, keys, or backend setup are needed for the temporary MVP.**
It saves repair text and guide ratings in the current browser tab.

## Deploy on Vercel

1. Import this repository into Vercel. The included `vercel.json` selects Next.js,
   `npm ci`, and `npm run build`. No local server or tunnel is required.
2. Deploy without environment variables for the temporary MVP. Visitors can save,
   edit, reopen, and delete repairs, select catalog examples, and rate guides.
   Its eight example guides and six procedural assemblies are clearly labeled
   drafts, not reviewed instructions or real Tripo outputs.
3. For the connected MVP, configure and deploy the Convex backend as described
   below. Set `NEXT_PUBLIC_CONVEX_URL` in Vercel to that deployment's URL.
   Standard `.convex.cloud` URLs derive the private-media `.convex.site` URL;
   custom deployments also need `NEXT_PUBLIC_CONVEX_SITE_URL`.
4. Redeploy after changing browser environment variables. Open the resulting
   Vercel HTTPS URL on desktop or phone. HTTPS enables microphone recording;
   photo and audio-file uploads remain alternatives.

Vercel hosts the website; Convex hosts the database, file storage, and background
jobs. The default Vercel build does not automatically deploy Convex.
Keep production and preview deployment variables separate.

## Temporary data

- Descriptions, notes, guide selections, and ratings use `sessionStorage`: they
  survive refresh in the same tab and normally end when the tab closes.
- Photo/audio files stay in memory only. They survive navigation within the app,
  but not refresh; the UI explicitly marks missing attachments after refresh.
- Nothing is uploaded or sent to AI in this mode. Audio can be played back and
  described manually. Catalog selection is manual, not a diagnosis.
- My repairs can delete individual drafts or clear all of this tab's data.
  There is no cross-device sharing. Do not rely on browser storage as a backup.

## Optional: connect Convex and AI

1. Create/select a Convex deployment with `npx convex dev`.
2. Configure guest-session keys with
   `npx @convex-dev/auth --web-server-url https://YOUR-APP.vercel.app`.
   Only the Anonymous provider is enabled; no external login provider is needed.
   Use the appropriate production deployment when configuring production.
3. Set `APP_ORIGINS` in Convex to exact permitted frontend origins, including
   any Vercel preview URLs that should load private media.
4. Set `OPENAI_API_KEY` in Convex for transcription and catalog matching.
   `AI_DAILY_LIMIT` defaults to 100 requests shared across all guest sessions.
5. Optional editorial tools: set `ADMIN_SUBJECTS` to approved anonymous user IDs
   from the Convex dashboard. Seed and review drafts before publishing.
6. For Tripo generation, set `TRIPO_API_KEY`, a supported `TRIPO_MODEL_VERSION`,
   and an explicit `TRIPO_DAILY_LIMIT` (1-100). Paid generation is disabled by default.
   Create the key at [Tripo API keys](https://developers.tripo3d.ai/en/keys).
   These are Convex server variables, not Vercel browser variables.
7. Deploy backend changes with `npx convex deploy`, then deploy the frontend with
   the matching production Convex URL.

Setting `NEXT_PUBLIC_CONVEX_URL` switches to the connected workflow with automatic
anonymous sessions. Temporary drafts are not automatically uploaded or migrated.

### Separate local and production deployments

Keep local Convex settings in `.env.local`. Run `npm run convex:dev` and
`npm run dev` in separate terminals for local development. `npm run dev` starts
Next.js and streams backend logs into that same terminal; `convex:dev` still
handles backend deployment/watching. Use `npm run dev:web` for Next.js alone.

For production CLI commands, use a gitignored `.env.production.local` containing
`CONVEX_DEPLOYMENT=prod:YOUR-DEPLOYMENT` and the matching public Convex URLs.
After authenticating with `npx convex login`, deploy the backend explicitly:

```sh
npx convex deploy --env-file .env.production.local
```

Set the production public URLs separately in Vercel and redeploy the website.
Never upload local Convex state or environment files; `.vercelignore` excludes
them. Production signing keys and provider secrets stay in Convex.

## Automatic visual repair workflow

The optional connected visual workflow requires **a photo and a written prompt**.
One submission starts product recognition, a compatible-solution cache lookup in
Convex, and any missing research, planning, and 3D work. A complete cache hit
avoids a new Firecrawl search, solution draft, and Tripo submission. Recognition
may still be needed to establish that a different photo matches the reference.

On a miss, Firecrawl searches for product documentation and reference images.
OpenRouter selects the lowest estimated-cost capable model in each stage's
configured allowlist using current pricing and capability metadata. The default
allowlists contain only `openai/gpt-4o-mini`; add multiple approved models to
compare prices. An explicit `OPENROUTER_PLANNING_MODEL` overrides cost ranking
for planning. Tripo generates missing geometry and can segment it into parts.
A valid GLB alone is not a usable repair guide: every hands-on step must have
valid mapped targets. When supported repair instructions are unavailable,
the pipeline can instead complete an explicitly labeled **3D visual preview**.
Previews use real generated geometry without invented steps, semantic labels,
segmentation, or mechanical claims.
If OpenRouter rate-limits a model, the stage automatically backs off and tries
the next-cheapest eligible model (up to three attempts; explicit planning pins
remain pinned). Persistent rate limits, missing credits, and credential errors
are shown explicitly instead of a generic processing failure.

The workspace keeps progress across refreshes. Once the authorized model loads,
the 3D view opens automatically alongside the menu and step controls. Selecting
a step highlights its parts and focuses the camera. On phones, the model stays
in view while the step panel scrolls independently. Loading remains visible
through cache lookup, generation, and the final private-model download.
Model generation, mapping, or browser rendering failures show an explicit error
without substituting geometry or unlocking unvalidated hands-on instructions.
Model-only previews open automatically in the same large viewport, with orbit,
zoom, reset, private GLB download, and the image description. They do not show
repair-step controls. Image descriptions and tentative identification remain
available when preparation is pending or fails; failures never unlock
unvalidated instructions.

OpenRouter analyzes the uploaded image together with the written description
before routing new runs, including problems outside supported hands-on repairs.
The workspace shows the actual vision model and tentative identification when
recognition succeeds; provider failures never fabricate an identification.
The same vision request also produces **What the AI sees in your photo**: a
plain-language image description and visible features, independent of repair
eligibility. This private image-to-text result remains visible when a product
name is unknown or 3D preparation is blocked; it is not repair guidance.
Older saved results can display their existing detected features without a new
provider request. Descriptions follow the same owner and consent restrictions
as the uploaded image.
Product research stays within the existing Firecrawl budget. Insufficient
repair applicability does not by itself prevent an approximate visual model,
but it still blocks hands-on instructions. Existing blocked runs require an
explicit retry; deploying this change does not automatically buy new geometry.

Enable `NEXT_PUBLIC_VISUAL_REPAIR_ENABLED=true` in the frontend and
`VISUAL_REPAIR_ENABLED=true` in Convex only after configuring Firecrawl,
OpenRouter, and Tripo with explicit budgets. Provider keys are server-only.
See [backend configuration](convex/README.md) and `.env.example`.
The existing temporary demo, saved legacy repairs, and separate audio workflow
remain available; this flag does not migrate earlier repairs.
Connected intake always defaults to photo + prompt. When the frontend visual
flag is off, it shows a setup notice and disables submission instead of silently
creating an old-style analysis. Legacy audio/text intake is an explicit choice
at `/problems/new?input=audio`; saved legacy repairs link to a new visual intake
rather than automatically migrating media or provider consent.

Initial consent covers all providers and automatic paid Tripo work within the
configured limits, so there is no second recognition/generation confirmation.
Private AI drafts are not human-reviewed guidance. Only supported low-risk
tasks proceed to hands-on guides; unknown applicability or unmappable parts
stop hands-on instructions, not an otherwise available visual-only preview.
User photos and personal cached results are not automatically shared.
Additional web images remain source links unless reuse rights are established.
General household intake does not guarantee generation for every object.

The original written request is passed to planning along with recognition and
source excerpts. Prompts distinguish problem data from attempts to override
safety and prohibit replacing a reported malfunction with unrelated cleaning.
Unsupported planning returns the schema-valid `{"plan":null,"evidence":[]}`
outcome, which permits a model-only preview rather than inventing repair steps.

Automatic drafts currently cover source-quoted visible inspection, dry exterior
care, and hand-tightening an already visible, accessible cabinet/drawer handle
or knob screw with a manual screwdriver. Mechanical guidance requires matching
source evidence, known applicability, and stable non-powered furniture.
Other procedures need a reviewed compatible reference or are referred for
qualified help. Generated geometry cannot establish hidden anatomy, dimensions,
safe force, or mechanical accuracy.

Private photo-derived cache reuse requires matching image/text evidence and a
fresh recognition result; compatible reviewed references can serve different
photos. A mismatch stop invalidates the saved run and its private cache entry.
Semantic segmentation cannot reliably identify every required repair target
(especially small fasteners). A visual preview does not establish those targets
or prove repair compatibility.

### Cache durability and backups

Convex stores compatible solutions, scene mappings, and asynchronous run state;
its file storage holds the private photos and GLBs. This application cache is
separate from [Convex Backup & Restore](https://docs.convex.dev/database/backup-restore).
In the deployment dashboard, include **file storage** when creating a backup
so restored scene records retain their model files. Automatic daily/weekly
backups require the appropriate Convex plan; they are not enabled by deploying
this repository.

Backups do not include backend code, environment variables, or pending scheduled
functions. Restore the matching code and configuration separately, and reconcile
in-flight provider tasks before retrying any paid generation. A database restore
replaces existing table data: take a fresh backup first and do not use restore
as a cache-miss recovery mechanism.

### Debugging repair progress

Run `npm run dev` to see Next.js and backend repair logs in the **same terminal**.
It loads the same development environment as Next.js, selects the deployment
from the frontend's standard Convex URL, and streams the last 10 backend entries
followed by live events. Ctrl+C stops both processes. No keys or backend are
required for temporary mode; it prints that backend logging is unavailable.
If the stream fails, an explicit terminal error appears while Next.js stays up.
For custom hosts, configure the matching `CONVEX_SELF_HOSTED_URL`, or use the
separate log command with the appropriate deployment.

After deploying the backend, run `npm run repair:status` for a read-only
configuration check. It reports missing backend flags, keys, model version, or
valid daily budgets by name, never secret values. `ready: true` means those
settings are present, not a guarantee of provider credit or model success.
The frontend separately needs `NEXT_PUBLIC_VISUAL_REPAIR_ENABLED=true` in
`.env.local` (or the website hosting environment) and a restart/rebuild.

To stream backend logs without starting the website (last 50 entries, then live updates):

```sh
npm run convex:logs
```

For the project's production deployment, use `npm run convex:logs:prod`.
These commands only read logs; they do not deploy code or start paid generation.
Make sure the selected deployment matches the website's `NEXT_PUBLIC_CONVEX_URL`.
For machine-readable output, add `-- --jsonl`.

Firecrawl and OpenRouter HTTP logs are compact single-line entries with the
provider, operation (`search`, `models`, or `completion`), HTTP status, and
elapsed milliseconds. Each request logs a start and a response or network
failure; search terms and response bodies are omitted.

Open the browser developer tools **Console**, enable Info messages, filter for
`[repair]`, and enable Preserve log before submitting or reopening a repair.
Events cover intake mode, photo upload/finalization, saved pipeline phases,
private model download/validation, viewer readiness, and step focus.
`workspace.state` reports `workflow`, `phase`, and the frontend `enabled` flag,
including legacy repairs that do not use the automatic visual pipeline.

Backend stage claims/completions, cache decisions, provider HTTP status, Tripo
polling, failures, and cancellation appear in the **Convex dashboard Logs** for
the deployment used by `NEXT_PUBLIC_CONVEX_URL` (also streamed by `npm run dev`
and `npx convex dev`). Missing/blocked server models log `model.unavailable`.
Browser model failures also forward a fixed diagnostic code to Convex as
`viewer.failed`, including missing/invalid models, download/render failures,
timeouts, and expired sessions. The UI reports if diagnostic delivery fails.
Other browser events remain in developer tools. `npm run dev:web` and `npm run start` alone
do not stream Convex logs. Match `problemId`, `runId`, and `stageId`; `run.ready` also
contains the `sceneId` used by browser model events.

Tripo events distinguish photo upload, generation/segmentation submission,
polling, download, validation, and storage. Failures include `operation`,
`elapsedMs`, and a safe `code`, such as `provider_http_401`,
`request_failed_or_timed_out`, `invalid_model_geometry`, or
`untrusted_asset_host`. Task acknowledgments and polls include `requestId`
for provider-dashboard reconciliation. `tripo.poll.scheduled` means another
poll is due in 15 seconds; `stage.expired` means the stage deadline was reached.
An `ambiguous: true` paid submission must not be blindly resubmitted.

Logs contain operational metadata and categorical error codes, not raw prompts,
photos, source excerpts, URLs, credentials, or provider response bodies. Logging
is enabled by default; no debug flag is needed. Deploy backend changes and
restart/redeploy the frontend to use the new logging. A frontend publish alone
neither deploys Convex nor migrates a legacy repair to the visual workflow.

## Legacy photo-to-3D repair context with Tripo

In a connected repair workspace, run analysis first. **Generate 3D with Tripo**
becomes available only for a low-risk match to a currently published, reviewed
guide. Referral, uncertain, unsupported, and unreviewed-catalog cases remain
blocked; the starter catalog alone does not unlock paid generation.

Choose one uploaded close-up and explicitly consent to sending it to Tripo.
Frame or crop the source photo before uploading to focus on the relevant panel,
knob, and visible shaft rather than the entire room. The backend uploads that
image, submits one image-to-model task, saves progress, polls with a deadline,
and stores a validated GLB privately. The budget is shared with editorial
generation; refreshing or double-clicking does not resubmit an active task.

When ready, open the private model to rotate/zoom, or download its GLB and use
**Blender > File > Import > glTF 2.0**. This follows the image-to-asset portion of
the [Tripo/Blender cookbook](https://developers.tripo3d.ai/en/cookbook/codex-blender-interior-scene);
it does not install a Blender agent or run Blender on the server.

The generated geometry is **unreviewed spatial context**, not a dimensionally
accurate scan, confirmed diagnosis, or evidence of hidden components. No
automatic segmentation, shaft/knob alignment, part labels, repair graph, or
force/direction instructions are inferred from it. Those require separate
verification and review. Existing DIY instructions still come only from reviewed
catalog guides. This integration uses a single selected photo, not video.

Changing repair inputs or revoking consent invalidates scene access and cancels
pending application jobs. Deleting the repair deletes its stored scenes too.
Neither action guarantees cancellation/refunds or deletion at Tripo once an
image or task has already been submitted.

Signing keys and provider secrets belong in Convex, never in `NEXT_PUBLIC_*`
variables or Git. See `.env.example` and [`convex/README.md`](convex/README.md)
for configuration and API details.

## MVP boundaries

### Legacy catalog walkthrough

The legacy catalog and temporary demo are separate from the automatic visual
repair pipeline described above. Their capabilities remain:

- Photo/audio intake feeds a tentative catalog assessment in connected mode.
  Temporary mode saves input locally and requires manual example selection.
- Reconstruction currently means choosing a reference, **not reconstructing the
  user's exact object**. The homepage door is a procedural four-part illustration.
  Its frame, panel, hinges, and handle can be separated, selected, isolated, and
  focused. No hidden latch or appliance mechanism is inferred.
- Plans come from reviewed catalog versions. Guides and saved repair workspaces
  embed the same visual tutorial, with step-to-part highlighting, part-to-step
  navigation, recognition checkpoints, and a pause path when the object differs.
  Saved repair photos remain available beside the reference workflow.
- Checkpoint completion records understanding within the mounted tutorial only;
  it is not a repair outcome or a safety approval. Missing direction or force
  information is shown as unknown rather than guessed.

Guide steps optionally include a `visual` object with `location`, `lookFor`,
`motion`, `force`, `risk`, and `check` strings (1–800 characters each). Review all
six against the exact applicable product before publication. Existing guides
without these fields remain readable and show conservative unknowns.

For generated decomposition, a GLB must contain genuinely separate named mesh
nodes. Naming one fused mesh as several parts does not segment it. Clean or
segment generated geometry in Blender, map each node once, provide explode
offsets, and complete the existing administrative review before publication.
Existing saved drafts are not overwritten by seeding: edit the door example's
`assemblyKind` to `door` and map its step IDs when upgrading an existing draft.

The initial catalog contains eight **unreviewed drafts**. Procedural 3D previews
are explicitly labeled as illustrations, not Tripo outputs. Real generated assets
need inspection, named separate parts, and human review before publication.
Photos cannot reliably reveal hidden plumbing or electrical components.

The smart thermostat planning example is available at
`/examples/smart-thermostat-installation` and in the catalog. Its supplied image
is stored in `public/examples/`. The `thermostat` illustration separates the
trim plate, mounting base, terminal blocks, unidentified conductors, and screws.
The checkpoints cover compatibility, verified labels, C-wire requirements, and
professional installation planning; they do not assign wires to terminals or
establish electrical safety from the photo.

The photo-based washing-machine knob example is available from `/catalog` or
directly at `/examples/washing-machine-control-knob`, with or without Convex.
Its supplied reference image is a public catalog asset in `public/examples/`.
The `washer-control` illustration separates the panel, dial, visible shaft, and
knob concept; it does not model an engineered socket or provide a printable
replacement. Its checkpoints cover identification, measurements, design review,
and model-specific fit assessment without inferring installation directions from
the photo. It remains a draft and requires no AI generation or backend seeding
to explore.

Only low-risk household troubleshooting is supported. Hazardous and unsupported
repairs are referred to professionals. The legacy workflow selects published catalog guidance rather than inventing
repair procedures. The opt-in visual workflow can create private, cited AI
drafts for supported low-risk tasks; these are not published catalog guidance.

In connected mode, private history belongs to this browser's anonymous session.
Clearing storage, changing devices, or losing the session can lose access; there
is no account recovery or cross-device sync. Delete repairs before clearing
storage. Application deletion does not override provider retention policies.

## Development

Node.js 22 or newer and npm are supported. Local development is optional:

```sh
npm install
npm run dev
```

Project commands: `npm run lint`, `npm run typecheck`, `npm test`,
`npm run build`, and `npm run test:e2e` (install its browser with
`npx playwright install chromium`). Browser tests build and serve the production
website with temporary mode enabled. Development uses `.next-dev`; production
builds and browser tests use `.next`, so they do not overwrite a running dev
server's chunks. Do not run multiple production builds or browser-test runs at
the same time.

`npm run test:e2e:visual` runs the visual workflow in a separate Vite browser
harness with deterministic Convex/auth fixtures and a local GLB. It exercises
the actual React/WebGL components on desktop and small phones without connecting
to a deployment or making paid requests. Backend pipeline and authorization
coverage uses `convex-test`; neither test path enables a production fixture
endpoint.

If an older dev server reports missing `.next/server` chunks, stop it with
Ctrl+C and run `npm run dev` again to use the isolated development output.

## References

- [Convex docs](https://docs.convex.dev) and [AI guidance](https://docs.convex.dev/ai)
- [Hackathon resources](https://convex.dev/hackathon)
- [Community](https://convex.dev/community) and [documentation search](https://search.convex.dev)
- [Tripo API](https://docs.tripo3d.ai/) and [image-to-Blender workflow](https://www.tripo3d.ai/tutorials/image-to-blender-model-conversion-guide)
