// Connects the registration system to your Google account (Sheets, Drive and Gmail).
//
//   npm run google:auth     sign in once; saves the refresh token to .env, then checks access
//   npm run google:auth -- --no-check
//                           sign in and save only: nothing is read from or sent to Sheets, Drive or Gmail
//   npm run google:check    checks the saved token can reach the Sheet and the Drive folder
//   npm run google:check -- --send-test-email
//                           also sends one test email to the signed-in Gmail address
//
// Reads the OAuth client from the newest OAuth client JSON in "google client/" (copied into
// .env) or else from .env (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). When GMAIL_SENDER is set
// in .env, Google is asked for that account, and a sign-in with any other account is refused
// without saving anything. Secrets are written to .env only; they are never printed.
//
// A service-account key (a JSON with a private key) cannot be used: a gmail.com account
// cannot send email or keep Drive files through a service account. It is skipped.
//
// The OAuth client must list this redirect URI (Google Cloud Console → APIs & Services →
// Credentials → your OAuth client → Authorized redirect URIs):
//   http://localhost:3000/oauth2callback
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const ENV_FILE = '.env';
const CLIENT_DIR = 'google client';
const PORT = 3000;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SIGN_IN_TIMEOUT_MS = 10 * 60_000;

const SCOPES = {
  sheets: 'https://www.googleapis.com/auth/spreadsheets',
  drive: 'https://www.googleapis.com/auth/drive',
  gmail: 'https://www.googleapis.com/auth/gmail.send',
};
// openid + email only reveal which account signed in, so emails can be sent "from" it.
const REQUESTED_SCOPES = ['openid', 'email', ...Object.values(SCOPES)];

const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
const sendTestEmail = args.has('--send-test-email');
const skipCheck = args.has('--no-check');

const ok = (message) => console.log(`  ✓ ${message}`);
const bad = (message) => console.log(`  ✗ ${message}`);

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------------------
// .env

function readEnv() {
  if (!existsSync(ENV_FILE)) return {};
  return Object.fromEntries(
    readFileSync(ENV_FILE, 'utf8')
      .split(/\r?\n/)
      .filter((line) => /^\s*[A-Za-z0-9_]+\s*=/.test(line))
      .map((line) => {
        const at = line.indexOf('=');
        return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, '$2')];
      }),
  );
}

/** Sets KEY=value lines in .env, keeping every other line and the file's line endings. */
function writeEnv(values) {
  const original = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '';
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original ? original.split(/\r?\n/) : [];
  for (const [key, value] of Object.entries(values)) {
    const index = lines.findIndex((line) => new RegExp(`^\\s*${key}\\s*=`).test(line));
    if (index >= 0) lines[index] = `${key}=${value}`;
    else {
      if (lines.length && lines.at(-1) === '') lines.pop();
      lines.push(`${key}=${value}`, '');
    }
  }
  writeFileSync(ENV_FILE, lines.join(newline));
}

/**
 * The OAuth client: the newest client JSON in "google client/" (as downloaded from Google
 * Cloud Console), copied into .env so the server uses the same one; otherwise .env alone.
 */
function oauthClient(env) {
  const files = existsSync(CLIENT_DIR)
    ? readdirSync(CLIENT_DIR)
        .filter((name) => name.endsWith('.json'))
        .map((name) => join(CLIENT_DIR, name))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    : [];
  for (const file of files) {
    let json;
    try {
      json = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    if (json.type === 'service_account') {
      console.log(
        `Skipping ${file}: it is a service-account key (it holds a private key). It is not used, ` +
          'because a gmail.com account cannot send email or keep Drive files through one. Keep it out of ' +
          'this project, and delete the key in Google Cloud Console if nothing else needs it.',
      );
      continue;
    }
    const client = json.web ?? json.installed;
    if (client?.client_id && client.client_secret) {
      if (env.GOOGLE_CLIENT_ID !== client.client_id || env.GOOGLE_CLIENT_SECRET !== client.client_secret) {
        writeEnv({ GOOGLE_CLIENT_ID: client.client_id, GOOGLE_CLIENT_SECRET: client.client_secret });
        console.log(`Copied the OAuth client from ${file} into .env.`);
      }
      return { clientId: client.client_id, clientSecret: client.client_secret };
    }
  }
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
  }
  fail(
    `No OAuth client found: create an OAuth client ID (type "Web application", redirect URI ${REDIRECT_URI}) in ` +
      `Google Cloud Console, download its JSON into "${CLIENT_DIR}/", or set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.`,
  );
}

