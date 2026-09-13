import { copyFile, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

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

export async function buildSite(root = repoRoot) {
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
  await writeFile(path.join(output, 'styles/main.css'), styles);
  const files = await verifyPublicSite(output);
  console.log(`Built ${files.length} public files in dist`);
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildSite();
}
