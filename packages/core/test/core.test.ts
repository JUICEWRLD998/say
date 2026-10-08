import { describe, it, expect } from 'vitest';
import { keccak256, toHex, hexToBigInt, recoverTypedDataAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  mark,
  POLICY_IDS,
  parseScaled,
  sharesOf,
  weight,
  E18,
  buildTypedData,
  verifyBallot,
  isCanonicalSignature,
  SECP256K1_N,
  tally,
  type BalanceReader,
  type BallotMessage,
  type Choice,
  type Meeting,
  type PolicyId,
  type Proposal,
  type SignedBallot,
  type Wrapper,
} from '../src/index.ts';

// ---------- helpers ----------

const acct = (label: string) => privateKeyToAccount(keccak256(toHex(`say-test-key:${label}`)));

const wrap = (symbol: string, over: Partial<Wrapper> = {}): Wrapper => ({
  symbol,
  address: keccak256(toHex(symbol)).slice(0, 42),
  chainId: 56,
  decimals: 18,
  multiplier: '1',
  ...over,
});

const ON = wrap('TESTon');
const X = wrap('TESTx');
const ON10 = wrap('TESTon10', { multiplier: '10' });
const ELSEWHERE = wrap('TESTeth', { chainId: 1 });

/** Balance as a step function of block: the last entry at or before the block applies. */
function ledger(rows: [Wrapper, string, [bigint, bigint][]][]): BalanceReader {
  return (w, holder, block) => {
    const row = rows.find(([rw, h]) => rw.address === w.address && h.toLowerCase() === holder.toLowerCase());
    if (!row) return 0n;
    let bal = 0n;
    for (const [b, v] of row[2]) if (b <= block) bal = v;
    return bal;
  };
}

const p = (id: string, over: Partial<Proposal> = {}): Proposal => ({
  id,
  kind: 'other',
  text: id,
  quote: id,
  boardRec: 'FOR',
  ...over,
});

const MEETING: Meeting = {
  id: 'TEST-2026',
  ticker: 'TEST',
  cik: '0000000001',
  recordBlock: 1000n,
  closeBlock: 2000n,
  proposals: [p('p1'), p('p2')],
};

async function sign(
  who: string,
  choices: Choice[],
  over: Partial<BallotMessage> = {},
  meeting: Meeting = MEETING,
): Promise<SignedBallot> {
  const a = acct(who);
  const message: BallotMessage = {
    meetingId: meeting.id,
    ticker: meeting.ticker,
    voter: a.address,
    recordBlock: meeting.recordBlock,
    issuedAt: 1n,
    proposalIds: meeting.proposals.map((x) => x.id),
    choices,
    ...over,
  };
  return { message, signature: await a.signTypedData(buildTypedData(message)) };
}

// ---------- policy ----------

describe('policy engine', () => {
  const props: Proposal[] = [
    p('dir', { kind: 'director_election', boardRec: 'FOR' }),
    p('pay-high', { kind: 'say_on_pay', boardRec: 'FOR', meta: { ceoPayToPeerMedian: 1.4 } }),
    p('pay-low', { kind: 'say_on_pay', boardRec: 'FOR', meta: { ceoPayToPeerMedian: 0.8 } }),
    p('pay-nodata', { kind: 'equity_plan', boardRec: 'FOR' }),
    p('sh', { kind: 'shareholder', boardRec: 'AGAINST' }),
    p('norec', { kind: 'auditor', boardRec: null }),
  ];
  const choiceOf = (policy: PolicyId) => Object.fromEntries(mark(policy, props).map((m) => [m.proposalId, m.choice]));

  it('has the four documented policies', () => {
    expect([...POLICY_IDS].sort()).toEqual(
      ['abstain-all', 'against-outsized-pay', 'follow-board', 'support-shareholder-proposals'].sort(),
    );
  });

  it('follow-board copies the board and abstains when the filing gives no recommendation', () => {
    expect(choiceOf('follow-board')).toEqual({
      dir: 'FOR', 'pay-high': 'FOR', 'pay-low': 'FOR', 'pay-nodata': 'FOR', sh: 'AGAINST', norec: 'ABSTAIN',
    });
  });

  it('against-outsized-pay opposes pay above the peer median, supports at or below, abstains with no data', () => {
    const c = choiceOf('against-outsized-pay');
    expect(c['pay-high']).toBe('AGAINST');
    expect(c['pay-low']).toBe('FOR');
    expect(c['pay-nodata']).toBe('ABSTAIN');
    expect(c['dir']).toBe('FOR'); // non-pay items follow the board
    expect(c['norec']).toBe('ABSTAIN');
  });

  it('abstain-all abstains everywhere', () => {
    expect(new Set(Object.values(choiceOf('abstain-all')))).toEqual(new Set(['ABSTAIN']));
  });

  it('support-shareholder-proposals backs shareholder items against the board', () => {
    expect(choiceOf('support-shareholder-proposals')['sh']).toBe('FOR');
  });

  it('every mark carries a non-empty reason', () => {
    for (const id of POLICY_IDS) for (const m of mark(id, props)) expect(m.reason.length).toBeGreaterThan(0);
  });

  it('returns identical marks on 100 reruns', () => {
    for (const id of POLICY_IDS) {
      const first = JSON.stringify(mark(id, props));
      for (let i = 0; i < 100; i++) expect(JSON.stringify(mark(id, props))).toBe(first);
    }
  });

  it('rejects an unknown policy', () => {
    expect(() => mark('nope' as PolicyId, props)).toThrow(/unknown policy/);
  });
});

