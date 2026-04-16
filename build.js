import * as esbuild from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import {
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { execSync } from 'node:child_process';
import { extname, join, normalize, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');

const args = new Set(process.argv.slice(2));
const isProd = process.env.NODE_ENV === 'production' || args.has('--prod');
const serveDistOnly = args.has('--serve-dist');
const distDir = resolve('dist');
const tailwindConfigPath = resolve('tailwind.config.cjs');
const stylesEntry = resolve('src/styles/app.css');
const publicDir = resolve('public');
const localeDir = resolve('src/i18n');
const interFontDir = resolve('node_modules/@fontsource-variable/inter/files');
const interFontFiles = [
  'inter-latin-ext-wght-normal.woff2',
  'inter-latin-wght-normal.woff2',
];

let commitHash = null;
function getCommitHash() {
  if (commitHash) return commitHash;
  try {
    commitHash = execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch {
    commitHash = 'unknown';
  }
  return commitHash;
}

const jsBanner = `/*!
 * ${pkg.name} v${pkg.version}+${getCommitHash()}
 * ${pkg.description}
 * (c) ${new Date().getFullYear()} ${pkg.author}
 * ${pkg.repository.url?.replace(/\.git$/, '')}
 * Released under the ${pkg.license} License.
 */`;

const userscriptBanner = `// ==UserScript==
// @name         Gemini-Eraser
// @namespace    https://github.com/barisisgoren
// @version      0.1.8
// @description  Automatically removes watermarks using Gemini-Eraser
// @icon         https://www.google.com/s2/favicons?domain=gemini.google.com
// @author       Baris Isgoren
// @license      MIT
// @match        https://gemini.google.com/*
// @match        https://business.gemini.google/*
// @connect      googleusercontent.com
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-end
// ==/UserScript==
`;

const commonConfig = {
  bundle: true,
  loader: { '.png': 'dataurl' },
  logLevel: 'info',
  minify: isProd,
};

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function ensureDistDirs() {
  mkdirSync(resolve(distDir, 'userscript'), { recursive: true });
  mkdirSync(resolve(distDir, 'workers'), { recursive: true });
  mkdirSync(resolve(distDir, 'assets/fonts/inter'), { recursive: true });
}

function copyInterFonts() {
  const targetDir = resolve(distDir, 'assets/fonts/inter');
  mkdirSync(targetDir, { recursive: true });
  for (const fileName of interFontFiles) {
    cpSync(resolve(interFontDir, fileName), resolve(targetDir, fileName), { force: true });
  }
}

function copyDirectoryEntries(sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: true });
  const entries = readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = resolve(sourceDir, entry.name);
    const targetPath = resolve(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryEntries(sourcePath, targetPath);
      continue;
    }
    cpSync(sourcePath, targetPath, { force: true });
  }
}

function syncLocales() {
  const targetDir = resolve(distDir, 'i18n');
  rmSync(targetDir, { recursive: true, force: true });
  copyDirectoryEntries(localeDir, targetDir);
}

function syncPublicFiles() {
  copyDirectoryEntries(publicDir, distDir);
}

function syncStaticAssets() {
  syncLocales();
  syncPublicFiles();
  copyInterFonts();
}

async function buildStyles() {
  const cssSource = readFileSync(stylesEntry, 'utf8');
  const result = await postcss([
    tailwindcss({ config: tailwindConfigPath }),
    autoprefixer(),
  ]).process(cssSource, {
    from: stylesEntry,
    to: resolve(distDir, 'app.css'),
  });

  writeFileSync(resolve(distDir, 'app.css'), result.css, 'utf8');
}

async function buildStaticAssets() {
  syncStaticAssets();
  await buildStyles();
}

const findAvailablePort = (startPort, maxAttempts = 20) => new Promise((resolvePort, reject) => {
  const tryPort = (port, remaining) => {
    const probe = createNetServer();
    probe.once('error', (err) => {
      probe.close();
      if (err.code === 'EADDRINUSE' && remaining > 0) {
        tryPort(port + 1, remaining - 1);
        return;
      }
      reject(err);
    });
    probe.once('listening', () => {
      probe.close(() => resolvePort(port));
    });
    probe.listen(port);
  };
  tryPort(startPort, maxAttempts);
});

