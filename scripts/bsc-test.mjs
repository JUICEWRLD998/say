// Phase 0 step 6 test: blockAtOrBefore against 3 known blocks, plus the ET close conversion.
//   node scripts/bsc-test.mjs     exit 0 = all pass
import { blockAtOrBefore, blockTimestamp, etCloseUtc, headBlock } from './bsc.mjs';

let failed = 0;
const eq = (label, got, want) => {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: got ${got}, want ${want}`);
};

const head = await headBlock();
// 3 known blocks at very different heights. A timestamp equal to a block's own timestamp must return that block
// (or a later block sharing the same second, which the check below allows for).
for (const n of [30_000_000, 60_000_000, head - 1_000_000]) {
  const ts = await blockTimestamp(n);
  const got = await blockAtOrBefore(ts);
  const gotTs = await blockTimestamp(got);
  const nextTs = await blockTimestamp(got + 1);
  eq(`block ${n}: result timestamp <= ts`, gotTs <= ts, true);
  eq(`block ${n}: next block is after ts`, nextTs > ts, true);
  eq(`block ${n}: result is ${n} or shares its second`, got >= n && gotTs === ts, true);
}
// One second before a block: must return an earlier block.
{
  const n = 45_000_000;
  const ts = await blockTimestamp(n);
  const got = await blockAtOrBefore(ts - 1);
  eq(`ts-1 of block ${n} returns an earlier block`, got < n, true);
}
// Future timestamp must throw, not return the head.
{
  let threw = false;
  try {
    await blockAtOrBefore((await blockTimestamp(head)) + 10_000);
  } catch {
    threw = true;
  }
  eq('future timestamp throws', threw, true);
}
// 16:00 ET: EDT in August (UTC-4 -> 20:00Z), EST in January (UTC-5 -> 21:00Z).
eq('ET close 2026-08-14 (EDT)', new Date(etCloseUtc('2026-08-14') * 1000).toISOString(), '2026-08-14T20:00:00.000Z');
eq('ET close 2026-01-15 (EST)', new Date(etCloseUtc('2026-01-15') * 1000).toISOString(), '2026-01-15T21:00:00.000Z');

console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