// ---------------------------------------------------------------------------------------
// Google

async function tokenRequest(params) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = body.error_description || body.error || response.statusText;
    throw new Error(`Google refused the token request: ${reason}`);
  }
  return body;
}

async function google(accessToken, url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...init.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.error?.message || response.statusText;
    const disabled = body.error?.details?.find?.((detail) => detail.reason === 'SERVICE_DISABLED');
    const error = new Error(message);
    error.status = response.status;
    error.activationUrl = disabled?.metadata?.activationUrl;
    throw error;
  }
  return body;
}

function explain(error) {
  if (error.activationUrl) return `${error.message}\n      Enable it here, wait a minute, then run npm run google:check:\n      ${error.activationUrl}`;
  if (error.status === 404) return `${error.message} (check the ID in .env, and that the signed-in account can open it)`;
  return error.message;
}

/** Reads the email address from the id_token Google returned (no network call needed). */
function emailFromIdToken(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
    return payload.email_verified === false ? null : payload.email ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------
// Sign-in

function openBrowser(url) {
  const [command, commandArgs] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
  try {
    spawn(command, commandArgs, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // The link is printed too.
  }
}

async function signIn({ clientId, clientSecret }, account) {
  const state = randomBytes(16).toString('hex');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: REQUESTED_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    // Opens the sign-in on the intended account (GMAIL_SENDER).
    ...(account ? { login_hint: account } : {}),
  }).toString();

  const code = await new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', REDIRECT_URI);
      if (url.pathname !== '/oauth2callback') {
        response.writeHead(404).end();
        return;
      }
      const finish = (status, title, text, outcome) => {
        response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(
          `<!doctype html><meta charset="utf-8"><title>PRAGYA 2026</title>` +
            `<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">` +
            `<h1>${title}</h1><p>${text}</p></body>`,
        );
        clearTimeout(timer);
        server.close();
        outcome();
      };
      if (url.searchParams.get('state') !== state) {
        response.writeHead(400).end('This sign-in link is out of date. Run npm run google:auth again.');
        return;
      }
      const error = url.searchParams.get('error');
      if (error) {
        finish(400, 'Sign-in cancelled', 'Google access was not granted. You can close this tab.', () =>
          reject(new Error(`Google sign-in was not completed (${error}).`)),
        );
        return;
      }
      const received = url.searchParams.get('code');
      finish(200, 'Connected', 'PRAGYA 2026 can now use your Google Sheet, Drive and Gmail. You can close this tab.', () =>
        resolve(received),
      );
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Timed out waiting for the Google sign-in.'));
    }, SIGN_IN_TIMEOUT_MS);
    server.on('error', (error) =>
      reject(error.code === 'EADDRINUSE' ? new Error(`Port ${PORT} is busy; close whatever uses it and try again.`) : error),
    );
    server.listen(PORT, '127.0.0.1', () => {
      console.log(
        account
          ? `\nSign in as ${account} (GMAIL_SENDER in .env).`
          : '\nSign in with the Google account that owns the registration Sheet and Drive folder.',
      );
      console.log('Your browser should open; if it does not, open this link:\n');
      console.log(`  ${authUrl}\n`);
      console.log('Waiting for the sign-in (up to 10 minutes)...');
      openBrowser(authUrl.toString());
    });
  });

  const tokens = await tokenRequest({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });
  if (!tokens.refresh_token) {
    fail(
      'Google did not return a refresh token. Remove this app\'s access at https://myaccount.google.com/permissions ' +
        'and run npm run google:auth again.',
    );
  }

  const granted = new Set((tokens.scope ?? '').split(' '));
  const missing = Object.entries(SCOPES).filter(([, scope]) => !granted.has(scope));
  const email = tokens.id_token ? emailFromIdToken(tokens.id_token) : null;
  if (account && email?.toLowerCase() !== account.toLowerCase()) {
    fail(
      `You signed in as ${email ?? 'an unknown account'}, but .env expects ${account} (GMAIL_SENDER). Nothing was saved. ` +
        `Run npm run google:auth again and choose ${account}, or change GMAIL_SENDER in .env first.`,
    );
  }

  writeEnv({ GOOGLE_REFRESH_TOKEN: tokens.refresh_token, ...(email ? { GMAIL_SENDER: email } : {}) });
  console.log(`\nSaved the refresh token to .env${email ? ` (signed in as ${email})` : ''}.`);

  if (missing.length) {
    fail(
      `Access to ${missing.map(([name]) => name).join(' and ')} was not granted (a box was left unticked on ` +
        'the consent screen). Run npm run google:auth again and tick every box.',
    );
  }
  return tokens.access_token;
}

