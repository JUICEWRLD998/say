// Say agent: one unattended pass. Watch EDGAR, parse, open ballots, tally and close, log every action with its reason.
//   node scripts/agent.mjs [--skip-scan]
// The agent never signs. A ballot exists only when a holder (or a labelled test signer) signs it.
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const skipScan = process.argv.includes('--skip-scan');
const LOG = 'agent-log.jsonl';

function log(action, reason, detail = {}) {
  const row = { ts: new Date().toISOString(), action, reason, detail };
  appendFileSync(LOG, JSON.stringify(row) + '\n');
  console.log(`[${action}] ${reason}${Object.keys(detail).length ? ' ' + JSON.stringify(detail) : ''}`);
}

function run(script, args = []) {
  const r = spawnSync('node', [`scripts/${script}`, ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
  return { ok: r.status === 0, out: (r.stdout ?? '') + (r.stderr ?? ''), status: r.status };
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

// 1. Watch EDGAR.
let fresh = [];
if (skipScan) {
  log('scan', 'skipped by flag; using the filings already on disk');
} else {
  const r = run('edgar-scan.mjs');
  if (!r.ok) {
    log('scan', 'EDGAR scan failed; keeping the last known filings', { status: r.status, tail: r.out.slice(-200) });
  } else {
    fresh = [...r.out.matchAll(/NEW (DEF 14A|DEFA14A) (\S+) (\S+) (\S+)/g)].map((m) => ({ form: m[1], filed: m[2], tickers: m[3], accession: m[4] }));
    log('scan', fresh.length ? `${fresh.length} new proxy filing(s) since the last scan` : 'no new proxy filings since the last scan', { fresh });
  }
}

// 2. Parse when something new arrived (or there is no calendar yet).
const haveCalendar = existsSync('fixtures/edgar/meetings.json');
if (fresh.some((f) => f.form === 'DEF 14A') || !haveCalendar) {
  const r = run('edgar-parse.mjs');
  log('parse', r.ok ? 'DEF 14A parsed through the seven checks' : 'parse failed', r.ok ? { summary: r.out.trim().split('\n').pop() } : { tail: r.out.slice(-200) });
} else {
  log('parse', 'nothing to parse: no new DEF 14A');
}

// 3. Open ballots for ready meetings. Report the ones held back.
if (existsSync('fixtures/edgar/meetings.json')) {
  const { meetings } = readJson('fixtures/edgar/meetings.json');
  const held = meetings.filter((m) => m.status !== 'ready');
  if (held.length) {
    log('hold', `${held.length} meeting(s) failed a check and are not shown as ballots`, {
      held: held.map((m) => `${m.ticker}: ${m.failedChecks.map((c) => c.split(':')[0]).join(',')}`),
    });
  }
  const r = run('open-ballots.mjs');
  const opened = [...r.out.matchAll(/^OPEN (\S+)/gm)].map((m) => m[1]);
  log('open', opened.length ? `opened ${opened.length} new ballot(s)` : 'no new ballots to open', { opened });
}

// 4. Tally every meeting; closing happens inside tally-meeting when closeAt has passed.
const dirs = existsSync('meetings') ? readdirSync('meetings', { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [];
const summary = [];
for (const d of dirs) {
  const dir = `meetings/${d}`;
  const before = readJson(`${dir}/meeting.json`).status;
  const t = run('tally-meeting.mjs', [dir]);
  if (!t.ok) {
    log('tally', `${d}: tally failed, leaving the last published tally in place`, { tail: t.out.slice(-200) });
    continue;
  }
  const c = run('recount.mjs', [dir]);
  const after = readJson(`${dir}/meeting.json`);
  if (before !== after.status) log('close', `${d}: meeting date passed, close block fixed`, { closeBlock: after.closeBlock });
  log('tally', `${d}: tally published, recount ${c.ok ? 'matches' : 'DOES NOT MATCH'}`, { status: after.status, line: t.out.split('\n')[1] });
  summary.push({ meeting: d, status: after.status, recountMatches: c.ok });
}

// 5. Signing. Said once per pass so the log shows the agent never signs for anyone.
log('sign', 'no ballot signed by the agent: a ballot needs the holder\'s own signature; no wallet session is used here');

writeFileSync('agent-status.json', JSON.stringify({ lastRun: new Date().toISOString(), meetings: summary }, null, 1));
const bad = summary.filter((s) => !s.recountMatches);
if (bad.length) {
  log('alert', `${bad.length} recount mismatch(es)`, { bad });
  process.exit(1);
}
