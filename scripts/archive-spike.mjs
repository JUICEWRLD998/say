// Phase 0 spike: can a free public BSC RPC serve historical state (eth_call at a past block)?
// usage: node scripts/archive-spike.mjs [daysBack]
const RPCS = [
  'https://bsc-dataseed.bnbchain.org',
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-rpc.publicnode.com',
  'https://rpc.ankr.com/bsc',
  'https://1rpc.io/bnb',
  'https://bsc.drpc.org',
];
const MSTRON = '0x7313ea16493b2f55054df0131a3a14b043ec8992';
const days = Number(process.argv[2] ?? 30);
const SUPPLY = '0x18160ddd'; // totalSupply()

async function rpc(url, method, params) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

for (const url of RPCS) {
  try {
    const head = parseInt(await rpc(url, 'eth_blockNumber', []), 16);
    const headBlk = await rpc(url, 'eth_getBlockByNumber', ['0x' + head.toString(16), false]);
    const headTs = parseInt(headBlk.timestamp, 16);
    const target = headTs - days * 86400;
    // binary search block at target ts
    let lo = 1, hi = head;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const b = await rpc(url, 'eth_getBlockByNumber', ['0x' + mid.toString(16), false]);
      if (parseInt(b.timestamp, 16) < target) lo = mid + 1; else hi = mid;
    }
    const out = await rpc(url, 'eth_call', [{ to: MSTRON, data: SUPPLY }, '0x' + lo.toString(16)]);
    console.log(`OK   ${url} head=${head} block@-${days}d=${lo} totalSupply=${BigInt(out)}`);
  } catch (e) {
    console.log(`FAIL ${url} ${e.message}`);
  }
}
