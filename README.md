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
   Its six example guides and four procedural assemblies are clearly labeled
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
`npm run dev` in separate terminals for local development.

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
OpenRouter defaults to `qwen/qwen3.8-flash` for user-facing responses, recognition,
and part mapping. Configured allowlists can select other low-cost capable models;
availability and structured-output capabilities are checked before use. Tripo generates missing
geometry and can segment it into parts. A valid GLB alone is not a usable guide:
every step must have valid mapped targets before the result can become ready.

The workspace keeps progress across refreshes. Once the authorized model loads,
the 3D view opens automatically alongside the menu and step controls. Selecting
a step highlights its parts and focuses the camera. Model generation, mapping,
or browser rendering failures show an explicit error, not a text-only solution
or a substitute procedural model.

Enable `NEXT_PUBLIC_VISUAL_REPAIR_ENABLED=true` in the frontend and
`VISUAL_REPAIR_ENABLED=true` in Convex only after configuring Firecrawl,
OpenRouter, and Tripo with explicit budgets. Provider keys are server-only.
See [backend configuration](convex/README.md) and `.env.example`.
The existing temporary demo, saved legacy repairs, and separate audio workflow
remain available; this flag does not migrate earlier repairs.

Initial consent covers all providers and automatic paid Tripo work within the
configured limits, so there is no second recognition/generation confirmation.
Private AI drafts are not human-reviewed guidance. Only supported low-risk
tasks proceed; unknown applicability or unmappable parts stop the workflow.
User photos and personal cached results are not automatically shared.
Additional web images remain source links unless reuse rights are established.
General household intake does not guarantee generation for every object.

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

### Visual repair workflow

The experience follows **Photo → Diagnose → Reconstruct → Generate repair plan →
Visualize in 3D → Guide user**, with the current capabilities made explicit:

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

The initial catalog contains six **unreviewed drafts**. Procedural 3D previews
are explicitly labeled as illustrations, not Tripo outputs. Real generated assets
need inspection, named separate parts, and human review before publication.
Photos cannot reliably reveal hidden plumbing or electrical components.

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