async function serveStaticDist(rootDir = distDir, defaultPort = 4173) {
  const distRoot = resolve(rootDir);
  const startPort = Number(process.env.PORT || defaultPort);
  const port = await findAvailablePort(startPort);

  const server = createServer((req, res) => {
    let urlPath = '/';
    try {
      urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Request');
      return;
    }

    const requestPath = urlPath === '/' ? '/index.html' : urlPath;
    const fsPath = resolve(join(distRoot, normalize(requestPath)));

    if (!fsPath.startsWith(distRoot)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    const requestedExt = extname(requestPath).toLowerCase();
    const isRouteRequest = requestedExt === '';
    let targetPath = fsPath;
    const targetExists = existsSync(targetPath);
    const targetIsDir = targetExists && statSync(targetPath).isDirectory();

    if ((!targetExists || targetIsDir) && isRouteRequest) {
      targetPath = resolve(join(distRoot, 'index.html'));
    }

    if (!existsSync(targetPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const ext = extname(targetPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    createReadStream(targetPath).pipe(res);
  });

  server.listen(port, () => {
    console.log(`Local server running at http://localhost:${port}`);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function watchWithDebounce(targetPath, onChange, recursive = true) {
  let debounceTimer = null;
  watch(targetPath, { recursive }, (_eventType, filename) => {
    if (!filename && recursive) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try {
        await onChange(filename);
      } catch (error) {
        console.error(`Watch task failed for ${targetPath}:`, error);
      }
    }, 120);
  });
}

if (serveDistOnly) {
  if (!existsSync(distDir)) {
    console.error('dist directory is missing. Run `npm run build` first.');
    process.exit(1);
  }
  await serveStaticDist(distDir);
  console.log('Serving existing dist directory.');
  process.stdin.resume();
  process.exitCode = 0;
} else {
  console.log(`Starting build process... [${isProd ? 'PRODUCTION' : 'DEVELOPMENT'}]`);

  if (existsSync(distDir)) rmSync(distDir, { recursive: true });
  ensureDistDirs();

  const websiteCtx = await esbuild.context({
    ...commonConfig,
    entryPoints: ['src/app.js', 'src/staticPage.js'],
    outdir: 'dist',
    entryNames: '[name]',
    platform: 'browser',
    target: ['es2020'],
    banner: { js: jsBanner },
    sourcemap: !isProd,
  });

  const workerCtx = await esbuild.context({
    ...commonConfig,
    entryPoints: ['src/workers/watermarkWorker.js'],
    outfile: 'dist/workers/watermark-worker.js',
    platform: 'browser',
    format: 'esm',
    target: ['es2020'],
    sourcemap: !isProd,
  });

  const userscriptWorkerBuild = await esbuild.build({
    ...commonConfig,
    entryPoints: ['src/workers/watermarkWorker.js'],
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    write: false,
    sourcemap: false,
  });
  const userscriptWorkerCode = userscriptWorkerBuild.outputFiles?.[0]?.text || '';

  const userscriptCtx = await esbuild.context({
    ...commonConfig,
    entryPoints: ['src/userscript/index.js'],
    format: 'iife',
    outfile: 'dist/userscript/gemini-watermark-remover.user.js',
    banner: { js: userscriptBanner },
    minify: false,
    define: {
      __US_WORKER_CODE__: JSON.stringify(userscriptWorkerCode),
      __US_INLINE_WORKER_ENABLED__: 'false',
    },
  });

  if (isProd) {
    await Promise.all([websiteCtx.rebuild(), workerCtx.rebuild(), userscriptCtx.rebuild()]);
    await buildStaticAssets();
    console.log('Build complete.');
    process.exit(0);
  } else {
    await Promise.all([websiteCtx.watch(), workerCtx.watch(), userscriptCtx.watch()]);
    await buildStaticAssets();

    watchWithDebounce('src/i18n', async () => {
      syncLocales();
    });
    watchWithDebounce('public', async () => {
      await buildStaticAssets();
    });
    watchWithDebounce('src/styles', async () => {
      await buildStyles();
    });
    watchWithDebounce('src', async (filename) => {
      const relativePath = String(filename || '').replace(/\\/g, '/');
      if (!relativePath.endsWith('.js')) return;
      if (
        relativePath.startsWith('i18n/') ||
        relativePath.startsWith('styles/') ||
        relativePath.startsWith('userscript/')
      ) {
        return;
      }
      await buildStyles();
    });
    watchWithDebounce('tailwind.config.cjs', async () => {
      await buildStyles();
    }, false);

    await serveStaticDist(distDir);
    console.log('Watching for changes...');
  }
}
