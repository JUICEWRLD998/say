// Phase 3: open a ballot for every `ready` meeting. Resolves the record date to a BSC block and writes
// meetings/<TICKER>-<meetingDate>/{meeting,wrappers}.json (the public record). bigints travel as decimal strings.
//   node scripts/open-ballots.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { blockAtOrBefore, blockTimestamp, etCloseUtc } from './bsc.mjs';

const { meetings } = JSON.parse(readFileSync('fixtures/edgar/meetings.json', 'utf8'));
const all = JSON.parse(readFileSync('fixtures/bsc-wrappers.json', 'utf8'));
const now = Math.floor(Date.now() / 1000);

let opened = 0;
for (const m of meetings.filter((x) => x.status === 'ready')) {
  const id = `${m.ticker}-${m.meetingDate}`;
  const cutoff = etCloseUtc(m.recordDate);
  if (cutoff > now) {
    console.log(`SKIP ${id}: record date ${m.recordDate} is not past yet`);
    continue;
  }
  const recordBlock = await blockAtOrBefore(cutoff);
  const recordTs = await blockTimestamp(recordBlock);
  const wrappers = all
    .filter((w) => w.ticker === m.ticker)
    .map((w) => ({ symbol: w.symbol, address: w.address, chainId: 56, decimals: w.decimals, multiplier: w.multiplier }));

  const meeting = {
    id,
    ticker: m.ticker,
    cik: m.cik,
    company: m.company,
    status: 'open',
    recordDate: m.recordDate,
    recordCutoff: new Date(cutoff * 1000).toISOString(),
    recordCutoffRule: '16:00 America/New_York on the record date (close of business assumed; the filing is not parsed for a time)',
    recordBlock: String(recordBlock),
    recordBlockTimestamp: new Date(recordTs * 1000).toISOString(),
    meetingDate: m.meetingDate,
    // The ballot closes at the start of the meeting date (UTC). The close block is resolved when that moment passes.
    closeAt: `${m.meetingDate}T00:00:00.000Z`,
    closeBlock: null,
    filing: { form: 'DEF 14A', filingDate: m.filingDate, accession: m.accession, url: m.url },
    proposals: m.proposals.map(({ id: pid, kind, text, quote, boardRec }) => ({ id: pid, kind, text, quote, boardRec })),
  };
  const dir = `meetings/${id}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/meeting.json`, JSON.stringify(meeting, null, 1));
  writeFileSync(`${dir}/wrappers.json`, JSON.stringify(wrappers, null, 1));
  console.log(`OPEN ${id.padEnd(16)} record ${m.recordDate} -> block ${recordBlock} (${meeting.recordBlockTimestamp}) proposals ${meeting.proposals.length} wrappers ${wrappers.length}`);
  opened++;
}
console.log(`opened ${opened} ballots`);
