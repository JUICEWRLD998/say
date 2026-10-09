// "Which of my stocks vote this month?" Read any wallet: for every open meeting, its weight at the record block.
//   node scripts/my-meetings.mjs <0xaddress> [--json]
// A read only. Nothing is signed and nothing is written.
import { readFileSync, readdirSync } from 'node:fs';
import { weight } from '../packages/core/src/index.ts';
import { balanceOfAt } from './bsc.mjs';
import { loadWrappers } from './lib.mjs';

const addr = process.argv[2];
const asJson = process.argv.includes('--json');
if (!/^0x[0-9a-fA-F]{40}$/.test(addr ?? '')) {
  console.error('usage: node scripts/my-meetings.mjs <0xaddress> [--json]');
  process.exit(2);
}

const ids = readdirSync('meetings', { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
const rows = [];
for (const id of ids) {
  const dir = `meetings/${id}`;
  const m = JSON.parse(readFileSync(`${dir}/meeting.json`, 'utf8'));
  const wrappers = loadWrappers(dir);
  const rec = BigInt(m.recordBlock);
  const cache = new Map();
  for (const w of wrappers) cache.set(w.address, await balanceOfAt(w.address, addr, Number(rec)));
  const e18 = weight(addr, wrappers, rec, (w) => cache.get(w.address) ?? 0n);
  rows.push({
    meeting: m.id,
    ticker: m.ticker,
    company: m.company,
    meetingDate: m.meetingDate,
    recordDate: m.recordDate,
    recordBlock: m.recordBlock,
    status: m.status,
    sharesAtRecordDate: (Number(e18 / 10n ** 14n) / 1e4).toString(),
    standing: e18 > 0n ? 'can vote with weight' : 'voice only: 0 shares at the record date',
  });
}
rows.sort((a, b) => a.meetingDate.localeCompare(b.meetingDate));

if (asJson) console.log(JSON.stringify({ address: addr, meetings: rows }, null, 1));
else {
  console.log(`${addr}`);
  for (const r of rows) console.log(`  ${r.meetingDate} ${r.ticker.padEnd(5)} record ${r.recordDate}  ${r.sharesAtRecordDate.padStart(12)} shares  ${r.standing}`);
}
