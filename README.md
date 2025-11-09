# Personal Webpage

A single-page portfolio website featuring WebGL visualizations, interactive projects showcase, and secure contact form.

---

## ✨ Features

- **WebGL2 Globe Visualization** - Interactive 3D network graph for work experience
- **Blog Network Visualization** - Dynamic force-directed graph of blog posts and topics
- **Projects Wheel** - Interactive circular showcase of projects with MTG-inspired cards
- **Secure Contact Form** - Rate-limited form with Cloudflare Turnstile protection
- **Responsive Design** - Optimized for desktop and mobile devices
- **No Framework Dependencies** - Built with vanilla JavaScript, HTML5, and CSS3

---

## � Quick Start

### Local Development

```bash
# Clone the repository
git clone https://github.com/yourusername/personal-webpage.git
cd personal-webpage

# Install dependencies (only needed for testing)
npm install

# Serve locally (choose one method)

# Option 1: Python
python -m http.server 8000

# Option 2: Node.js http-server
npx http-server -p 8000

# Option 3: VS Code Live Server
# Install "Live Server" extension, right-click index.html → "Open with Live Server"
```

Visit `http://localhost:8000`

### Testing

```bash
# Install Playwright browsers (one-time setup)
npx playwright install

# Run E2E tests
npm run test:e2e

# Run tests with UI
npm run test:e2e -- --ui
```

---

## 📁 Project Structure

```
├── index.html              # Main HTML entry point
├── js/                     # JavaScript modules
│   ├── app.js             # Application entry point
│   ├── navigation.js      # Section navigation
│   ├── work-globe-webgl.js # Work experience WebGL visualization
│   ├── blog-network-webgl.js # Blog network WebGL visualization
│   ├── projects-wheel.js  # Projects showcase
│   ├── contact.js         # Contact form logic
│   └── ...                # Additional modules
├── styles/                 # CSS stylesheets
│   ├── base.css           # Typography and base styles
│   ├── layout.css         # Layout and grid
│   ├── work.css           # Work section styles
│   ├── blog.css           # Blog section styles
│   └── ...                # Component-specific styles
├── api/                    # Vercel serverless functions
│   └── contact.js         # Contact form endpoint
├── artifacts/              # Static assets
│   ├── blog_network.json  # Blog network data
│   ├── network.json       # Work network data
│   └── ...                # Images, fonts, etc.
├── tests/                  # Playwright E2E tests
│   └── contact.spec.js    # Contact form tests
└── docs/                   # Documentation (see docs/local/ for setup)
```

---

## 🛠️ Tech Stack

### Frontend
- **HTML5** - Semantic markup
- **CSS3** - Custom properties, Grid, Flexbox
- **JavaScript (ES6+)** - Vanilla JS, no frameworks
- **WebGL2** - 3D visualizations (work globe, blog network)
- **Canvas API** - 2D graphics and animations

### Backend (Contact Form)
- **Vercel Serverless Functions** - API endpoint hosting
- **Cloudflare Turnstile** - Bot protection
- **Upstash Redis** - Rate limiting (5 messages / 10 minutes)
- **Resend** - Email delivery
- **Zod** - Schema validation

### Testing
- **Playwright** - E2E testing framework
- **Vitest** (optional) - Unit testing

---

## 🧪 Testing

The project uses Playwright for end-to-end testing.

### Running Tests

```bash
# Run all tests
npm run test:e2e

# Run tests in headed mode (with browser UI)
npm run test:e2e -- --headed

# Run tests with Playwright UI (interactive)
npm run test:e2e -- --ui

# Run specific test file
npx playwright test tests/contact.spec.js
```

### Current Test Coverage

- ✅ Contact form rendering and structure
- ✅ Form submission with mocked API
- ✅ Turnstile widget stubbing

### Planned Tests

- Field validation (empty fields, invalid email)
- Character counter behavior
- Rate limiting simulation
- Honeypot detection
- Responsive design breakpoints

---

## � Documentation

- **Public README** (this file) - General project information
- **Private Setup Docs** (`docs/local/`) - Backend configuration (git-ignored)
  - Contact form setup with Cloudflare, Upstash, Resend, Vercel
  - Environment variables and API keys
  - Troubleshooting guide

**Note:** The `docs/local/` folder is excluded from version control and contains sensitive setup information.

---

## 🚢 Deployment

### Deploy to Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel

# Deploy to production
vercel --prod
```

**Important:** Contact form requires environment variables configured in Vercel dashboard. See `docs/local/CONTACT-FORM-SETUP.md` for detailed setup instructions.

### Deploy to Netlify

1. Push repository to GitHub/GitLab
2. Connect to Netlify
3. Deploy settings:
   - **Build command:** (leave empty)
   - **Publish directory:** `.` (root)

### Deploy to GitHub Pages

1. Push to GitHub
2. Settings → Pages
3. Source: Deploy from branch `main`
4. Folder: `/` (root)

---

## 🤝 Contributing

This is a personal portfolio project, but suggestions and bug reports are welcome!

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -m 'Add some feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

---

## 📄 License

All code is original. Images and artifacts are property of Vissarion Zounarakis.

---

## 👤 Author

**Vissarion Zounarakis** (Aris)  
Barcelona-based software engineer from Greece

---

**Built with ❤️**
