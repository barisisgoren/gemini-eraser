import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const publicDir = path.join(repoRoot, 'public');
const runtimeSourceDir = path.join(repoRoot, 'src');

function getPublicHtmlPaths() {
  return readdirSync(publicDir)
    .filter((name) => name.endsWith('.html'))
    .map((name) => path.join(publicDir, name));
}

function collectRuntimeJsFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === 'userscript') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectRuntimeJsFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

test('public html pages should not auto-load remote scripts or styles', () => {
  const scriptSrcPattern = /<script[^>]+src=["']https?:\/\//i;
  const stylesheetHrefPattern = /<link[^>]+rel=["']stylesheet["'][^>]+href=["']https?:\/\//i;
  const remoteImportPattern = /@import\s+(?:url\()?["']?https?:\/\//i;

  for (const htmlPath of getPublicHtmlPaths()) {
    const source = readFileSync(htmlPath, 'utf8');
    assert.doesNotMatch(source, scriptSrcPattern, `${path.basename(htmlPath)} should not load remote scripts`);
    assert.doesNotMatch(source, stylesheetHrefPattern, `${path.basename(htmlPath)} should not load remote stylesheets`);
    assert.doesNotMatch(source, remoteImportPattern, `${path.basename(htmlPath)} should not use remote CSS imports`);
  }
});

test('runtime javascript should not hardcode remote fetch or worker asset urls', () => {
  const remoteFetchPattern = /fetch\(\s*['"`]https?:\/\//;
  const remoteWorkerPattern = /new\s+(?:Worker|WorkerClass)\(\s*['"`]https?:\/\//;

  for (const jsPath of collectRuntimeJsFiles(runtimeSourceDir)) {
    const source = readFileSync(jsPath, 'utf8');
    assert.doesNotMatch(source, remoteFetchPattern, `${path.relative(repoRoot, jsPath)} should not fetch remote runtime assets`);
    assert.doesNotMatch(source, remoteWorkerPattern, `${path.relative(repoRoot, jsPath)} should not load remote workers`);
  }
});
