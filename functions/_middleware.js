import publicFiles from '../scripts/public-files.json' with { type: 'json' };

const publicPaths = new Set(publicFiles.filter(file => !file.startsWith('_')).map(file => `/${file}`));

const redirect = (context, url) =>
  Response.redirect(url.toString(), ['GET', 'HEAD'].includes(context.request.method) ? 301 : 308);

async function route(context) {
  const url = new URL(context.request.url);
  if (url.hostname === 'www.zounarakis.com') {
    url.hostname = 'zounarakis.com';
    url.protocol = 'https:';
    url.port = '';
    return redirect(context, url);
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Response('Invalid URL', { status: 400 });
  }

  // The blog lives in the app at #blog. Its articles have one address, without a trailing slash.
  if (pathname === '/blog' || pathname === '/blog/') {
    url.pathname = '/';
    url.hash = 'blog';
    return redirect(context, url);
  }
  if (url.pathname.length > 1 && url.pathname.endsWith('/') && publicPaths.has(`${pathname.slice(0, -1)}.html`)) {
    url.pathname = url.pathname.slice(0, -1);
    return redirect(context, url);
  }

  // A versioned asset is always fetched whole, so its token can be checked against the bytes. A 304
  // would carry the zone's four-hour TTL onto whatever bytes the browser already holds.
  if (context.request.method === 'GET' && /^[a-f0-9]{12}$/.test(url.searchParams.get('v') || '') &&
      !pathname.endsWith('.html') && publicPaths.has(pathname)) {
    const headers = new Headers(context.request.headers);
    for (const name of ['If-None-Match', 'If-Modified-Since', 'If-Match', 'If-Unmodified-Since', 'If-Range', 'Range']) headers.delete(name);
    return context.next(new Request(context.request, { headers }));
  }

  if (pathname === '/api/contact' || publicPaths.has(pathname) ||
      publicPaths.has(`${pathname}.html`) ||
      (pathname.endsWith('/') && publicPaths.has(`${pathname}index.html`))) {
    return context.next();
  }

  // Block stale cached files and accidental uploads of the repository root.
  const page = await context.env.ASSETS.fetch(new URL('/404.html', url));
  const headers = new Headers(page.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(context.request.method === 'HEAD' ? null : page.body, { status: 404, headers });
}

const IMMUTABLE = 'public, max-age=31536000, immutable';
const HASH_LIMIT = 4 * 1024 * 1024;

// A ?v= token is current when it is the start of the SHA-256 of the bytes served, the token the build
// writes (scripts/build-site.mjs). Only then may the response be cached as immutable: a tab open across
// a deploy can still ask for an old token, and the new bytes must not be pinned under it. Any other
// token, and a module or stylesheet asked for without one, gets an explicit no-cache, because the
// zone's browser cache TTL otherwise turns the default max-age=0 into four hours.
async function immutableIfCurrent(request, response) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || ![200, 304].includes(response.status) || url.pathname.endsWith('.html') ||
      !publicPaths.has(decodeURIComponent(url.pathname))) {
    return response;
  }
  const v = url.searchParams.get('v');
  const headers = new Headers(response.headers);
  // Versioned requests never reach here as 304 (route() drops their conditional headers).
  if (response.status === 304) {
    if (v === null && !/^\/(js|styles)\//.test(url.pathname)) return response;
    headers.set('Cache-Control', 'no-cache');
    return new Response(null, { status: 304, statusText: response.statusText, headers });
  }
  if (v === null) {
    if (!/^\/(js|styles)\//.test(url.pathname)) return response;
    headers.set('Cache-Control', 'no-cache');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  const size = Number(response.headers.get('Content-Length'));
  if (!/^[a-f0-9]{12}$/.test(v) || size > HASH_LIMIT) {
    headers.set('Cache-Control', 'no-cache');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  const bytes = await response.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const token = Array.from(digest.subarray(0, 6), byte => byte.toString(16).padStart(2, '0')).join('');
  headers.set('Cache-Control', token === v ? IMMUTABLE : 'no-cache');
  return new Response(bytes, { status: response.status, statusText: response.statusText, headers });
}

export async function onRequest(context) {
  const response = await immutableIfCurrent(context.request, await route(context));
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  if (new URL(context.request.url).protocol === 'https:') {
    headers.set('Strict-Transport-Security', 'max-age=31536000');
  }
  if (headers.get('Content-Type')?.includes('application/json')) {
    headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  }
  if (response.status === 200 && headers.get('Content-Type')?.includes('text/html')) {
    headers.set('Cache-Control', 'no-cache');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