// ---------- electorate ----------

describe('electorate weight', () => {
  it('parses multipliers exactly', () => {
    expect(parseScaled('1')).toBe(E18);
    expect(parseScaled('10')).toBe(10n * E18);
    expect(parseScaled('1.000000000000000000')).toBe(E18);
    expect(parseScaled('0.5')).toBe(E18 / 2n);
    for (const bad of ['', '-1', 'abc', '1.', '1.1234567890123456789', '1e3']) {
      expect(() => parseScaled(bad)).toThrow(/bad multiplier/);
    }
  });

  it('a multiplier of 10 yields 10x the shares; the naive reading (ignore it) is 10x wrong', () => {
    const tokens = 10n * E18;
    expect(sharesOf(ON, tokens)).toBe(10n * E18);
    expect(sharesOf(ON10, tokens)).toBe(100n * E18);
    const naive = (w: Wrapper, bal: bigint) => (bal * E18) / 10n ** BigInt(w.decimals);
    expect(naive(ON10, tokens)).not.toBe(sharesOf(ON10, tokens)); // control: a multiplier-blind reader fails
  });

  it('handles non-18 decimals', () => {
    const eight = wrap('TEST8', { decimals: 8 });
    expect(sharesOf(eight, 5n * 10n ** 8n)).toBe(5n * E18);
  });

  it('sums every BSC wrapper and ignores other chains', () => {
    const who = acct('multi').address;
    const read = ledger([
      [ON, who, [[0n, 100n * E18]]],
      [ON10, who, [[0n, 10n * E18]]],
      [X, who, [[0n, 5n * E18]]],
      [ELSEWHERE, who, [[0n, 999n * E18]]],
    ]);
    expect(weight(who, [ON, ON10, X, ELSEWHERE], 1000n, read)).toBe(205n * E18);
  });

  it('reads the balance at the requested block', () => {
    const who = acct('stepper').address;
    const read = ledger([[ON, who, [[0n, 10n * E18], [1500n, 30n * E18]]]]);
    expect(weight(who, [ON], 1000n, read)).toBe(10n * E18);
    expect(weight(who, [ON], 1500n, read)).toBe(30n * E18);
  });
});

// ---------- ballot ----------

