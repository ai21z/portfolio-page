# Personal Webpage

Single-page portfolio. WebGL visualizations, interactive showcase, secure contact.

---

## Features

- **Work Globe** — WebGL2 3D network graph
- **Blog Network** — Force-directed topic visualization
- **Projects Wheel** — Circular showcase with MTG-style cards
- **Contact Form** — Rate-limited, Turnstile-protected
- **Responsive** — Desktop and mobile optimized
- **Vanilla Stack** — No framework dependencies

---

## Quick Start

```bash
# Serve locally
python -m http.server 8000
# or
npx http-server -p 8000
```

Visit `http://localhost:8000`

### Testing

```bash
npx playwright install  # one-time
npm run test:e2e
```

---

## Structure

```
├── index.html          # Entry point
├── js/                 # Modules (app, navigation, WebGL, contact)
├── styles/             # Component CSS
├── api/                # Vercel serverless (contact endpoint)
├── artifacts/          # Static assets, data JSONs
├── tests/              # Playwright E2E
└── docs/local/         # Private setup docs (git-ignored)
```

---

## Stack

**Frontend:** HTML5, CSS3, Vanilla JS (ES6+), WebGL2, Canvas API  
**Backend:** Vercel Functions, Cloudflare Turnstile, Upstash Redis, Resend  
**Testing:** Playwright

---

## Deployment

```bash
vercel --prod
```

Environment variables configured via Vercel dashboard. Details in `docs/local/`.

---

## License

Code is original. Images and artifacts are property of Vissarion Zounarakis.

---

**Vissarion Zounarakis** — Barcelona
