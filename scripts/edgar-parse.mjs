// Phase 2: parse every DEF 14A from fixtures/edgar/filings.json and build the meeting calendar.
// Usage: node scripts/edgar-parse.mjs
// Cache: .cache/edgar/<accession>.html (gitignored). Output: fixtures/edgar/meetings.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { get, getJson, submissionsUrl } from './edgar.mjs';
import { parseHtml } from '../packages/proxy/src/index.ts';

const { filings } = JSON.parse(readFileSync('fixtures/edgar/filings.json', 'utf8'));
const wrappers = JSON.parse(readFileSync('fixtures/bsc-wrappers.json', 'utf8'));
mkdirSync('.cache/edgar', { recursive: true });

const defs = filings.filter((f) => f.form === 'DEF 14A');
const amendments = filings.filter((f) => f.form === 'DEFA14A');

const rows = [];
for (const f of defs) {
  const cache = `.cache/edgar/${f.accession}.html`;
  if (!existsSync(cache)) writeFileSync(cache, await get(f.url));
  const sub = await getJson(submissionsUrl(f.cik));
  // The first ticker on the CIK is the primary listing (the common stock). The others are other securities
  // of the same issuer (for example preferred series). Whether they vote is not read from the filing.
  const [primary, ...others] = sub.tickers;
  const ref = { ticker: primary, cik: f.cik, form: f.form, filingDate: f.filingDate, accession: f.accession, url: f.url };
  const m = parseHtml(readFileSync(cache, 'utf8'), ref);
  const w = wrappers.filter((x) => x.ticker === primary);
  rows.push({
    ticker: primary,
    otherTickersOnCik: others.filter((t) => f.tickers.includes(t)),
    company: f.company,
    cik: f.cik,
    filingDate: f.filingDate,
    accession: f.accession,
    url: f.url,
    recordDate: m.recordDate,
    meetingDate: m.meetingDate,
    status: m.status,
    failedChecks: m.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`),
    proposals: m.proposals.map((p) => ({ id: p.id, kind: p.kind, text: p.text, boardRec: p.boardRec, quote: p.quote, recQuote: p.recQuote })),
    amendments: amendments.filter((a) => a.cik === f.cik).map((a) => ({ filingDate: a.filingDate, accession: a.accession, url: a.url })),
    wrappers: w.map(({ symbol, address, type, multiplier, holders }) => ({ symbol, address, type, multiplier, holders })),
  });
}

rows.sort((a, b) => (a.meetingDate ?? '9999').localeCompare(b.meetingDate ?? '9999'));
writeFileSync('fixtures/edgar/meetings.json', JSON.stringify({ builtFrom: 'fixtures/edgar/filings.json', meetings: rows }, null, 1));

for (const r of rows) {
  console.log(
    `${r.status.padEnd(12)} ${r.ticker.padEnd(5)} record ${r.recordDate ?? '-'} meeting ${r.meetingDate ?? '-'} proposals ${r.proposals.length} wrappers ${r.wrappers.length}` +
      (r.failedChecks.length ? `\n    ${r.failedChecks.join('\n    ')}` : ''),
  );
}
const ready = rows.filter((r) => r.status === 'ready');
console.log(`\nready=${ready.length} needs_review=${rows.length - ready.length} of ${rows.length}`);