describe('ballot signing', () => {
  it('a signed ballot verifies', async () => {
    expect(await verifyBallot(await sign('alice', ['FOR', 'AGAINST']))).toBe(true);
  });

  it('changing a choice after signing breaks it', async () => {
    const b = await sign('alice', ['FOR', 'AGAINST']);
    b.message = { ...b.message, choices: ['AGAINST', 'AGAINST'] };
    expect(await verifyBallot(b)).toBe(false);
  });

  it('a ballot cannot be claimed by a different voter', async () => {
    const b = await sign('alice', ['FOR', 'FOR']);
    b.message = { ...b.message, voter: acct('mallory').address };
    expect(await verifyBallot(b)).toBe(false);
  });

  it('a signature does not replay on another meeting', async () => {
    const b = await sign('alice', ['FOR', 'FOR']);
    b.message = { ...b.message, meetingId: 'TEST-OTHER' };
    expect(await verifyBallot(b)).toBe(false);
  });

  it('rejects the malleable twin (high s) of a valid signature', async () => {
    const b = await sign('alice', ['FOR', 'FOR']);
    expect(isCanonicalSignature(b.signature)).toBe(true); // control: the original passes
    const r = b.signature.slice(0, 66);
    const s = hexToBigInt(`0x${b.signature.slice(66, 130)}`);
    const v = parseInt(b.signature.slice(130, 132), 16);
    const twin = `${r}${(SECP256K1_N - s).toString(16).padStart(64, '0')}${(v === 27 ? 28 : 27).toString(16)}` as Hex;
    // control: the twin recovers to the same signer on the raw curve, so only our check stops it
    const raw = await recoverTypedDataAddress({ ...buildTypedData(b.message), signature: twin });
    expect(raw.toLowerCase()).toBe(b.message.voter.toLowerCase());
    expect(isCanonicalSignature(twin)).toBe(false);
    expect(await verifyBallot({ ...b, signature: twin })).toBe(false);
  });

  it('garbage signatures return false and never throw', async () => {
    const b = await sign('alice', ['FOR', 'FOR']);
    for (const bad of ['', '0x', '0x1234', 'not hex', `0x${'00'.repeat(65)}`, `0x${'ff'.repeat(65)}`]) {
      expect(await verifyBallot({ ...b, signature: bad })).toBe(false);
    }
  });

  it('refuses to build typed data when lengths differ', () => {
    expect(() =>
      buildTypedData({
        meetingId: 'm', ticker: 't', voter: acct('alice').address, recordBlock: 1n, issuedAt: 1n,
        proposalIds: ['a', 'b'], choices: ['FOR'],
      }),
    ).toThrow(/differ in length/);
  });
});

// ---------- tally ----------

