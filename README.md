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
npm run test:e2e
```

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

## Deployment

Build and inspect the public site before deploying:

```bash
npm run check
```

Only files listed in `scripts/public-files.json` are copied into `dist/`. Add new public assets there explicitly. Local notes, tests, editor settings, source resumes, and backend code are not static assets. The build clears stale output and rejects symlinks. The Pages middleware enforces the same list, including for cached files. Keep the font license with the public font files.

Production deployments target the existing Cloudflare Pages project:

```bash
npm run deploy
```

This runs the checks, rebuilds `dist/`, and deploys that directory with `wrangler pages deploy dist --project-name personal-webpage --branch master`. Never deploy the repository root. Wrangler bundles `functions/` separately from the static assets.

For Cloudflare Git builds, set the build command to `npm run build` and the output directory to `dist`. A local `.gitignore` does not control what a direct upload publishes.

The contact Function expects its production secrets and service configuration in Cloudflare. Values are intentionally not stored in this repository.

The `www.zounarakis.com` hostname must be attached to this Pages project, with its DNS record pointing to the project's Pages hostname. The middleware redirects GET and HEAD requests to `https://zounarakis.com` with a 301. Other methods use a 308 to preserve the request body. Both keep the path and query string. Hostname redirects cannot use Pages `_redirects`. See [Cloudflare redirect support](https://developers.cloudflare.com/pages/configuration/redirects/).

After deployment, check that private paths such as `/docs/local/BLOG-GUIDE.md`, `/.claude/launch.json`, `/tests/contact-form.spec.ts`, and `/package.json` return 404. Verify that `https://www.zounarakis.com/?source=check` redirects to `https://zounarakis.com/?source=check`.

## Ownership

The code, writing, images, and portfolio artifacts are maintained by Aris Zounarakis. No open-source license is granted by this repository.
