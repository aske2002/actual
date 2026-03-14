/**
 * Nightly theme validation script.
 *
 * Reads the theme catalog from packages/desktop-client/src/data/customThemeCatalog.json,
 * fetches each theme's CSS from its GitHub repo, and validates it against the same
 * rules used at install time.
 *
 * Validation logic is ported from:
 *   packages/desktop-client/src/style/customThemes.ts
 * Keep these two files in sync when changing validation rules.
 *
 * Exit code 0 = all themes pass, 1 = one or more themes failed.
 * Writes a JSON results file to $GITHUB_OUTPUT (when running in CI) for
 * downstream steps.
 */

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = resolve(
  __dirname,
  '../../packages/desktop-client/src/data/customThemeCatalog.json',
);

// ---------------------------------------------------------------------------
// Validation logic (mirrored from customThemes.ts — keep in sync)
// ---------------------------------------------------------------------------

const VAR_ONLY_PATTERN = /^var\s*\(\s*(--[a-zA-Z0-9_-]+)\s*\)$/i;

function isValidSimpleVarValue(value) {
  const m = value.trim().match(VAR_ONLY_PATTERN);
  if (!m) return false;
  const name = m[1];
  return name !== '--' && !name.endsWith('-');
}

function validatePropertyValue(value, property) {
  if (!value || value.length === 0) return;

  const trimmedValue = value.trim();

  if (isValidSimpleVarValue(trimmedValue)) return;

  const hexColorPattern =
    /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?([0-9a-fA-F]{2})?$/;
  const rgbRgbaPattern =
    /^rgba?\(\s*\d+%?\s*,\s*\d+%?\s*,\s*\d+%?\s*(,\s*[\d.]+)?\s*\)$/;
  const hslHslaPattern =
    /^hsla?\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*(,\s*[\d.]+)?\s*\)$/;
  const lengthPattern =
    /^(\d+\.?\d*|\d*\.\d+)(px|em|rem|%|vh|vw|vmin|vmax|cm|mm|in|pt|pc|ex|ch)$/;
  const numberPattern = /^(\d+\.?\d*|\d*\.\d+)$/;
  const keywordPattern =
    /^(inherit|initial|unset|revert|transparent|none|auto|normal)$/i;

  if (
    hexColorPattern.test(trimmedValue) ||
    rgbRgbaPattern.test(trimmedValue) ||
    hslHslaPattern.test(trimmedValue) ||
    lengthPattern.test(trimmedValue) ||
    numberPattern.test(trimmedValue) ||
    keywordPattern.test(trimmedValue)
  ) {
    return;
  }

  throw new Error(
    `Invalid value "${trimmedValue}" for property "${property}". Only simple CSS values are allowed (colors, lengths, numbers, keywords, or var(--name)). Other functions, URLs, and complex constructs are not permitted.`,
  );
}

function validateThemeCss(css) {
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, '').trim();

  const rootMatch = cleaned.match(/^:root\s*\{/);
  if (!rootMatch) {
    throw new Error(
      'Theme CSS must contain exactly :root { ... } with CSS variable definitions. No other selectors or content allowed.',
    );
  }

  const rootStart = cleaned.indexOf(':root');
  const openBrace = cleaned.indexOf('{', rootStart);
  if (openBrace === -1) {
    throw new Error(
      'Theme CSS must contain exactly :root { ... } with CSS variable definitions. No other selectors or content allowed.',
    );
  }

  const closeBrace = cleaned.indexOf('}', openBrace + 1);
  if (closeBrace === -1) {
    throw new Error(
      'Theme CSS must contain exactly :root { ... } with CSS variable definitions. No other selectors or content allowed.',
    );
  }

  const rootContent = cleaned.substring(openBrace + 1, closeBrace).trim();

  if (/@[a-z-]+/i.test(rootContent)) {
    throw new Error(
      'Theme CSS contains forbidden at-rules (@import, @media, @keyframes, etc.). Only CSS variable declarations are allowed inside :root { ... }.',
    );
  }

  if (/\{/.test(rootContent)) {
    throw new Error(
      'Theme CSS contains nested blocks or additional selectors. Only CSS variable declarations are allowed inside :root { ... }.',
    );
  }

  const afterRoot = cleaned.substring(closeBrace + 1).trim();
  if (afterRoot.length > 0) {
    throw new Error(
      'Theme CSS must contain exactly :root { ... } with CSS variable definitions. No other selectors or content allowed.',
    );
  }

  const declarations = rootContent
    .split(';')
    .map(d => d.trim())
    .filter(d => d.length > 0);

  for (const decl of declarations) {
    const colonIndex = decl.indexOf(':');
    if (colonIndex === -1) {
      throw new Error(`Invalid CSS declaration: "${decl}"`);
    }

    const property = decl.substring(0, colonIndex).trim();

    if (!property.startsWith('--')) {
      throw new Error(
        `Invalid property "${property}". Only CSS custom properties (starting with --) are allowed.`,
      );
    }

    if (property === '--' || property === '-') {
      throw new Error(
        `Invalid property "${property}". Property name cannot be empty or contain only dashes.`,
      );
    }

    const propertyNameAfterDashes = property.substring(2);
    if (propertyNameAfterDashes.length === 0) {
      throw new Error(
        `Invalid property "${property}". Property name cannot be empty after "--".`,
      );
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(propertyNameAfterDashes)) {
      throw new Error(
        `Invalid property "${property}". Property name contains invalid characters. Only letters, digits, underscores, and dashes are allowed.`,
      );
    }

    if (property.endsWith('-')) {
      throw new Error(
        `Invalid property "${property}". Property name cannot end with a dash.`,
      );
    }

    const value = decl.substring(colonIndex + 1).trim();
    validatePropertyValue(value, property);
  }

  return css.trim();
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function fetchThemeCss(repo) {
  const url = `https://raw.githubusercontent.com/${repo}/refs/heads/main/actual.css`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return response.text();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf-8'));
  console.log(`Found ${catalog.length} themes in catalog.\n`);

  const results = [];
  let hasFailures = false;

  for (const theme of catalog) {
    const { name, repo } = theme;
    process.stdout.write(`Checking "${name}" (${repo}) ... `);

    try {
      const css = await fetchThemeCss(repo);
      validateThemeCss(css);
      console.log('PASS');
      results.push({ name, repo, status: 'pass' });
    } catch (err) {
      console.log(`FAIL — ${err.message}`);
      results.push({ name, repo, status: 'fail', error: err.message });
      hasFailures = true;
    }
  }

  // Write results as JSON for downstream CI steps
  const resultsJson = JSON.stringify(results);
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `results=${resultsJson}\n`);
  }

  // Also write to a temp file so the issue step can read it
  const tmpPath = resolve(__dirname, '../../theme-validation-results.json');
  writeFileSync(tmpPath, JSON.stringify(results, null, 2));

  console.log(
    `\n${hasFailures ? 'FAILED' : 'PASSED'}: ${results.filter(r => r.status === 'pass').length}/${results.length} themes passed validation.`,
  );

  if (hasFailures) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
