// Phase 3 step 4: real weights from public on-chain reads. For one meeting, find addresses that received any of its
// wrapper tokens shortly before the record block, read balanceOf at the record block (two archive endpoints must
// agree), and weigh them with the core `weight` function. These are TEST READS: the holders did not sign anything.
//   node scripts/electorate.mjs <meeting-dir> [windowBlocks=300000] [top=10]
// Writes <meeting-dir>/electorate-preview.json
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { weight } from '../packages/core/src/index.ts';
import { balanceOfAt, rpc, transferLogs } from './bsc.mjs';
import { loadWrappers, readJson } from './lib.mjs';

const dir = resolve(process.argv[2] ?? '');
const windowBlocks = Number(process.argv[3] ?? 300000);
const top = Number(process.argv[4] ?? 10);
const meeting = readJson(dir, 'meeting.json');
const wrappers = loadWrappers(dir);
const recordBlock = BigInt(meeting.recordBlock);
const rb = Number(recordBlock);

const candidates = new Set();
for (const w of wrappers) {
  const logs = await transferLogs(w.address, rb - windowBlocks, rb);
  for (const l of logs) candidates.add('0x' + l.topics[2].slice(26));
}

// Balances at the record block for every candidate on every wrapper.
const cache = new Map();
const jobs = [...candidates].flatMap((h) => wrappers.map((w) => [w, h]));
async function worker() {
  while (jobs.length) {
    const [w, h] = jobs.pop();
    cache.set(`${w.address}|${h}`, await balanceOfAt(w.address, h, rb));
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
const read = (w, h) => cache.get(`${w.address}|${h}`) ?? 0n;

const rows = [];
for (const h of candidates) {
  const wE18 = weight(h, wrappers, recordBlock, read);
  if (wE18 === 0n) continue;
  const code = await rpc('eth_getCode', [h, 'latest']);
  rows.push({ address: h, isContract: code !== '0x', weightE18: wE18.toString() });
}
rows.sort((a, b) => (BigInt(b.weightE18) > BigInt(a.weightE18) ? 1 : -1));

const out = {
  meetingId: meeting.id,
  kind: 'TEST READS, not votes: these addresses did not sign a ballot',
  recordBlock: meeting.recordBlock,
  candidateWindow: `Transfer recipients in blocks ${rb - windowBlocks}..${rb}`,
  candidates: candidates.size,
  withShares: rows.length,
  multiplierNote: 'wrapper multipliers are the RWA list values of 2026-10-06, not read at the record block',
  top: rows.slice(0, top),
};
writeFileSync(resolve(dir, 'electorate-preview.json'), JSON.stringify(out, null, 1));
console.log(`${meeting.id}: candidates=${candidates.size} withShares=${rows.length}`);
for (const r of out.top) console.log(`  ${r.address} ${r.isContract ? 'contract' : 'EOA     '} ${(Number(BigInt(r.weightE18) / 10n ** 14n) / 1e4).toFixed(4)} shares`);
