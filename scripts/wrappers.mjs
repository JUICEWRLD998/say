// Phase 2: freeze the BSC wrapper table (RWA list + holder census) into the repo so the calendar builds offline.
// Usage: node scripts/wrappers.mjs <rwa-list.json> <census.json>   (both from strategy/data/, outside the repo)
import { readFileSync, writeFileSync } from 'node:fs';

const [listPath, censusPath] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(listPath, 'utf8'));
const list = Array.isArray(raw) ? raw : (raw.data?.tokens ?? raw.data);
const census = new Map(JSON.parse(readFileSync(censusPath, 'utf8')).map((c) => [c.symbol, c]));

const rows = list
  .filter((x) => x.chainId === '56')
  .map((x) => ({
    ticker: x.ticker,
    symbol: x.symbol,
    address: x.contractAddress,
    type: x.type,
    decimals: x.d,
    multiplier: x.multiplier,
    holders: census.get(x.symbol)?.holders ?? null,
  }))
  .sort((a, b) => a.ticker.localeCompare(b.ticker) || a.symbol.localeCompare(b.symbol));

writeFileSync('fixtures/bsc-wrappers.json', JSON.stringify(rows, null, 1));
console.log(`rows=${rows.length} tickers=${new Set(rows.map((r) => r.ticker)).size} holdersNull=${rows.filter((r) => r.holders === null).length}`);
