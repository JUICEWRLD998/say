// Build the balance snapshot and the tally for one meeting from its ballots and public archive reads.
//   node scripts/tally-meeting.mjs <meeting-dir>
// Open meeting: weight = min(shares at record block, shares at the head block now); the head block is stored as
// provisionalCloseBlock so the tally is reproducible. Closed meeting (closeAt passed): the close block is fixed.
// Writes balances.json and tally.json. Check with:  node scripts/recount.mjs <meeting-dir>
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tally } from '../packages/core/src/index.ts';
import { balanceOfAt, blockAtOrBefore, headBlock } from './bsc.mjs';
import { loadBallots, loadMeeting, loadWrappers, readJson, readerFromSnapshot } from './lib.mjs';

const dir = resolve(process.argv[2] ?? '');
const raw = readJson(dir, 'meeting.json');

// Fix the close block.
if (raw.closeBlock === null) {
  const closeAt = Date.parse(raw.closeAt) / 1000;
  if (Date.now() / 1000 >= closeAt) {
    raw.closeBlock = String(await blockAtOrBefore(closeAt));
    raw.status = 'closed';
    delete raw.provisionalCloseBlock;
  } else {
    raw.provisionalCloseBlock = String(await headBlock());
  }
  writeFileSync(resolve(dir, 'meeting.json'), JSON.stringify(raw, null, 1));
}

const meeting = loadMeeting(dir);
const wrappers = loadWrappers(dir);
const ballots = existsSync(resolve(dir, 'ballots.json')) ? loadBallots(dir) : [];
const voters = [...new Set(ballots.map((b) => b.message.voter))];

const rec = Number(meeting.recordBlock);
const close = Number(meeting.closeBlock);
const rows = [];
for (const voter of voters) {
  for (const w of wrappers) {
    const atRecord = await balanceOfAt(w.address, voter, rec);
    const atClose = close === rec ? atRecord : await balanceOfAt(w.address, voter, close);
    const steps = [[String(rec), atRecord.toString()]];
    if (close !== rec) steps.push([String(close), atClose.toString()]);
    rows.push({ wrapper: w.address, holder: voter, steps });
  }
}
writeFileSync(resolve(dir, 'balances.json'), JSON.stringify(rows, null, 1));

const result = await tally(meeting, wrappers, ballots, readerFromSnapshot(dir));
writeFileSync(resolve(dir, 'tally.json'), JSON.stringify(result, null, 1));

console.log(`${meeting.id}: record block ${meeting.recordBlock}, ${raw.closeBlock === null ? `provisional close ${raw.provisionalCloseBlock}` : `close ${raw.closeBlock}`}`);
console.log(`ballots=${ballots.length} counted=${result.counted.length} voice=${result.voice.length} rejected=${result.rejected.length}`);
for (const v of result.voice) console.log(`  voice only: ${v.voter} (${v.reason})`);
