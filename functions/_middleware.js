import publicFiles from '../scripts/public-files.json' with { type: 'json' };

const publicPaths = new Set(publicFiles.filter(file => !file.startsWith('_')).map(file => `/${file}`));

export async function onRequest(context) {
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
