#!/usr/bin/env node
// check-color-tokens.mjs — enforce the "semantic tokens, never hex" colour policy.
//
// Policy (docs/architecture.md §8.4): every colour in the client is a semantic
// CSS custom property defined ONCE in src/styles/_tokens.scss (with a matching
// [data-theme="dark"] override). Hard-coding a hex/rgb()/hsl()/named colour in a
// component's SCSS or inline `styles:[]` template cannot follow the dark-mode
// override, which is the recurring cause of dark-mode contrast regressions.
//
// This guard scans every component stylesheet/template and fails if it finds a
// raw colour literal outside _tokens.scss. It is deliberately conservative:
// comments are stripped first so issue references like `#962` are never mistaken
// for a 3-digit hex, and named colours are only flagged in colour-property value
// position (so the word "white" in prose or a luminance mask never trips it).
//
// Run: `npm run check-color-tokens` (also wired into `just verify`).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

// The single sanctioned home for raw colour literals.
const TOKENS_FILE = join(SRC, 'styles', '_tokens.scss');

// Colour properties whose value, if a bare named colour, is a violation. Anchored
// so we only flag `color: white`, not the word "white" inside a comment or string.
const COLOUR_PROPS =
  'color|background|background-color|border|border-[a-z]+|outline|outline-color|' +
  'fill|stroke|stop-color|box-shadow|text-shadow|caret-color|accent-color|' +
  'column-rule|text-decoration-color';
const NAMED =
  'white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|brown|cyan|' +
  'magenta|gold|silver|navy|teal|lime|maroon|olive|aqua|fuchsia|indigo|violet|coral|salmon';

// Detection patterns (applied AFTER comments are stripped).
const PATTERNS = [
  // Hex: exactly 3/4/6/8 hex digits, not part of a longer hex run.
  { name: 'hex literal', re: /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/ },
  { name: 'rgb()/rgba()', re: /\brgba?\(/i },
  { name: 'hsl()/hsla()', re: /\bhsla?\(/i },
  { name: 'named colour', re: new RegExp(`\\b(?:${COLOUR_PROPS})\\s*[:=]\\s*["']?\\b(?:${NAMED})\\b`, 'i') },
];

/** Strip comments so prose/issue-refs can't masquerade as colour literals. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // /* block */  (incl. inside styles:`...`)
    .replace(/<!--[\s\S]*?-->/g, ' ')    // <!-- html -->
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // // line  (lookbehind-free: keep char before, skip URLs' `://`)
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

const violations = [];
for (const file of walk(SRC)) {
  if (!/\.(scss|ts|html)$/.test(file)) continue;
  if (file.endsWith('.spec.ts')) continue;     // tests aren't shipped UI
  if (file === TOKENS_FILE) continue;          // the one sanctioned home

  const stripped = stripComments(readFileSync(file, 'utf8'));
  stripped.split('\n').forEach((line, i) => {
    for (const { name, re } of PATTERNS) {
      const m = line.match(re);
      if (m) violations.push({ file, line: i + 1, name, text: m[0].trim() });
    }
  });
}

if (violations.length) {
  console.error('✗ Hard-coded colour literals found outside _tokens.scss:\n');
  for (const v of violations) {
    console.error(`  ${relative(process.cwd(), v.file)}:${v.line}  [${v.name}]  ${v.text}`);
  }
  console.error(
    '\n  Colours must be semantic tokens (docs/architecture.md §8.4): add/define the' +
    '\n  colour in src/styles/_tokens.scss (with its [data-theme="dark"] value) and' +
    '\n  reference it via var(--color-…). For a translucent tint of a token, use' +
    '\n  color-mix(in srgb, var(--token) N%, transparent). A hard-coded colour cannot' +
    '\n  follow the dark-mode override — that is the usual dark-mode contrast bug.',
  );
  process.exit(1);
}

console.log('✓ No hard-coded colour literals outside _tokens.scss');
