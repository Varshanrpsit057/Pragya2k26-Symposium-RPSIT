// Stops secrets and private data from reaching git or the public website.
//
//   npm run check:secrets          every file git would include, plus the built site (dist/)
//   node scripts/check-secrets.mjs --staged
//                                  only what is about to be committed (the pre-commit hook)
//
// Fails on files that must stay private (.env, the Google client JSON, private keys, personal
// photos) and on secret values inside any file (Google client secrets, refresh and access
// tokens, API keys, private keys, GitHub and AWS keys, the admin password hash). Matches are
// reported by file and line only: a secret is never printed.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const staged = process.argv.includes('--staged');

/** Paths that must never be committed, whatever is inside them. */
const PRIVATE_PATHS = [
  [/(^|\/)\.env(\.(?!example$)[^/]*)?$/, '.env file (secrets)'],
  [/(^|\/)google client\//, 'Google OAuth client folder'],
  [/(^|\/)client_secret[^/]*\.json$/, 'Google OAuth client secret'],
  [/(^|\/)service-account[^/]*\.json$/, 'Google service account key'],
  [/(^|\/)amplify_outputs[^/]*\.json$/, 'Amplify outputs (generated per deploy)'],
  [/\.(pem|key|p12|pfx)$/, 'private key'],
  [/(^|\/)dev_crew\//, 'full-size personal photos'],
];

/** Secret values, whichever file they are in. */
const SECRET_VALUES = [
  [/GOCSPX-[A-Za-z0-9_-]{20,}/, 'Google OAuth client secret'],
  [/\b1\/\/0[A-Za-z0-9_-]{30,}/, 'Google refresh token'],
  [/\bya29\.[A-Za-z0-9_-]{20,}/, 'Google access token'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'GitHub token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\baws_secret_access_key\s*=\s*\S+/i, 'AWS secret access key'],
  [/\bscrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]{16,}\$[A-Za-z0-9_-]{32,}/, 'admin password hash'],
  // A real value after a secret setting's name (placeholders such as your-... are fine).
  [/^\s*(GOOGLE_CLIENT_SECRET|GOOGLE_REFRESH_TOKEN|ADMIN_PASSWORD_HASH)\s*=\s*(?!your-|<|\s*$)\S+/m, 'secret setting with a value'],
];

const BINARY = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.ico', '.woff', '.woff2', '.pdf', '.zip']);
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean);

function filesToCheck() {
  const files = staged
    ? git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z')
    : git('ls-files', '-z', '--cached', '--others', '--exclude-standard');
  if (staged) return files;
  // The built site is public too: nothing secret may end up in it.
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [relative('.', path).replaceAll('\\', '/')];
    });
  return [...files, ...['dist', 'dist-ssr'].filter((dir) => existsSync(dir)).flatMap(walk)];
}

const problems = [];
for (const file of filesToCheck()) {
  for (const [pattern, what] of PRIVATE_PATHS) {
    if (pattern.test(file)) problems.push(`${file}: ${what} must not be committed`);
  }
  if (BINARY.has(extname(file).toLowerCase()) || !existsSync(file)) continue;
  const text = staged
    ? execFileSync('git', ['show', `:${file}`], { encoding: 'utf8', maxBuffer: MAX_TEXT_BYTES * 2 })
    : statSync(file).size <= MAX_TEXT_BYTES
      ? readFileSync(file, 'utf8')
      : '';
  if (text.includes('\0')) continue;
  const lines = text.split(/\r?\n/);
  for (const [pattern, what] of SECRET_VALUES) {
    const line = lines.findIndex((content) => pattern.test(content));
    if (line >= 0) problems.push(`${file}:${line + 1}: looks like a ${what}`);
  }
}

if (problems.length) {
  console.error(`\nSecret check FAILED (${problems.length}):`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error('\nRemove these from git (git rm --cached <file>). Secrets belong in Amplify secrets (or .env locally).');
  console.error('If a real secret was ever committed or pushed, rotate it: removing it is not enough.\n');
  process.exit(1);
}
console.log(`Secret check passed${staged ? ' (staged files)' : ''}: no secrets or private files.`);
