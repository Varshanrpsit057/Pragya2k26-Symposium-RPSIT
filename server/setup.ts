/**
 * Gets the Google Sheet and Drive ready for registrations (run once on your computer, with
 * the Google settings in .env; safe to run again):
 *
 *   npm run google:setup
 *
 * - Sheet: the Registrations tab with every column, a frozen coloured header, column
 *   widths, a filter and status colours (an empty "Sheet1" becomes the Registrations tab).
 * - Drive: the "Participant Passes" folder next to the payment screenshots folder; its ID
 *   is saved to .env as GOOGLE_DRIVE_PASS_FOLDER_ID (copy it to the Amplify variables too).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DriveStore } from './drive';
import { GoogleClient, describeError } from './google';
import { COLUMNS, SheetsStore } from './sheets';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ENV_FILE = join(ROOT, '.env');
const PASS_FOLDER_NAME = 'Participant Passes';

if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

function saveToEnv(key: string, value: string) {
  const text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '';
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text ? text.split(/\r?\n/) : [];
  const index = lines.findIndex((line) => new RegExp(`^\\s*${key}\\s*=`).test(line));
  if (index >= 0) lines[index] = `${key}=${value}`;
  else {
    if (lines.length && lines.at(-1) === '') lines.pop();
    lines.push(`${key}=${value}`, '');
  }
  writeFileSync(ENV_FILE, lines.join(newline));
}

const GOOGLE_SETTINGS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_SHEET_ID', 'GOOGLE_DRIVE_PAYMENT_FOLDER_ID'];
const missing = GOOGLE_SETTINGS.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error(`\nMissing in .env: ${missing.join(', ')}. Run npm run google:auth first.\n`);
  process.exit(1);
}
const setting = (name: string) => process.env[name]?.trim() || null;
const config = {
  google: {
    clientId: setting('GOOGLE_CLIENT_ID')!,
    clientSecret: setting('GOOGLE_CLIENT_SECRET')!,
    refreshToken: setting('GOOGLE_REFRESH_TOKEN')!,
  },
  sheetId: setting('GOOGLE_SHEET_ID')!,
  sheetTab: setting('GOOGLE_SHEET_TAB') ?? 'Registrations',
  paymentFolderId: setting('GOOGLE_DRIVE_PAYMENT_FOLDER_ID')!,
  passFolderId: setting('GOOGLE_DRIVE_PASS_FOLDER_ID'),
};

const google = new GoogleClient(config.google);
const sheets = new SheetsStore(google, config.sheetId, config.sheetTab);
const drive = new DriveStore(google);

try {
  console.log('\nPreparing the Google Sheet...');
  const { title, renamed } = await sheets.prepare();
  console.log(`  ✓ Tab "${title}"${renamed ? ' (renamed from the empty Sheet1)' : ''} with ${Object.keys(COLUMNS).length} columns:`);
  console.log(`    ${Object.values(COLUMNS).join(' | ')}`);
  console.log('  ✓ Header frozen and coloured, column widths, filter, status colours, plain-text phone and transaction IDs');

  console.log('\nPreparing Google Drive...');
  console.log('  ✓ Payment screenshots go to the folder in GOOGLE_DRIVE_PAYMENT_FOLDER_ID');
  let passFolder = config.passFolderId;
  if (!passFolder) {
    passFolder = await drive.ensureFolder(PASS_FOLDER_NAME, await drive.parentOf(config.paymentFolderId));
    saveToEnv('GOOGLE_DRIVE_PASS_FOLDER_ID', passFolder);
  }
  console.log(`  ✓ Participant passes go to "${PASS_FOLDER_NAME}" (saved in .env as GOOGLE_DRIVE_PASS_FOLDER_ID)`);

  console.log(`\nSheet:  https://docs.google.com/spreadsheets/d/${config.sheetId}/edit`);
  console.log(`Drive:  https://drive.google.com/drive/folders/${config.paymentFolderId}`);
  console.log(`Passes: https://drive.google.com/drive/folders/${passFolder}\n`);
} catch (error) {
  console.error(`\nSetup failed: ${describeError(error)}\n`);
  process.exit(1);
}
