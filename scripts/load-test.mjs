#!/usr/bin/env node
/**
 * The event-day load test: up to 300 staff phones using the fest dashboard at once, the way the
 * real dashboard does (src/admin/fest/FestData.tsx and AdminApp.tsx):
 *
 *   - every phone signs in, loads the catalog, asks for changes every 15 seconds, and checks its
 *     session and help replies every 60 seconds;
 *   - desk phones (2 per desk) take blocks of IDs and register a student every 30-60 seconds;
 *   - coordinator phones take event fees and mark attendance every 20-40 seconds;
 *   - HODs, department admins and the overall coordinator watch.
 *
 * Safe by design:
 *   - it refuses to start unless a TEST SESSION is on (Testing → Start an event-day test), so
 *     every registration it makes is marked TEST and goes with "Delete the test data";
 *   - it makes its own accounts (lt-…) with a random password kept in memory only, and deletes
 *     them at the end (also on Ctrl+C);
 *   - it stops by itself if more than half the requests fail for a minute;
 *   - it never prints a password or token.
 *
 * Usage (from this folder, Node 22+, nothing to install):
 *   node scripts/load-test.mjs --admin <your admin username>
 *   (the password is asked for and typed hidden; or set LOADTEST_ADMIN_PASSWORD)
 * Options: --devices 300  --minutes 10  --ramp 120 (seconds to bring every phone in)
 *          --api <API address>  --keep-accounts  --yes (skip the 10-second wait)
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import readline from 'node:readline';
import { parseArgs } from 'node:util';

const { values: options } = parseArgs({
  options: {
    api: { type: 'string', default: 'https://683v5yp7k4.execute-api.us-east-1.amazonaws.com' },
    admin: { type: 'string', default: process.env.LOADTEST_ADMIN_USER ?? '' },
    devices: { type: 'string', default: '300' },
    minutes: { type: 'string', default: '10' },
    ramp: { type: 'string', default: '120' },
    'keep-accounts': { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
  },
});

const API = options.api.replace(/\/+$/, '');
const DEVICES = Math.min(Math.max(Number(options.devices) || 300, 1), 1000);
const MINUTES = Math.min(Math.max(Number(options.minutes) || 10, 1), 60);
const RAMP_S = Math.min(Math.max(Number(options.ramp) || 120, 0), 900);
const PREFIX = 'lt-';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const between = (low, high) => low + Math.random() * (high - low);
const pick = (items) => items[Math.floor(Math.random() * items.length)];
const pad4 = (n) => String(n).padStart(4, '0');
const clock = (ms) => `${String(Math.floor(ms / 60_000)).padStart(2, '0')}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;

// ------------------------------------------------------------------------------------------
// Asking for the admin's details (the password is never echoed or printed)

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (text) => text.includes(question) && rl.output.write(text);
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

// ------------------------------------------------------------------------------------------
// Requests and what they measured

const stats = new Map(); // operation → { latencies: number[], ok, codes: Map }
const recent = []; // [time, ok] for the last minute (the safety stop)
let stopping = false;

function record(op, ok, code, ms) {
  const entry = stats.get(op) ?? { latencies: [], ok: 0, fail: 0, codes: new Map() };
  entry.latencies.push(ms);
  if (ok) entry.ok += 1;
  else {
    entry.fail += 1;
    entry.codes.set(code, (entry.codes.get(code) ?? 0) + 1);
  }
  stats.set(op, entry);
  recent.push([Date.now(), ok]);
}

async function call(op, method, path, body, token) {
  const started = performance.now();
  try {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // API Gateway's own answers (throttled, unavailable) are not always JSON.
    }
    const code = response.ok ? '' : `${response.status} ${json?.code ?? json?.message ?? text.slice(0, 40)}`.trim();
    // A refusal the dashboard handles as normal (already done, already registered) is not a failure.
    const expected = ['ID_TAKEN', 'DUPLICATE_PHONE', 'BUSY'].includes(json?.code);
    if (op) record(op, response.ok || expected, code, performance.now() - started);
    return { status: response.status, json, code: json?.code ?? '' };
  } catch (error) {
    if (op) record(op, false, error?.name === 'TimeoutError' ? 'TIMEOUT (30 s)' : 'NETWORK', performance.now() - started);
    return { status: 0, json: null, code: 'NETWORK' };
  }
}

const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);

function summary(elapsedMs) {
  const rows = [...stats.entries()].sort(([a], [b]) => a.localeCompare(b));
  let total = 0;
  let failed = 0;
  const lines = rows.map(([op, entry]) => {
    const sorted = [...entry.latencies].sort((a, b) => a - b);
    total += sorted.length;
    failed += entry.fail;
    return {
      operation: op,
      requests: sorted.length,
      failed: entry.fail,
      p50: Math.round(quantile(sorted, 0.5)),
      p95: Math.round(quantile(sorted, 0.95)),
      p99: Math.round(quantile(sorted, 0.99)),
      max: Math.round(sorted.at(-1) ?? 0),
      errors: Object.fromEntries(entry.codes),
    };
  });
  return { lines, total, failed, perSecond: total / Math.max(1, elapsedMs / 1000) };
}

// ------------------------------------------------------------------------------------------
// Test students (letters only in names, as the form requires; every phone unique in this run)

const FIRST = ['Arun', 'Kavya', 'Nithya', 'Rahul', 'Divya', 'Karthik', 'Meena', 'Vignesh', 'Priya', 'Surya', 'Lakshmi', 'Hari', 'Deepa', 'Ajay', 'Sneha', 'Gokul', 'Anitha', 'Pradeep', 'Swathi', 'Naveen'];
const runSeed = 100 + Math.floor(Math.random() * 900);
let phoneCounter = 0;
const nextPhone = () => `6${runSeed}${String(++phoneCounter).padStart(6, '0')}`;
const student = () => ({
  name: `${pick(FIRST)} ${String.fromCharCode(65 + Math.floor(Math.random() * 26))}. Loadtest`,
  phone: nextPhone(),
  email: '',
  college: 'Load Test College',
  branch: 'B.E. Load Test',
  year: '2nd Year',
  team: '',
});

// ------------------------------------------------------------------------------------------
// What every phone shares: each department's registrations as last seen (to pick fee targets)

const seen = new Map(); // dept → Map(id → registration)
function merge(registrations) {
  for (const item of registrations ?? []) {
    const dept = seen.get(item.dept) ?? new Map();
    const current = dept.get(item.id);
    if (!current || current.v <= item.v) dept.set(item.id, item);
    seen.set(item.dept, dept);
  }
}
let registered = 0;
let feesTaken = 0;
let marked = 0;

// ------------------------------------------------------------------------------------------
// One phone

async function phone(device, password, endAt) {
  const login = await call('login', 'POST', '/api/admin/login', { username: device.username, password });
  const token = login.json?.token;
  if (!token) return;
  await call('catalog', 'GET', '/api/admin/fest/catalog', undefined, token);

  let cursor = '';
  let nextSync = 0;
  let nextMinute = Date.now() + between(30_000, 60_000);
  let nextAction = Date.now() + between(5_000, 20_000);
  const ids = [];
  let refilling = false;
  const refill = async () => {
    if (refilling) return;
    refilling = true;
    const block = await call('id block', 'POST', '/api/admin/fest/blocks', {}, token);
    if (block.json?.first) for (let n = block.json.first; n <= block.json.last; n += 1) ids.push(n);
    refilling = false;
  };
  if (device.kind === 'desk') await refill();

  while (!stopping && Date.now() < endAt) {
    const now = Date.now();
    if (now >= nextSync) {
      const answer = await call(cursor ? 'sync (changes)' : 'sync (first, full)', 'POST', '/api/admin/fest/sync', cursor ? { since: cursor } : {}, token);
      if (answer.json?.cursor) cursor = answer.json.cursor;
      merge(answer.json?.registrations);
      nextSync = Date.now() + 15_000 + between(-1_500, 1_500);
    }
    if (now >= nextMinute) {
      await call('session check', 'GET', '/api/admin/session', undefined, token);
      await call('help replies', 'GET', '/api/help/mine', undefined, token);
      nextMinute = Date.now() + 60_000;
    }
    if (now >= nextAction) {
      if (device.kind === 'desk') await register(device, token, ids, refill);
      if (device.kind === 'coordinator') await eventWork(device, token);
      nextAction = Date.now() + (device.kind === 'desk' ? between(30_000, 60_000) : between(20_000, 40_000));
    }
    await sleep(500);
  }
}

async function register(device, token, ids, refill) {
  if (ids.length < 15) void refill();
  if (!ids.length) return;
  const events = device.events.length ? [...new Set([pick(device.events), pick(device.events)])] : [];
  let participant = student();
  for (let attempt = 0; attempt < 3 && ids.length; attempt += 1) {
    const id = `${device.dept}-${pad4(ids.shift())}`;
    const answer = await call('register', 'POST', '/api/admin/fest/registrations', {
      submissionId: `lt-${randomUUID()}`,
      id,
      participant,
      events,
      payment: { method: 'CASH', confirmed: true },
    }, token);
    if (answer.status === 200) {
      registered += 1;
      if (answer.json?.registration) merge([answer.json.registration]);
      return;
    }
    if (answer.code === 'DUPLICATE_PHONE') participant = student();
    else if (answer.code !== 'ID_TAKEN') return;
  }
}

async function eventWork(device, token) {
  const people = [...(seen.get(device.dept)?.values() ?? [])].filter((item) => !item.cancelled && !item.deleted);
  for (const eventId of device.events) {
    const entries = people.map((item) => ({ item, entry: item.events.find((entry) => entry.eventId === eventId) })).filter(({ entry }) => entry);
    const unpaid = entries.find(({ entry }) => !entry.fee || entry.fee.voided);
    const absent = entries.find(({ entry }) => entry.fee && !entry.fee.voided && !entry.present);
    const target = unpaid ?? absent;
    if (!target) continue;
    const body = unpaid ? { action: 'fee', payment: { method: 'CASH', confirmed: true } } : { action: 'present' };
    const answer = await call(unpaid ? 'event fee' : 'attendance', 'POST', `/api/admin/fest/registrations/${target.item.id}/events/${eventId}`, body, token);
    if (answer.status === 200) {
      if (unpaid) feesTaken += 1;
      else marked += 1;
      if (answer.json?.registration) merge([answer.json.registration]);
    }
    return;
  }
}

// ------------------------------------------------------------------------------------------
// Accounts

function planAccounts(catalog) {
  const accounts = [];
  for (const dept of catalog.departments.filter((item) => item.active !== false)) {
    const lower = dept.code.toLowerCase();
    const events = catalog.events.filter((event) => event.dept === dept.code && event.active !== false).map((event) => event.id);
    for (let desk = 1; desk <= Math.min(dept.desks || 4, 4); desk += 1) {
      accounts.push({ username: `${PREFIX}${lower}-desk${desk}`, displayName: `Load test ${dept.code} desk ${desk}`, role: 'DESK', department: dept.code, deskNumber: desk, eventIds: [], kind: 'desk', dept: dept.code, events });
    }
    accounts.push({ username: `${PREFIX}${lower}-hod`, displayName: `Load test ${dept.code} HOD`, role: 'HOD', department: dept.code, eventIds: [], kind: 'watch', dept: dept.code, events: [] });
    accounts.push({ username: `${PREFIX}${lower}-admin`, displayName: `Load test ${dept.code} admin`, role: 'DEPT_ADMIN', department: dept.code, eventIds: [], kind: 'watch', dept: dept.code, events: [] });
    events.forEach((eventId, index) => {
      accounts.push({ username: `${PREFIX}${lower}-c${index + 1}`, displayName: `Load test ${dept.code} coordinator ${index + 1}`, role: 'COORDINATOR', department: dept.code, eventIds: [eventId], kind: 'coordinator', dept: dept.code, events: [eventId] });
    });
  }
  accounts.push({ username: `${PREFIX}overall`, displayName: 'Load test overall coordinator', role: 'OVERALL', department: null, eventIds: [], kind: 'watch', dept: null, events: [] });
  return accounts;
}

/** Every account gets 2 phones (the overall coordinator 4); extra phones go to coordinators, HODs and admins. */
function planDevices(accounts) {
  const devices = [];
  for (const account of accounts) for (let n = 0; n < (account.role === 'OVERALL' ? 4 : 2); n += 1) devices.push(account);
  const extra = accounts.filter((account) => account.kind !== 'desk');
  for (let index = 0; devices.length < DEVICES; index += 1) devices.push(extra[index % extra.length]);
  return devices.slice(0, DEVICES);
}

