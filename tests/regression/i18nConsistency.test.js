import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const i18nDir = path.join(repoRoot, 'src', 'i18n');
const publicDir = path.join(repoRoot, 'public');
const jsPaths = [
  path.join(repoRoot, 'src', 'app.js'),
  path.join(repoRoot, 'src', 'staticPage.js'),
  path.join(repoRoot, 'src', 'utils.js'),
  path.join(repoRoot, 'src', 'i18n.js'),
];
const baseLocale = 'en-US';

function readLocale(locale) {
  const filePath = path.join(i18nDir, `${locale}.json`);
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function getLocaleNames() {
  return readdirSync(i18nDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''))
    .sort();
}

function getHtmlI18nKeys() {
  const keys = new Set();
  const htmlPaths = readdirSync(publicDir)
    .filter((name) => name.endsWith('.html'))
    .map((name) => path.join(publicDir, name));

  for (const htmlPath of htmlPaths) {
    const html = readFileSync(htmlPath, 'utf8');
    for (const match of html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) {
      keys.add(match[1]);
    }
    for (const match of html.matchAll(/data-i18n-title-key="([^"]+)"/g)) {
      keys.add(match[1]);
    }
  }

  return [...keys].sort();
}

function getJsI18nKeys() {
  const keys = new Set();
  const regex = /i18n\.t\('([^']+)'\)/g;

  for (const jsPath of jsPaths) {
    const source = readFileSync(jsPath, 'utf8');
    for (const match of source.matchAll(regex)) {
      keys.add(match[1]);
    }
  }

  return [...keys].sort();
}

test('all locale files should have exactly the same keys as en-US', () => {
  const locales = getLocaleNames();
  const baseKeys = Object.keys(readLocale(baseLocale)).sort();

  for (const locale of locales) {
    const localeKeys = Object.keys(readLocale(locale)).sort();
    assert.deepEqual(
      localeKeys,
      baseKeys,
      `${locale} keys mismatch with ${baseLocale}`
    );
  }
});

test('all i18n keys used in public html pages should exist in every locale', () => {
  const locales = getLocaleNames();
  const htmlKeys = getHtmlI18nKeys();

  for (const locale of locales) {
    const dict = readLocale(locale);
    const missing = htmlKeys.filter((key) => !(key in dict));
    assert.equal(missing.length, 0, `${locale} is missing html keys: ${missing.join(', ')}`);
  }
});

test('all i18n.t(...) keys used in JavaScript should exist in every locale', () => {
  const locales = getLocaleNames();
  const jsKeys = getJsI18nKeys();

  for (const locale of locales) {
    const dict = readLocale(locale);
    const missing = jsKeys.filter((key) => !(key in dict));
    assert.equal(missing.length, 0, `${locale} is missing js keys: ${missing.join(', ')}`);
  }
});
