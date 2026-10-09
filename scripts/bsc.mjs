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
    // Network errors and non-JSON replies are retried with backoff. A JSON-RPC error reply is an answer: not retried.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          signal: AbortSignal.timeout(20000),
        });
        const j = await r.json();
        if (j.error) {
          last = new Error(j.error.message);
          break;
        }
        return j.result;
      } catch (e) {
        last = e;
        await new Promise((res) => setTimeout(res, 500 * attempt));
      }
    }
  }
  throw new Error(`${method} failed on every endpoint: ${last?.message}`);
}

const hex = (n) => '0x' + n.toString(16);
const cache = new Map();

// Archive reads. Phase 0 found no keyless archive among the usual endpoints; a wider probe on 2026-10-09 found
// three that serve real history (the same totalSupply at each old block on all three, a different value at head).
// SAY_ARCHIVE_RPC (comma separated) puts a keyed endpoint first.
export const ARCHIVE_RPCS = [
  ...(process.env.SAY_ARCHIVE_RPC ? process.env.SAY_ARCHIVE_RPC.split(',') : []),
  'https://bsc.api.pocket.network',
  'https://56.rpc.thirdweb.com',
  'https://bsc-mainnet.public.blastapi.io',
];

const pad32 = (a) => a.toLowerCase().replace('0x', '').padStart(64, '0');

/** balanceOf(holder) on `token` at `block`. Must agree on two archive endpoints, or it throws. */
export async function balanceOfAt(token, holder, block) {
  const data = '0x70a08231' + pad32(holder);
  const answers = [];
  let last;
  for (const url of ARCHIVE_RPCS) {
    try {
      const out = await rpc('eth_call', [{ to: token, data }, hex(block)], [url]);
      answers.push(BigInt(out));
      if (answers.length === 2) break;
    } catch (e) {
      last = e;
    }
  }
  if (answers.length < 2) throw new Error(`balanceOf needs 2 archive answers, got ${answers.length}: ${last?.message}`);
  if (answers[0] !== answers[1]) throw new Error(`archive endpoints disagree on balanceOf(${holder}) at ${block}`);
  return answers[0];
}

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** Transfer logs for `token` in [from, to]. Splits the range on a size or rate error. */
export async function transferLogs(token, from, to, chunk = 50000) {
  // Pocket answers 50k-block ranges quickly and slows or errors on 300k, so start from fixed chunks.
  if (to - from + 1 > chunk) {
    const out = [];
    for (let s = from; s <= to; s += chunk) out.push(...(await transferLogs(token, s, Math.min(s + chunk - 1, to), chunk)));
    return out;
  }
  try {
    return await rpc('eth_getLogs', [{ address: token, topics: [TRANSFER_TOPIC], fromBlock: hex(from), toBlock: hex(to) }], ARCHIVE_RPCS);
  } catch (e) {
    if (to - from < 1000) throw e;
    const mid = Math.floor((from + to) / 2);
    return [...(await transferLogs(token, from, mid)), ...(await transferLogs(token, mid + 1, to))];
  }
}

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
