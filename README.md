# zounarakis.com

Source for [zounarakis.com](https://zounarakis.com), the portfolio of Aris Zounarakis.

## Features

- Interactive WebGL work globe with an accessible timeline fallback.
- Responsive section navigation and reduced-graphics behavior.
- Portfolio, current-work, skills, blog, and contact views.
- Rate-limited contact pipeline protected by Cloudflare Turnstile.
- Cross-browser Playwright coverage for key interactions and content contracts.

## Stack

- Frontend: HTML, CSS, vanilla JavaScript, WebGL2, and Canvas.
- Backend: Cloudflare Pages Functions, Turnstile, Upstash Redis, and Resend.
- Testing: Playwright across Chromium, Firefox, and WebKit.
- Hosting: Cloudflare Pages with `zounarakis.com` as the canonical domain.

## Local Development

```bash
npm ci
npm run preview
```

Open `http://127.0.0.1:4173/index.html`.

The build bundles and minifies `styles/main.css`. Edit the source stylesheets and rebuild to update the preview. Regenerate the smaller portrait and seal images with `node scripts/generate-webp-assets.mjs --responsive-only`.

## Testing

```bash
npx playwright install
npm run check
npm run check:dependencies
npm run test:e2e -- --grep-invert "browser audit|records Contact first-entry"
```

The static preview does not run the contact Function or apply edge headers. `npm run check` includes an isolated compiled Pages integration with synthetic bindings and blocked unexpected outbound requests. It does not send real mail. Heavy profiling is separate from these correctness checks.

## Project Layout

```text
index.html          Main portfolio document
js/                 Navigation, content, interaction, and WebGL modules
styles/             Page and component styles
functions/          Cloudflare Pages Functions, including the contact endpoint
artifacts/          Resume, images, and generated data
tests/              Playwright behavior, smoke, and asset tests
tests/unit/         Contact endpoint and deployment checks
scripts/public-files.json  Files allowed in a deployment
dist/               Generated public site, excluded from Git
docs/local/         Private deployment notes, excluded from Git
```

## Articles

Each article has a standalone HTML page with an extensionless canonical URL, search metadata, and an Aris Zounarakis author byline. The in-page reader keeps the existing hash links working. Its Permalink opens the standalone page for sharing.

When adding an article, update `blog/articles.json`, the published article links in `index.html`, `sitemap.xml`, and `scripts/public-files.json`. Keep publication dates accurate. Add a sitemap `lastmod` only when the content change date is known. Run `npx playwright test tests/seo.spec.ts` to check discovery, metadata, and navigation.

## Deployment

Build and inspect the public site before deploying:

```bash
npm run check
```

Only files listed in `scripts/public-files.json` are copied into `dist/`. Add new public assets there explicitly. Local notes, tests, editor settings, source resumes, and backend code are not static assets. The build clears stale output and rejects symlinks. The Pages middleware enforces the same list, including for cached files. Keep the font license with the public font files.

Production publishing requires a clean master checkout and the full reviewed commit:

```bash
npm run deploy -- --commit <full-reviewed-commit>
```

Preview publishing uses `npm run deploy:preview -- --commit <full-reviewed-commit>` from a clean non-master branch. Both paths build fresh output, run unit, Pages-runtime and browser checks, then recheck the source and output before invoking the uploader. The receipt includes the branch, commit and hashes covering tracked source and the public output. Functions and middleware are part of the source hash. Never deploy the repository root.

Stop any existing preview on port 4173 before publishing so the browser checks own their server. A failed check prevents this entry point from uploading. This local guard does not prevent an account owner from invoking Wrangler separately. Commits and production publishing still require a deliberate review.

When a shell consumes npm's argument separator, use `node scripts/deploy-site.mjs production --commit <full-reviewed-commit>` to invoke the same guard directly.

HTML responses require revalidation. Keep the stylesheet and Work module versions aligned when releasing changes. The homepage import map versions shared contact, navigation and graphics modules without creating duplicate module instances.

For Cloudflare Git builds, set the build command to `npm run build` and the output directory to `dist`. A local `.gitignore` does not control what a direct upload publishes.

The contact Function expects its production secrets and service configuration in Cloudflare. Values are intentionally not stored in this repository.

The form keeps unsuccessful drafts in the page and a retry identifier in session storage. It uses bounded requests and Resend idempotency without automatic sending retries. Provider acceptance is not a delivery receipt. Exact allowed Turnstile hostnames can be set with `CONTACT_ALLOWED_HOSTNAMES`, defaulting to `zounarakis.com`. Preview configuration must be explicit.

The build generates CSP hashes from the public HTML. Scripts allow the same origin, those exact inline hashes, Turnstile and the existing Cloudflare Web Analytics beacon. Its collection endpoint is allowed separately. Inline styles remain allowed for the existing artwork and dynamic positioning. The browser tests exercise report-only and enforcement through Cloudflare's local Pages asset handler. No CSP reporting collector is configured.

The `www.zounarakis.com` hostname must be attached to this Pages project, with its DNS record pointing to the project's Pages hostname. The middleware redirects GET and HEAD requests to `https://zounarakis.com` with a 301. Other methods use a 308 to preserve the request body. Both keep the path and query string. Hostname redirects cannot use Pages `_redirects`. See [Cloudflare redirect support](https://developers.cloudflare.com/pages/configuration/redirects/).

After deployment, check that private paths such as `/docs/local/BLOG-GUIDE.md`, `/.claude/launch.json`, `/tests/contact-form.spec.ts`, and `/package.json` return 404. Verify that `https://www.zounarakis.com/?source=check` redirects to `https://zounarakis.com/?source=check`.

## Maintenance

Review dependency advisories and changelogs before updates, retain the lockfile, then run the checks and inspect the preview. The workflow pins checkout, setup-node and upload-artifact to reviewed release commits. When updating an action, verify the upstream release and tag commit, update its pin and version comment together, and review the resulting CI run. No dependency bot or automatic publishing workflow is enabled here.

## Ownership

The code, writing, images, and portfolio artifacts are maintained by Aris Zounarakis. No open-source license is granted by this repository.
