import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';
import { renderProjectLinks, renderWorkIndex } from '../js/work-globe/work-index-content.js';
import { appendContentSecurity } from './content-security.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const manifestPath = new URL('./public-files.json', import.meta.url);
export const publicFiles = JSON.parse(await readFile(manifestPath, 'utf8'));

function validateManifest(files) {
  const seen = new Set();
  for (const file of files) {
    const parts = typeof file === 'string' ? file.split('/') : [];
    if (!parts.length || parts.some(part => !part || part.startsWith('.')) ||
        /[\\:]/.test(file) || seen.has(file.toLowerCase()) ||
        /^(docs|tests|scripts|functions|node_modules|dist|build)\//.test(file)) {
      throw new Error(`Invalid public file: ${file}`);
    }
    seen.add(file.toLowerCase());
  }
}

async function assertRegularFile(root, file) {
  let current = root;
  const parts = file.split('/');
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) {
      throw new Error(`Not a regular public file: ${file}`);
    }
  }
}

async function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = `${prefix}${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Symlink in deployment: ${file}`);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path.join(directory, entry.name), `${file}/`));
    } else if (entry.isFile()) {
      files.push(file);
    } else {
      throw new Error(`Unexpected deployment entry: ${file}`);
    }
  }
  return files.sort();
}

export async function verifyPublicSite(directory) {
  validateManifest(publicFiles);
  const actual = await listFiles(directory);
  const expected = [...publicFiles].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('Deployment files do not match scripts/public-files.json');
  }
  return actual;
}

async function bundleStyles(root) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['styles/main.css'],
    outfile: 'styles/main.css',
    bundle: true,
    minify: true,
    write: false,
    logLevel: 'silent',
    target: ['chrome100', 'firefox100', 'safari15.4'],
    plugins: [{
      name: 'public-styles',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => {
          if (args.kind === 'url-token') return { path: args.path, external: true };
        });
        builder.onLoad({ filter: /.*/ }, async args => {
          const file = path.relative(root, args.path).split(path.sep).join('/');
          if (!file.endsWith('.css') || !publicFiles.includes(file)) {
            throw new Error(`Unlisted stylesheet: ${file}`);
          }
          await assertRegularFile(root, file);
          return { contents: await readFile(args.path, 'utf8'), loader: 'css' };
        });
      }
    }]
  });
  return result.outputFiles[0].contents;
}

// Shipped modules are minified in place: same files and paths, smaller bytes.
// Names are kept, so nothing that reads a function or class name changes.
async function minifyScripts(output) {
  for (const file of publicFiles.filter(file => /^js\/.+\.js$/.test(file))) {
    const target = path.join(output, file);
    const result = await transform(await readFile(target, 'utf8'), {
      loader: 'js', format: 'esm', minify: true, keepNames: true, legalComments: 'none',
      target: ['chrome100', 'firefox100', 'safari15.4']
    });
    await writeFile(target, result.code);
  }
}

// A file's cache token: the start of the SHA-256 of the bytes served. functions/_middleware.js
// computes the same token to decide whether a response may be cached as immutable.
export const contentToken = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 12);

// Sets ?v= on a page reference from the file's content. Every module and stylesheet gets a token,
// and any other file the source marks with ?v=. External, data and fragment references are left alone.
function versioned(reference, fromFile, tokens) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)) return reference;
  const base = new URL(fromFile, 'https://site.invalid/');
  const url = new URL(reference, base);
  const file = decodeURIComponent(url.pathname.slice(1));
  if (!tokens.has(file) || !(url.searchParams.has('v') || /^(js|styles)\//.test(file))) return reference;
  const [beforeHash, fragment] = reference.split('#');
  const [pathPart, query = ''] = beforeHash.split('?');
  const params = new URLSearchParams(query);
  params.set('v', tokens.get(file));
  return `${pathPart}?${params}${fragment === undefined ? '' : `#${fragment}`}`;
}

function versionPage(html, page, tokens) {
  const withRefs = html.replace(/\b(src|href|srcset|imagesrcset)="([^"]*)"/g, (match, attribute, value) => {
    const next = /srcset$/.test(attribute)
      ? value.split(',').map(entry => entry.replace(/^(\s*)(\S+)/, (m, space, ref) => space + versioned(ref, page, tokens))).join(',')
      : versioned(value, page, tokens);
    return `${attribute}="${next}"`;
  });
  // The import map names every module with its token, so imports inside modules, dynamic imports
  // included, resolve to versioned URLs without any token in the module sources.
  return withRefs.replace(/(<script type="importmap">)[\s\S]*?(<\/script>)/, (match, open, close) => {
    const dir = path.posix.dirname(page);
    const imports = {};
    for (const file of publicFiles.filter(file => /^js\/.+\.js$/.test(file))) {
      const key = path.posix.relative(dir, file);
      const specifier = key.startsWith('.') ? key : `./${key}`;
      imports[specifier] = `${specifier}?v=${tokens.get(file)}`;
    }
    const json = JSON.stringify({ imports }, null, 2).split('\n').join('\n    ');
    return `${open}\n    ${json}\n  ${close}`;
  });
}

