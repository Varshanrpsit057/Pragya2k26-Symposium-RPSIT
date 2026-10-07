// Makes the value of the ADMIN_PASSWORD_HASH secret for the admin dashboard.
//
//   npm run admin:password
//
// Type the new password twice (it is not shown). The password itself is never stored
// anywhere: only this scrypt hash, saved to .env and copied into the Amplify secret
// ADMIN_PASSWORD_HASH.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { hashPassword, passwordProblem } from '../server/auth';

const ENV_FILE = '.env';

function askHidden(prompt: string): Promise<string> {
  const { stdin, stdout } = process;
  stdout.write(prompt);
  return new Promise((resolve) => {
    let value = '';
    stdin.setEncoding('utf8');
    if (!stdin.isTTY) {
      // Piped in (e.g. from a password manager): the first line.
      stdin.on('data', (chunk: string) => (value += chunk));
      stdin.on('end', () => resolve(value.split(/\r?\n/)[0] ?? ''));
      return;
    }
    stdin.setRawMode(true);
    stdin.resume();
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          stdout.write('\n');
          process.exit(130);
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on('data', onData);
  });
}

const password = await askHidden('New admin password: ');
const problem = passwordProblem(password);
if (problem) {
  console.error(`\nThat password is too weak. ${problem}\n`);
  process.exit(1);
}
if (process.stdin.isTTY && (await askHidden('Type it again:      ')) !== password) {
  console.error('\nThe two passwords do not match. Nothing was changed.\n');
  process.exit(1);
}

const hash = await hashPassword(password);
console.log(`\nADMIN_PASSWORD_HASH=${hash}\n`);
// Also kept in .env (git ignores it), next to the other values to copy into Amplify.
if (existsSync(ENV_FILE)) {
  const text = readFileSync(ENV_FILE, 'utf8');
  const line = `ADMIN_PASSWORD_HASH=${hash}`;
  const next = /^ADMIN_PASSWORD_HASH=.*$/m.test(text)
    ? text.replace(/^ADMIN_PASSWORD_HASH=.*$/m, line)
    : `${text.replace(/\s*$/, '\n')}${line}\n`;
  writeFileSync(ENV_FILE, next);
  console.log('Saved in .env as ADMIN_PASSWORD_HASH.');
}
console.log('Put this value (everything after the "=") in the Amplify secret ADMIN_PASSWORD_HASH:');
console.log('  Amplify console → your app → Hosting → Secrets → Manage secrets');
console.log('  or, for a sandbox: npx ampx sandbox secret set ADMIN_PASSWORD_HASH\n');
console.log('Then redeploy. The new password signs out every admin session made with the old one.\n');
