// Phase 2 watcher: scan EDGAR submissions for every matched BSC ticker and list DEF 14A / DEFA14A filings.
// Usage: node scripts/edgar-scan.mjs [sinceDate=2026-07-15]
// Writes fixtures/edgar/filings.json (all proxy filings) and prints a summary.
import { readFileSync, writeFileSync } from 'node:fs';
import { getJson, submissionsUrl, proxyFilings } from './edgar.mjs';

const since = process.argv[2] ?? '2026-07-15';
const { matched, unmatched } = JSON.parse(readFileSync('fixtures/cik-map.json', 'utf8'));

// One request per CIK. Several tickers can share a CIK.
const byCik = new Map();
for (const [ticker, { cik }] of Object.entries(matched)) {
  if (!byCik.has(cik)) byCik.set(cik, []);
  byCik.get(cik).push(ticker);
}

const filings = [];
const errors = [];
let n = 0;
for (const [cik, tickers] of byCik) {
  n++;
  try {
    const sub = await getJson(submissionsUrl(cik));
    for (const f of proxyFilings(sub, since)) filings.push({ ...f, tickers });
  } catch (e) {
    errors.push({ cik, tickers, error: e.message });
  }
  if (n % 50 === 0) console.error(`scanned ${n}/${byCik.size}`);
}

filings.sort((a, b) => b.filingDate.localeCompare(a.filingDate));

// Watcher behaviour: report filings that were not in the previous scan.
let seen = new Set();
try {
  seen = new Set(JSON.parse(readFileSync('fixtures/edgar/filings.json', 'utf8')).filings.map((f) => f.accession));
} catch {
  // first run: everything is new
}
const fresh = filings.filter((f) => !seen.has(f.accession));
console.log(`new since last scan: ${fresh.length}`);
for (const f of fresh) console.log(`  NEW ${f.form} ${f.filingDate} ${f.tickers.join('/')} ${f.accession}`);
const out = { since, scannedCiks: byCik.size, unmatchedTickers: unmatched.length, errors, filings };
writeFileSync('fixtures/edgar/filings.json', JSON.stringify(out, null, 1));
const def = filings.filter((f) => f.form === 'DEF 14A');
console.log(`ciks=${byCik.size} errors=${errors.length} DEF14A=${def.length} DEFA14A=${filings.length - def.length}`);
console.log('DEF 14A filers:', [...new Set(def.flatMap((f) => f.tickers))].join(' '));
