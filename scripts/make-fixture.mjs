// Builds fixtures/meetings/synthetic-2026/: a self-contained, deterministic test meeting.
// Keys derive from public labels and are for tests only. Nothing here is a real vote.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { buildTypedData, tally, E18 } from '../packages/core/src/index.ts';
import { ballotsToJson, loadBallots, loadMeeting, loadWrappers, readerFromSnapshot } from './lib.mjs';

const out = join(import.meta.dirname, '..', 'fixtures', 'meetings', 'synthetic-2026');
mkdirSync(out, { recursive: true });
const write = (f, v) => writeFileSync(join(out, f), JSON.stringify(v, null, 1) + '\n');

const acct = (label) => privateKeyToAccount(keccak256(toHex(`say-test-key:${label}`)));
const wrap = (symbol, multiplier = '1') => ({
  symbol, address: keccak256(toHex(symbol)).slice(0, 42), chainId: 56, decimals: 18, multiplier,
});
const ON = wrap('SYNon'), X = wrap('SYNx'), ON10 = wrap('SYNon10', '10');

const meeting = {
  id: 'synthetic-2026', ticker: 'SYN', cik: '0000000000', recordBlock: '1000', closeBlock: '2000',
  proposals: [
    { id: 'p1', kind: 'director_election', text: 'Elect the nominee', quote: 'Elect the nominee', boardRec: 'FOR' },
    { id: 'p2', kind: 'say_on_pay', text: 'Advisory pay vote', quote: 'Advisory pay vote', boardRec: 'FOR' },
  ],
};

const e = (n) => (BigInt(n) * E18).toString();
const holdings = {
  alice: [[ON, [['0', e(100)]]]],
  bob: [[ON, [['1500', e(100)]]]], // buys after the record date
  carol: [[ON, [['0', e(50)], ['1800', '0']]]], // sells before close
  dave: [[ON, [['0', e(100)], ['1800', e(40)]]]], // partial sell
  erin: [[ON10, [['0', e(10)]]], [X, [['0', e(5)]]]],
};
const wrappers = [ON, X, ON10];
const balances = [];
for (const who of Object.keys(holdings)) {
  for (const w of wrappers) {
    const have = holdings[who].find(([hw]) => hw.address === w.address);
    balances.push({ wrapper: w.address, holder: acct(who).address, steps: have ? have[1] : [] });
  }
}

async function ballot(who, choices, issuedAt) {
  const a = acct(who);
  const message = {
    meetingId: meeting.id, ticker: meeting.ticker, voter: a.address, recordBlock: BigInt(meeting.recordBlock),
    issuedAt: BigInt(issuedAt), proposalIds: meeting.proposals.map((p) => p.id), choices,
  };
  return { message, signature: await a.signTypedData(buildTypedData(message)) };
}
const ballots = [
  await ballot('alice', ['FOR', 'FOR'], 1),
  await ballot('alice', ['AGAINST', 'FOR'], 2),
  await ballot('bob', ['AGAINST', 'AGAINST'], 1),
  await ballot('carol', ['AGAINST', 'AGAINST'], 1),
  await ballot('dave', ['FOR', 'FOR'], 1),
  await ballot('erin', ['ABSTAIN', 'FOR'], 1),
];

write('meeting.json', meeting);
write('wrappers.json', wrappers);
write('balances.json', balances);
write('ballots.json', ballotsToJson(ballots));

// Publish the tally through the same loaders recount.mjs uses, so the two cannot drift apart.
const result = await tally(loadMeeting(out), loadWrappers(out), loadBallots(out), readerFromSnapshot(out));
write('tally.json', result);
console.log(`wrote ${out}`);
console.log(`counted=${result.counted.length} voice=${result.voice.length} rejected=${result.rejected.length}`);
