// Phase 0: map BSC tickers (RWA list) to SEC CIKs. Writes fixtures/cik-map.json and prints unmatched.
import { readFileSync, writeFileSync } from 'node:fs';
const raw = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const list = Array.isArray(raw) ? raw : (raw.data?.tokens ?? raw.data);
const bsc = list.filter((x) => x.chainId === '56');
const tickers = [...new Set(bsc.map((x) => x.ticker))];
// fixtures/sec-company-tickers.json: curl -A 'Say research <email>' https://www.sec.gov/files/company_tickers.json (Node fetch got ECONNRESET)
const sec = Object.values(JSON.parse(readFileSync('fixtures/sec-company-tickers.json', 'utf8')));
const byTicker = new Map(sec.map((c) => [c.ticker.toUpperCase(), c]));
const matched = {}, unmatched = [];
for (const t of tickers) {
  const c = byTicker.get(t.toUpperCase());
  if (c) matched[t] = { cik: String(c.cik_str).padStart(10, '0'), name: c.title };
  else unmatched.push(t);
}
writeFileSync('fixtures/cik-map.json', JSON.stringify({ matched, unmatched }, null, 1));
console.log(`bsc tickers=${tickers.length} matched=${Object.keys(matched).length} unmatched=${unmatched.length}`);
console.log('MSTR', matched.MSTR, 'ORCL', matched.ORCL);
console.log('unmatched sample:', unmatched.slice(0, 25).join(','));
