// Rebuild a meeting's tally from its ballots and balance snapshot, and compare with the published tally.
//   node scripts/recount.mjs <meeting-dir>            exit 0 = match, 1 = DIFF, 2 = error
//   node scripts/recount.mjs <meeting-dir> --control  corrupt one ballot; exit 0 only if the diff is detected
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { tally } from '../packages/core/src/index.ts';
import { canon, loadBallots, loadMeeting, loadWrappers, readerFromSnapshot, readJson } from './lib.mjs';

const args = process.argv.slice(2);
const control = args.includes('--control');
const target = args.find((a) => !a.startsWith('--'));
if (!target) {
  console.error('usage: node scripts/recount.mjs <meeting-dir> [--control]');
  process.exit(2);
}
const dir = resolve(target);

try {
  const meeting = loadMeeting(dir);
  const wrappers = loadWrappers(dir);
  const ballots = loadBallots(dir);
  const read = readerFromSnapshot(dir);
  const published = readJson(dir, 'tally.json');

  if (control) {
    // Planted control: flip one choice after signing. The signature no longer matches, so the recount
    // must differ from the published tally. If it does not, this script cannot be trusted to find diffs.
    const first = ballots[0];
    first.message.choices = first.message.choices.map((c) => (c === 'FOR' ? 'AGAINST' : 'FOR'));
  }

  const result = await tally(meeting, wrappers, ballots, read);
  const same = canon(result) === canon(published);
  const digest = createHash('sha256').update(canon(result)).digest('hex').slice(0, 16);

  console.log(`meeting ${meeting.id} (${meeting.ticker}) record block ${meeting.recordBlock}, close block ${meeting.closeBlock}`);
  console.log(`ballots=${ballots.length} counted=${result.counted.length} voice=${result.voice.length} rejected=${result.rejected.length}`);
  for (const [id, t] of Object.entries(result.totals)) {
    const sh = (x) => (BigInt(x) / 10n ** 18n).toString();
    console.log(`  ${id}: FOR ${sh(t.FOR)}  AGAINST ${sh(t.AGAINST)}  ABSTAIN ${sh(t.ABSTAIN)}  (real shares)`);
  }
  console.log(`recount sha256[0:16] = ${digest}`);

  if (control) {
    if (same) {
      console.error('CONTROL FAILED: a corrupted ballot did not change the tally. The recount is blind.');
      process.exit(3);
    }
    console.log('CONTROL OK: a corrupted ballot changed the tally, so a diff is detectable.');
    process.exit(0);
  }
  if (same) {
    console.log('RECOUNT MATCH: the published tally is reproduced exactly.');
    process.exit(0);
  }
  console.error('RECOUNT DIFF: the published tally does not match the recount.');
  process.exit(1);
} catch (e) {
  console.error(`recount error: ${e.message}`);
  process.exit(2);
}