async function versionAssets(output) {
  const tokens = new Map();
  const hash = async file => tokens.set(file, contentToken(await readFile(path.join(output, file))));
  for (const file of publicFiles) {
    if (!file.startsWith('_') && !file.endsWith('.html') && !file.endsWith('.css')) await hash(file);
  }
  // Stylesheets can reference other files, so they are versioned once those have tokens.
  for (const file of publicFiles.filter(file => file.endsWith('.css'))) {
    const target = path.join(output, file);
    const css = await readFile(target, 'utf8');
    await writeFile(target, css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g,
      (match, quote, ref) => `url(${quote}${versioned(ref, file, tokens)}${quote})`));
    await hash(file);
  }
  for (const page of publicFiles.filter(file => file.endsWith('.html'))) {
    const target = path.join(output, page);
    await writeFile(target, versionPage(await readFile(target, 'utf8'), page, tokens));
  }
  return tokens;
}

// The static import graph of the page's module scripts, as the URLs the browser will request
// (relative imports resolved, then the page's import map applied). Preloading them all lets the
// browser fetch them in parallel instead of one import level at a time.
async function moduleGraph(root, html) {
  const importMap = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1] || '{}').imports || {};
  const base = new URL('https://site.invalid/index.html');
  const mapped = new Map(Object.entries(importMap).map(([from, to]) => [new URL(from, base).href, new URL(to, base).href]));
  const pending = [...html.matchAll(/<script type="module" src="([^"]+)"/g)].map(match => new URL(match[1], base).href);
  const seen = new Set();
  while (pending.length) {
    const url = pending.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const file = decodeURIComponent(new URL(url).pathname.slice(1));
    if (!publicFiles.includes(file)) continue;
    const source = await readFile(path.join(root, file), 'utf8');
    for (const match of source.matchAll(/(?:^|[;\n])\s*(?:import|export)\s*(?:[\w$*{}\s,]+?\s*from\s*)?['"]([^'"]+)['"]/g)) {
      if (!match[1].startsWith('.')) continue;
      const resolved = new URL(match[1], url).href;
      pending.push(mapped.get(resolved) || resolved);
    }
  }
  return [...seen].map(url => '.' + url.slice(base.origin.length));
}

async function preloadModules(root, homePath) {
  const html = await readFile(homePath, 'utf8');
  const importMapEnd = html.indexOf('</script>', html.indexOf('<script type="importmap">'));
  if (!html.includes('<script type="importmap">') || importMapEnd < 0) return;
  const links = (await moduleGraph(root, html)).map(href => `  <link rel="modulepreload" href="${href}" />`).join('\n');
  if (!links) return;
  const at = importMapEnd + '</script>'.length;
  await writeFile(homePath, `${html.slice(0, at)}\n${links}${html.slice(at)}`);
}

export async function buildSite(root = repoRoot, { cspMode = 'enforce' } = {}) {
  root = await realpath(root);
  validateManifest(publicFiles);
  for (const file of publicFiles) await assertRegularFile(root, file);

  const output = path.resolve(root, 'dist');
  if (path.dirname(output) !== root) throw new Error('Unsafe output directory');
  const existing = await lstat(output).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (existing?.isSymbolicLink()) throw new Error('Output directory must not be a symlink');
  const styles = await bundleStyles(root);
  await rm(output, { recursive: true, force: true });

  for (const file of publicFiles) {
    const destination = path.join(output, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(root, file), destination);
  }
  const homePath = path.join(output, 'index.html');
  const home = await readFile(homePath, 'utf8');
  await writeFile(homePath, home
    .replace('<!-- work-index-content -->', renderWorkIndex())
    .replace('<!-- selected-project-links -->', renderProjectLinks()));
  await writeFile(path.join(output, 'styles/main.css'), styles);
  await minifyScripts(output);
  // Tokens come from the bytes served, so they are set after minifying and bundling.
  await versionAssets(output);
  await preloadModules(root, homePath);
  const htmlPages = [];
  for (const file of publicFiles.filter(file => file.endsWith('.html'))) {
    htmlPages.push(await readFile(path.join(output, file), 'utf8'));
  }
  const headersPath = path.join(output, '_headers');
  await writeFile(headersPath, appendContentSecurity(await readFile(headersPath, 'utf8'), htmlPages, cspMode));
  const files = await verifyPublicSite(output);
  console.log(`Built ${files.length} public files in dist`);
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildSite();
}
