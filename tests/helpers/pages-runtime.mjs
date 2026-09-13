import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare, Response as EdgeResponse, convertV4MiniflareOptions } from 'miniflare';
import { unstable_generateASSETSBinding } from 'wrangler';

const root = fileURLToPath(new URL('../../', import.meta.url));

export async function createPagesRuntime({ directory = path.join(root, 'dist'), outbound, bindings = {} } = {}) {
  const temporary = await mkdtemp(path.join(tmpdir(), 'portfolio-pages-'));
  const output = path.join(temporary, 'bundle');
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/CLOUDFLARE|UPSTASH|RESEND|TURNSTILE|CONTACT_|TOKEN|SECRET|API_KEY/i.test(key)));
  environment.WRANGLER_SEND_METRICS = 'false';
  execFileSync(process.execPath, [
    path.join(root, 'node_modules/wrangler/bin/wrangler.js'), 'pages', 'functions', 'build',
    path.join(root, 'functions'), '--outdir', output, '--compatibility-date', '2026-09-13',
    '--compatibility-flags', 'nodejs_compat'
  ], { cwd: temporary, env: environment, stdio: 'pipe', timeout: 60000 });
  const scripts = await readdir(output);
  const worker = scripts.find(file => file.endsWith('.js') || file.endsWith('.mjs'));
  if (!worker) throw new Error('Pages compiler did not produce a Worker');
  const controller = new AbortController();
  const log = { log() {}, debug() {}, info() {}, warn: console.warn, error: console.error };
  const assets = await unstable_generateASSETSBinding({ directory, log, signal: controller.signal });
  const unexpected = [];
  let runtime;
  try {
    runtime = new Miniflare(convertV4MiniflareOptions({
      modules: true,
      name: 'portfolio-integration',
      cf: false,
      script: await readFile(path.join(output, worker), 'utf8'),
      compatibilityDate: '2026-09-13',
      compatibilityFlags: ['nodejs_compat'],
      port: 0,
      host: '127.0.0.1',
      bindings,
      serviceBindings: { ASSETS: assets },
      outboundService: async request => {
        const response = await outbound?.(request);
        if (response) return response;
        unexpected.push(request.url);
        return new EdgeResponse('Unexpected outbound request blocked', { status: 502 });
      }
    }));
    const url = await runtime.ready;
    return {
      runtime, url: url.toString().replace(/\/$/, ''), unexpected, temporary,
      async close() { controller.abort(); await runtime.dispose(); }
    };
  } catch (error) {
    controller.abort();
    await runtime?.dispose();
    throw error;
  }
}
