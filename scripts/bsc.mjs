// BSC reads over public JSON-RPC. Block headers are served by every node, so timestamp-to-block works keyless.
// Historical eth_call (balanceOf at a past block) needs an archive node; see DEVEX_NOTES / Phase 0.
export const RPCS = (process.env.SAY_BSC_RPC ? process.env.SAY_BSC_RPC.split(',') : null) ?? [
  'https://bsc-dataseed.bnbchain.org',
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-dataseed1.ninicoin.io',
];

export async function rpc(method, params, urls = RPCS) {
  let last;
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(15000),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`${method} failed on every endpoint: ${last?.message}`);
}

const hex = (n) => '0x' + n.toString(16);
const cache = new Map();

export async function headBlock() {
  return parseInt(await rpc('eth_blockNumber', []), 16);
}

export async function blockTimestamp(n) {
  if (cache.has(n)) return cache.get(n);
  const b = await rpc('eth_getBlockByNumber', [hex(n), false]);
  if (!b) throw new Error(`block ${n} not found`);
  const ts = parseInt(b.timestamp, 16);
  cache.set(n, ts);
  return ts;
}

/**
 * The last block whose timestamp is at or before `ts` (unix seconds). This is the state "at the close of
 * business" on a record date. Throws if `ts` is in the future or before block 1.
 */
export async function blockAtOrBefore(ts) {
  const head = await headBlock();
  if ((await blockTimestamp(head)) < ts) throw new Error(`timestamp ${ts} is after the head block`);
  let lo = 1;
  let hi = head;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if ((await blockTimestamp(mid)) <= ts) lo = mid;
    else hi = mid - 1;
  }
  if ((await blockTimestamp(lo)) > ts) throw new Error(`no block at or before ${ts}`);
  return lo;
}

/** 16:00 America/New_York on an ISO date, as unix seconds. The US market close; filings say "close of business". */
export function etCloseUtc(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  for (const offsetH of [4, 5]) {
    const t = Date.UTC(y, m - 1, d, 16 + offsetH, 0, 0);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hour12: false,
      day: 'numeric',
    }).formatToParts(new Date(t));
    const hour = Number(parts.find((p) => p.type === 'hour').value) % 24;
    const day = Number(parts.find((p) => p.type === 'day').value);
    if (hour === 16 && day === d) return t / 1000;
  }
  throw new Error(`cannot place 16:00 ET on ${iso}`);
}
