import publicFiles from '../scripts/public-files.json' with { type: 'json' };

const publicPaths = new Set(publicFiles.filter(file => !file.startsWith('_')).map(file => `/${file}`));

async function route(context) {
  const url = new URL(context.request.url);
  if (url.hostname === 'www.zounarakis.com') {
    url.hostname = 'zounarakis.com';
    url.protocol = 'https:';
    url.port = '';
    const status = ['GET', 'HEAD'].includes(context.request.method) ? 301 : 308;
    return Response.redirect(url.toString(), status);
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Response('Invalid URL', { status: 400 });
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

export async function onRequest(context) {
  const response = await route(context);
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
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