describe('tally', () => {
  const alice = acct('alice').address; // 100 from before record to close
  const bob = acct('bob').address; // buys AFTER the record date
  const carol = acct('carol').address; // 50 at record, sells all before close
  const dave = acct('dave').address; // 100 at record, sells 60 before close
  const erin = acct('erin').address; // 10 ON10 (= 100 shares) + 5 X at all times
  const zed = acct('zed').address; // rich, never signs anything

  const read = ledger([
    [ON, alice, [[0n, 100n * E18]]],
    [ON, bob, [[1500n, 100n * E18]]],
    [ON, carol, [[0n, 50n * E18], [1800n, 0n]]],
    [ON, dave, [[0n, 100n * E18], [1800n, 40n * E18]]],
    [ON10, erin, [[0n, 10n * E18]]],
    [X, erin, [[0n, 5n * E18]]],
    [ON, zed, [[0n, 1000n * E18]]],
  ]);
  const wrappers = [ON, X, ON10];

  async function ballots(): Promise<SignedBallot[]> {
    const alicePrior = await sign('alice', ['FOR', 'FOR'], { issuedAt: 1n });
    const aliceLatest = await sign('alice', ['AGAINST', 'FOR'], { issuedAt: 2n });
    return [
      alicePrior,
      aliceLatest,
      await sign('bob', ['AGAINST', 'AGAINST']),
      await sign('carol', ['AGAINST', 'AGAINST']),
      await sign('dave', ['FOR', 'FOR']),
      await sign('erin', ['ABSTAIN', 'FOR']),
    ];
  }

  it('counts record-date weight across wrappers, with the multiplier', async () => {
    const r = await tally(MEETING, wrappers, await ballots(), read);
    expect(r.totals['p1']).toEqual({ FOR: (40n * E18).toString(), AGAINST: (100n * E18).toString(), ABSTAIN: (105n * E18).toString() });
    expect(r.totals['p2']).toEqual({ FOR: (245n * E18).toString(), AGAINST: '0', ABSTAIN: '0' });
    expect(r.counted.map((c) => c.weightE18).sort()).toEqual(
      [100n * E18, 40n * E18, 105n * E18].map(String).sort(),
    );
  });

  it('a wallet that bought after the record date weighs 0 and is shown as voice only', async () => {
    const r = await tally(MEETING, wrappers, await ballots(), read);
    const v = r.voice.find((x) => x.voter.toLowerCase() === bob.toLowerCase());
    expect(v?.reason).toBe('zero_at_record_date');
    expect(r.counted.some((c) => c.voter.toLowerCase() === bob.toLowerCase())).toBe(false);
    // control: a reader that ignores the record date would have counted bob at 100 shares
    const naiveBob = weight(bob, wrappers, MEETING.closeBlock, read);
    expect(naiveBob).toBe(100n * E18);
  });

  it('a voter who sold everything before close is dropped, and a partial seller is capped at what is left', async () => {
    const r = await tally(MEETING, wrappers, await ballots(), read);
    expect(r.voice.find((x) => x.voter.toLowerCase() === carol.toLowerCase())?.reason).toBe('sold_before_close');
    expect(r.counted.find((c) => c.voter.toLowerCase() === dave.toLowerCase())?.weightE18).toBe((40n * E18).toString());
  });

  it('two ballots from one voter count once: the latest', async () => {
    const r = await tally(MEETING, wrappers, await ballots(), read);
    const aliceRows = r.counted.filter((c) => c.voter.toLowerCase() === alice.toLowerCase());
    expect(aliceRows).toHaveLength(1);
    expect(aliceRows[0]!.choices['p1']).toBe('AGAINST');
    expect(r.rejected.filter((x) => x.reason === 'superseded')).toHaveLength(1);
  });

  it('rejects a forged signature, and a forgery cannot displace the real ballot', async () => {
    const real = await sign('alice', ['AGAINST', 'FOR'], { issuedAt: 2n });
    const forgedWithBobKey = await sign('bob', ['FOR', 'FOR'], { issuedAt: 99n, voter: alice }); // bob signs, claims alice
    const forgedForZed = await sign('alice', ['FOR', 'FOR'], { issuedAt: 5n, voter: zed }); // alice signs, claims zed (1000 shares)
    const r = await tally(MEETING, wrappers, [real, forgedWithBobKey, forgedForZed], read);
    expect(r.rejected.map((x) => x.reason).sort()).toEqual(['bad signature', 'bad signature']);
    expect(r.counted).toHaveLength(1);
    expect(r.counted[0]!.choices['p1']).toBe('AGAINST');
    expect(r.totals['p1']!.FOR).toBe('0');
  });

  it('rejects ballots for another meeting, ticker, record block, proposal set, or an invalid choice', async () => {
    const other: Meeting = { ...MEETING, id: 'TEST-OTHER' };
    const cases: [SignedBallot, string][] = [
      [await sign('alice', ['FOR', 'FOR'], {}, other), 'wrong meeting'],
      [await sign('alice', ['FOR', 'FOR'], { ticker: 'XXXX' }), 'wrong ticker'],
      [await sign('alice', ['FOR', 'FOR'], { recordBlock: 999n }), 'wrong record block'],
      [await sign('alice', ['FOR'], { proposalIds: ['p1'] }), 'proposal set differs'],
      [await sign('alice', ['FOR', 'FOR'], { proposalIds: ['p1', 'p1'] }), 'proposal set differs'],
      [await sign('alice', ['FOR', 'MAYBE' as Choice]), 'invalid choice'],
    ];
    for (const [b, reason] of cases) {
      const r = await tally(MEETING, wrappers, [b], read);
      expect(r.rejected).toEqual([{ index: 0, reason }]);
      expect(r.counted).toHaveLength(0);
    }
  });

  it('gives the same result in any ballot order', async () => {
    const all = await ballots();
    const a = await tally(MEETING, wrappers, all, read);
    const b = await tally(MEETING, wrappers, [...all].reverse(), read);
    const c = await tally(MEETING, wrappers, [all[3]!, all[0]!, all[5]!, all[1]!, all[4]!, all[2]!], read);
    for (const r of [b, c]) {
      expect(r.totals).toEqual(a.totals);
      expect(r.counted).toEqual(a.counted);
      expect(r.voice).toEqual(a.voice);
    }
  });

  it('an empty ballot box tallies to zero', async () => {
    const r = await tally(MEETING, wrappers, [], read);
    expect(r.counted).toEqual([]);
    expect(r.totals['p1']).toEqual({ FOR: '0', AGAINST: '0', ABSTAIN: '0' });
  });
});
