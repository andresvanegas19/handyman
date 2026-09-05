# handyman

A home-repair website with multimodal problem intake, catalog-grounded assistance,
and an interactive parts viewer. Built with Next.js, Convex, Clerk, and React Three
Fiber, with server-side OpenAI and Tripo integrations.

## Local setup

Requires Node.js 22 or newer and npm.

```sh
npm install
cp .env.example .env.local
npm run dev
```

Without service configuration, the website is a clearly labeled preview. You can
explore sample catalog content and illustrative 3D assemblies, but it does not
pretend to diagnose problems, generate Tripo models, or save submissions.
The six starter guides are drafts, not professionally approved repair advice.

## Configure the backend

1. Create a Convex project with `npx convex dev`.
2. Set `NEXT_PUBLIC_CONVEX_URL` in `.env.local` to its deployment URL.
3. Configure a Clerk application and its Convex JWT integration. Set
   `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` locally.
4. Configure the Clerk issuer and administrator subjects in the Convex dashboard.
   User IDs must come from trusted account administration, never a client form.
5. Set `OPENAI_API_KEY` and `TRIPO_API_KEY` in Convex environment variables.
   Optional model settings are listed in `.env.example`.
6. Seed draft content, review it in the admin area, and explicitly publish approved
   guides. An empty published catalog is expected before review.

Do not put secret API keys in `NEXT_PUBLIC_*` variables, source files, or Git.
Copy only the variable names, not real credentials, when sharing configuration.

## 3D asset workflow

Tripo creates candidate assets, not verified mechanical reconstructions. Generate
from approved catalog references, inspect and separate parts in Blender when
needed, export a GLB, then map its mesh node names to reviewed labels and guide
steps. Keep source and usage-rights records. Publication requires asset review.

Built-in procedural assemblies are explicitly illustrative previews, not Tripo
outputs. Photos cannot establish the existence or position of hidden plumbing,
wiring, fasteners, or internal components.

## Safety and privacy

Only low-risk household tasks are in scope. Unsupported or hazardous situations
must be referred to a professional, without improvised disassembly instructions.
AI suggestions must reference published catalog guidance rather than invent steps.
Feedback is an outcome report, not proof of safety.

The catalog is public. Submissions, uploads, transcripts, and history require
authentication and are private to their owner. Users must consent before media
processing. Never use private submissions to seed the public catalog or Tripo
references. Provider-side retention is governed by the configured provider's
policies; deleting application data does not imply provider-side deletion.

## Development commands

```sh
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Automated provider fixtures do not establish that paid integrations are configured.
Perform live-provider checks only with authorized credentials and an agreed budget.

## Deployment

Deploy Next.js to a compatible hosting provider and Convex to its production
deployment. Configure matching production Clerk settings and allowed origins.
Run `npx convex deploy` in the deployment workflow and make sure its frontend
build uses the production Convex URL rather than the development URL.
Keep preview and production credentials separate.

Before release, complete human review of all published instructions and GLB part
mappings, confirm provider budgets and retention policies, and exercise the
authenticated submit/transcribe/analyze/feedback/delete lifecycle against the
actual deployment. No cloud deployment or paid model generation is automatic
when installing or starting this project.

## References

- [Convex docs](https://docs.convex.dev)
- [Convex AI guidance](https://docs.convex.dev/ai)
- [Convex + GitHub Copilot](https://docs.convex.dev/ai/using-github-copilot)
- [Convex hackathon resources](https://convex.dev/hackathon)
- [Convex community](https://convex.dev/community) and [search](https://search.convex.dev)
- [Tripo API documentation](https://docs.tripo3d.ai/)
- [Tripo image-to-Blender workflow](https://www.tripo3d.ai/tutorials/image-to-blender-model-conversion-guide)