async function inBatches(items, size, work) {
  for (let index = 0; index < items.length; index += size) await Promise.all(items.slice(index, index + size).map(work));
}

// ------------------------------------------------------------------------------------------
// The run

async function main() {
  console.log(`\nPRAGYA fest load test → ${API}\n`);
  const health = await call(null, 'GET', '/api/health');
  if (health.json?.status !== 'ready') throw new Error(`The API is not ready (${health.status} ${health.code || ''}). Check /api/health first.`);

  const adminUser = options.admin || (await ask('Admin username (owner or web assist): '));
  const adminPassword = process.env.LOADTEST_ADMIN_PASSWORD || (await ask('Admin password (hidden): ', true));
  const signIn = await call(null, 'POST', '/api/admin/login', { username: adminUser, password: adminPassword });
  const admin = signIn.json?.token;
  if (!admin) throw new Error(`Admin sign-in failed (${signIn.status} ${signIn.code}).`);

  const session = (await call(null, 'GET', '/api/admin/session', undefined, admin)).json;
  if (!session?.testing?.session) {
    throw new Error('No test session is on. In the dashboard: Testing → Start an event-day test, then run this again (everything it registers is then marked TEST).');
  }
  if (session.phase === 'closed') throw new Error('Registration is closed, so the desks would be refused. Start an event-day test (it opens on-site registration).');
  const catalog = (await call(null, 'GET', '/api/admin/fest/catalog', undefined, admin)).json?.catalog;
  if (!catalog?.departments?.length) throw new Error('Could not read the departments and events.');

  const accounts = planAccounts(catalog);
  const devices = planDevices(accounts);
  const counts = devices.reduce((all, device) => ({ ...all, [device.kind]: (all[device.kind] ?? 0) + 1 }), {});
  console.log(`Test session: "${session.testing.session}" (everything registered is marked TEST).`);
  console.log(`Plan: ${accounts.length} lt- accounts, ${devices.length} phones (${counts.desk ?? 0} at desks, ${counts.coordinator ?? 0} with coordinators, ${counts.watch ?? 0} watching),`);
  console.log(`      all phones in over ${RAMP_S} s, then ${MINUTES} min at full load. About ${Math.round((devices.length * 4 + (counts.desk ?? 0) * 1.3 + (counts.coordinator ?? 0) * 2) / 60)} requests a second.`);
  if (!options.yes) {
    console.log('\nStarting in 10 seconds. Ctrl+C to cancel.');
    await sleep(10_000);
  }

  // A strong random password for the lt- accounts, in memory only.
  const password = `Lt-${randomBytes(18).toString('base64url')}-9a`;
  console.log(`\nMaking ${accounts.length} accounts…`);
  await inBatches(accounts, 4, async (account) => {
    const { username, displayName, role, department, deskNumber, eventIds } = account;
    const made = await call(null, 'POST', '/api/admin/staff', { username, displayName, role, department, deskNumber: deskNumber ?? null, eventIds, password }, admin);
    if (made.code === 'USERNAME_TAKEN') await call(null, 'POST', `/api/admin/staff/${account.username}`, { password, active: true }, admin);
    else if (made.status !== 200) throw new Error(`Could not make ${account.username} (${made.status} ${made.code}).`);
  });

  let interrupted = false;
  process.on('SIGINT', () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    stopping = true;
    console.log('\nStopping (Ctrl+C again to quit at once)…');
  });

  const started = Date.now();
  const endAt = started + RAMP_S * 1000 + MINUTES * 60_000;
  let active = 0;
  const ticker = setInterval(() => {
    const now = Date.now();
    while (recent.length && recent[0][0] < now - 60_000) recent.shift();
    const lastMinute = recent.length;
    const failedMinute = recent.filter(([, ok]) => !ok).length;
    const { perSecond, failed, total } = summary(now - started);
    const p95 = (op) => {
      const sorted = [...(stats.get(op)?.latencies ?? [])].slice(-2000).sort((a, b) => a - b);
      return sorted.length ? `${Math.round(quantile(sorted, 0.95))} ms` : '-';
    };
    console.log(
      `[${clock(now - started)}] phones ${active}/${devices.length} | ${perSecond.toFixed(1)} req/s | changes p95 ${p95('sync (changes)')} | register p95 ${p95('register')} | registered ${registered}, fees ${feesTaken}, present ${marked} | failed ${failed}/${total}`,
    );
    if (lastMinute > 100 && failedMinute / lastMinute > 0.5 && !stopping) {
      console.log('More than half the requests failed in the last minute: stopping to spare the server.');
      stopping = true;
    }
  }, 15_000);

  console.log(`Bringing in ${devices.length} phones…`);
  const runs = devices.map(async (device, index) => {
    await sleep((index / devices.length) * RAMP_S * 1000);
    if (stopping) return;
    active += 1;
    try {
      await phone(device, password, endAt);
    } finally {
      active -= 1;
    }
  });
  await Promise.all(runs);
  clearInterval(ticker);

  const elapsed = Date.now() - started;
  const result = summary(elapsed);
  console.log(`\nDone after ${clock(elapsed)}: ${result.total} requests, ${result.perSecond.toFixed(1)} a second; registered ${registered}, event fees ${feesTaken}, attendance ${marked}.\n`);
  console.table(result.lines.map((line) => ({ operation: line.operation, requests: line.requests, failed: line.failed, p50: line.p50, p95: line.p95, p99: line.p99, max: line.max })));
  for (const line of result.lines.filter((item) => item.failed)) console.log(`  ${line.operation}: ${JSON.stringify(line.errors)}`);
  const rate = result.total ? result.failed / result.total : 0;
  const changes = result.lines.find((line) => line.operation === 'sync (changes)');
  const reg = result.lines.find((line) => line.operation === 'register');
  const verdict = rate < 0.01 && (changes?.p95 ?? 0) < 2000 && (reg?.p95 ?? 0) < 3000 ? 'PASS' : 'CHECK';
  console.log(`\nVerdict: ${verdict} (failed ${(rate * 100).toFixed(2)}%; aim under 1%, changes p95 under 2 s, register p95 under 3 s).`);
  if (result.lines.some((line) => Object.keys(line.errors).some((code) => /^(429|503|500)/.test(code)))) {
    console.log('429/503/500 answers mean the server turned requests away: usually the Lambda concurrency limit (10 until AWS raises it) or a route throttle.');
  }

  const report = `load-test-report-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  writeFileSync(report, JSON.stringify({ api: API, devices: devices.length, rampSeconds: RAMP_S, minutes: MINUTES, startedAt: new Date(started).toISOString(), elapsedMs: elapsed, registered, feesTaken, marked, verdict, ...result }, null, 2));
  console.log(`Report saved: ${report}`);

  if (!options['keep-accounts']) {
    console.log(`\nDeleting the ${accounts.length} lt- accounts…`);
    await inBatches(accounts, 4, (account) => call(null, 'POST', `/api/admin/staff/${account.username}/delete`, {}, admin));
  }
  await call(null, 'POST', '/api/admin/logout', {}, admin);
  console.log('\nLast step, in the dashboard: Testing → Delete the test data (type DELETE TEST DATA), and go back to the real schedule.\n');
}

main().catch((error) => {
  console.error(`\n${error.message}\n`);
  process.exit(1);
});
