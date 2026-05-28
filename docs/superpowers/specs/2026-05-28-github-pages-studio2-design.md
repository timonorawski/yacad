# GitHub Pages deploy for studio2

**Status**: design approved, implementing inline (small enough to skip a multi-task plan)
**Date**: 2026-05-28
**Scope**: Publish `apps/studio2`'s production build to GitHub Pages on every push to `main`, served at the custom domain `cad.yamplay.cc`.

## Goals

- Ship studio2 as a live, publicly accessible URL so it can be linked, shared, and demoed without local setup.
- Auto-deploy on `main` updates so the live site never drifts from the merged source.
- Use the existing custom domain (`cad.yamplay.cc`) so the URL doesn't expose the `github.io` subpath.

## Non-goals

- **Test-gated deploy.** The deploy workflow runs `pnpm --filter @yacad/studio2 build`, which catches type-check / build errors. It does not run the full unit suite or lint. If a unit test breaks main, the deploy will still happen. Acceptable for a prototype; revisit if it bites.
- **Deploy of `apps/studio` (v1).** Only studio2 is published. studio v1 stays local-only.
- **Preview deploys per PR.** Could be added later via the `pull_request` trigger + a `preview-<sha>` artifact, but adds complexity (multiple environments, cleanup). Not in scope.
- **Versioning / tag-based releases.** Continuous deploy from `main`. Tags can be added later if a release cadence emerges.
- **Bundle-size optimization.** The build currently emits chunks >500 KB (Manifold WASM + wasmoon + Monaco). GH Pages serves them fine; perf is its own concern.

## Decisions and rationale

### Custom domain at `cad.yamplay.cc`, base path `/`

`cad.yamplay.cc` is already listed in `apps/studio/vite.config.ts`'s `allowedHosts`, indicating the user already controls DNS for this hostname. Custom domain keeps the URL clean (`https://cad.yamplay.cc` vs `https://timonorawski.github.io/yacad/`) and lets Vite use `base: '/'` (its default) without subpath rewriting.

DNS prerequisite: a `CNAME` record on `cad.yamplay.cc` pointing at `timonorawski.github.io`. This is one-time configuration on the user's DNS provider, not in code.

_Rejected:_ `github.io` subpath. Would require `base: '/yacad/'` in Vite config, breaking the `pnpm dev` URL (which serves at root) unless we conditional-load the base. Custom domain sidesteps that.

### Deploy via GitHub Actions → Pages (modern flow)

The official `actions/configure-pages` + `actions/upload-pages-artifact` + `actions/deploy-pages` chain is the current GitHub-recommended approach. No `gh-pages` branch is created; the deployment is an Action artifact pushed directly to the Pages service.

_Rejected:_ `peaceiris/actions-gh-pages` (creates a `gh-pages` branch). Adds a branch to the repo; older pattern; modern flow is cleaner.

### Separate workflow file (`.github/workflows/deploy.yml`)

The existing `ci.yml` runs build + lint + format + test + build-app on every push and PR. A separate `deploy.yml` keeps concerns isolated: CI verifies, Deploy publishes. The two workflows run independently; both gate on the build step succeeding (CI runs `pnpm build`, deploy runs `pnpm --filter @yacad/studio2 build`).

_Rejected:_ Adding a deploy job to `ci.yml`. Would gate deploy on tests passing — a nicer property — but couples two workflows with different timing (tests are slow; deploy should be fast). Easy to refactor later if we want gating.

### Trigger on every push to `main` + manual dispatch

Auto-deploy on `main` matches prototype velocity. `workflow_dispatch` adds a "Run workflow" button in the Actions UI for manual redeploys (useful if a config change needs republishing without a code change).

`concurrency: { group: pages, cancel-in-progress: false }` ensures only one Pages deploy runs at a time, and queued deploys aren't canceled (so a rapid sequence of merges all eventually publish their state).

### `CNAME` + `.nojekyll` go in `apps/studio2/public/`

Vite copies the `public/` directory verbatim to `dist/`. Placing them in `public/` means:

- `CNAME` ends up at the artifact root, which is what GH Pages requires.
- `.nojekyll` (empty file) suppresses GitHub's Jekyll processor, which by default ignores files/directories starting with `_`. Vite's bundler emits chunked paths under various names; preventing Jekyll processing avoids any future surprise.

## Architecture

### Files added

```
.github/workflows/deploy.yml           NEW   GitHub Pages deploy workflow
apps/studio2/public/CNAME              NEW   "cad.yamplay.cc\n"
apps/studio2/public/.nojekyll          NEW   empty file
```

### Files unchanged

- `apps/studio2/vite.config.ts` — Vite's default `base: '/'` is correct for a custom-domain deploy.
- `.github/workflows/ci.yml` — runs as before; unaffected by the new workflow.

### Workflow shape

```yaml
name: Deploy studio2 to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @yacad/studio2 build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: apps/studio2/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

### One-time external configuration (not in code)

1. **GitHub repo Settings → Pages → Source = "GitHub Actions".** Switches the repo from "Deploy from branch" to "Deploy from a workflow." Required once.
2. **DNS:** add a `CNAME` record at `cad.yamplay.cc` pointing to `timonorawski.github.io`. After the first deploy, GitHub auto-issues a Let's Encrypt cert for the custom domain.
3. **Settings → Pages → Custom domain** = `cad.yamplay.cc`. Optional but enables the "Enforce HTTPS" checkbox.

These steps are documented in this spec but performed by the user in the GitHub UI / DNS provider. The CI cannot do them.

## Verification plan

After the first deploy:

1. `https://cad.yamplay.cc/` returns HTTP 200 with the studio2 HTML.
2. The viewport canvas appears, sample-scene dropdown works, evaluating a scene produces geometry.
3. Browser devtools network tab: `manifold.wasm` returns 200 with `content-type: application/wasm`.
4. Browser devtools network tab: `glue.wasm` (wasmoon) returns 200 with `content-type: application/wasm`.
5. No console errors related to CORS, MIME types, or 404s for asset chunks.

## Failure modes and recovery

- **DNS not propagated yet.** First few hours after CNAME setup, `cad.yamplay.cc` may not resolve. Wait or use the `timonorawski.github.io/yacad/` URL temporarily (works without a `base` change since GH Pages handles it via the Pages config).
- **Custom domain HTTPS pending.** GitHub takes minutes-to-hours to issue the Let's Encrypt cert after first verifying domain ownership. Until then, `https://cad.yamplay.cc` may show a cert warning; `http://` works.
- **Build fails on a push.** The deploy workflow shows red in the Actions tab; the previous deploy remains live (GH Pages doesn't auto-rollback but also doesn't auto-replace).
- **WASM 404.** If asset paths break under a future Vite/base change, check `apps/studio2/vite.config.ts` `base` matches the URL prefix. Currently `base` is the Vite default (`/`), correct for a custom domain.

## Out of scope (track in ROADMAP.md if needed later)

- Preview deploys per PR.
- Bundle size optimization (Monaco editor lazy-load, manifold-3d dynamic import, code-splitting).
- Test-gated deploy (fold into ci.yml, or trigger via `workflow_run`).
- Lighthouse / a11y CI checks on the deployed URL.
- Sourcemap upload to a service (e.g., Sentry) for production debugging.
- A landing page or marketing surface at `cad.yamplay.cc/` separate from the studio app.