// ---------------------------------------------------------------------------------------
// Checks

/** The Sheet and the payment folder in .env: reachable and writable by this account. */
async function checkStorage(accessToken, env) {
  let passed = true;
  try {
    const sheet = await google(
      accessToken,
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SHEET_ID)}?fields=properties.title,sheets.properties.title`,
    );
    const tabs = sheet.sheets.map((tab) => tab.properties.title);
    const tab = env.GOOGLE_SHEET_TAB || 'Registrations';
    ok(
      `Google Sheet "${sheet.properties.title}" (tabs: ${tabs.join(', ')})` +
        (tabs.includes(tab) ? '' : ` - the "${tab}" tab will be created on the first registration`),
    );
  } catch (error) {
    passed = false;
    bad(`Google Sheet: ${explain(error)}`);
  }

  try {
    const folder = await google(
      accessToken,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(env.GOOGLE_DRIVE_PAYMENT_FOLDER_ID)}` +
        '?fields=name,mimeType,trashed,capabilities/canAddChildren&supportsAllDrives=true',
    );
    if (folder.mimeType !== 'application/vnd.google-apps.folder') throw new Error(`"${folder.name}" is not a folder`);
    if (folder.trashed) throw new Error(`"${folder.name}" is in the trash`);
    if (!folder.capabilities?.canAddChildren) throw new Error(`this account cannot add files to "${folder.name}"`);
    ok(`Google Drive folder "${folder.name}" (screenshots and passes are saved here)`);
  } catch (error) {
    passed = false;
    bad(`Google Drive folder: ${explain(error)}`);
  }
  return passed;
}

async function check(accessToken, env, signedInAs) {
  console.log('\nChecking access:');
  let passed = true;

  // A new account has no Sheet or folder yet: npm run google:setup makes them.
  if (!env.GOOGLE_SHEET_ID || !env.GOOGLE_DRIVE_PAYMENT_FOLDER_ID) {
    console.log('  • No Sheet or Drive folder in .env yet: run npm run google:setup to create them, then npm run google:check');
  } else {
    passed = await checkStorage(accessToken, env);
  }

  const sender = signedInAs || env.GMAIL_SENDER;
  if (sendTestEmail) {
    try {
      if (!sender) throw new Error('GMAIL_SENDER is not set in .env; run npm run google:auth');
      const message = [
        `From: PRAGYA 2026 <${sender}>`,
        `To: ${sender}`,
        'Subject: PRAGYA 2026 - Gmail connection test',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        '',
        'This test confirms the PRAGYA 2026 registration system can send confirmation emails.',
      ].join('\r\n');
      await google(accessToken, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: Buffer.from(message).toString('base64url') }),
      });
      ok(`Gmail: sent a test email to ${sender}`);
    } catch (error) {
      passed = false;
      bad(`Gmail: ${explain(error)}`);
    }
  } else {
    ok(`Gmail: permission granted${sender ? ` (sends as ${sender})` : ''}; add --send-test-email to send a test`);
  }

  console.log(
    passed
      ? '\nAll set. The local server reads these settings from .env; copy them to the Amplify secrets and variables (README, section 9).\n'
      : '\nFix the items marked ✗, then run npm run google:check.\n',
  );
  if (!passed) process.exitCode = 1;
}

// ---------------------------------------------------------------------------------------

const env = readEnv();
const client = oauthClient(env);
const account = env.GMAIL_SENDER?.trim() || null;

try {
  if (checkOnly) {
    if (!env.GOOGLE_REFRESH_TOKEN) fail('No GOOGLE_REFRESH_TOKEN in .env yet: run npm run google:auth first.');
    const { access_token: accessToken } = await tokenRequest({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }).catch((error) => {
      throw new Error(`${error.message}\nThe saved sign-in no longer works: run npm run google:auth again.`);
    });
    await check(accessToken, env, null);
  } else {
    const accessToken = await signIn(client, account);
    if (skipCheck) console.log('Skipped the access check (--no-check). Run npm run google:check whenever you want one.\n');
    else await check(accessToken, readEnv(), readEnv().GMAIL_SENDER);
  }
} catch (error) {
  fail(error.message);
}
