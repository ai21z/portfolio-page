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
npm install
npm run preview
```

Open `http://127.0.0.1:4173/index.html`.

## Testing

```bash
npx playwright install
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
docs/local/         Private deployment notes, excluded from Git
```

## Deployment

Production deployments target the existing Cloudflare Pages project:

```bash
npx wrangler pages deploy . --project-name personal-webpage --branch master
```

The contact Function expects its production secrets and service configuration in Cloudflare. Values are intentionally not stored in this repository.

## Ownership

The code, writing, images, and portfolio artifacts are maintained by Aris Zounarakis. No open-source license is granted by this repository.
