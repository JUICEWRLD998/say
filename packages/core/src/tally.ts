import { verifyBallot, CHOICES } from './ballot.ts';
import { weight } from './electorate.ts';
import type { BalanceReader, Choice, Meeting, SignedBallot, Wrapper } from './types.ts';

export interface Counted {
  voter: string;
  /** 1e18-scaled real shares, as a decimal string. */
  weightE18: string;
  recordE18: string;
  closeE18: string;
  issuedAt: string;
  choices: Record<string, Choice>;
}

export interface Voice {
  voter: string;
  reason: 'zero_at_record_date' | 'sold_before_close';
  recordE18: string;
  closeE18: string;
}

export interface Rejected {
  index: number;
  reason: string;
}

export interface TallyResult {
  meetingId: string;
  /** proposalId -> choice -> 1e18-scaled shares as a decimal string. */
  totals: Record<string, Record<Choice, string>>;
  counted: Counted[];
  voice: Voice[];
  rejected: Rejected[];
}

function structuralError(b: SignedBallot, m: Meeting): string | null {
  const { message } = b;
  if (message.meetingId !== m.id) return 'wrong meeting';
  if (message.ticker !== m.ticker) return 'wrong ticker';
  if (message.recordBlock !== m.recordBlock) return 'wrong record block';
  if (message.proposalIds.length !== message.choices.length) return 'length mismatch';
  const want = m.proposals.map((p) => p.id);
  if (message.proposalIds.length !== want.length) return 'proposal set differs';
  const seen = new Set(message.proposalIds);
  if (seen.size !== want.length || !want.every((id) => seen.has(id))) return 'proposal set differs';
  if (!message.choices.every((c) => CHOICES.includes(c))) return 'invalid choice';
  return null;
}

const byVoter = (x: SignedBallot, y: SignedBallot) =>
  x.message.voter.toLowerCase() < y.message.voter.toLowerCase() ? -1 : 1;

/**
 * Deterministic: the same ballots and balances give the same result, in any input order.
 * Weight = min(shares at record block, shares at close block). Anyone who bought after the record date
 * weighs 0, and anyone who sold before close is capped at what they still hold.
 */
export async function tally(
  meeting: Meeting,
  wrappers: readonly Wrapper[],
  ballots: readonly SignedBallot[],
  read: BalanceReader,
): Promise<TallyResult> {
  const rejected: Rejected[] = [];
  const valid: { b: SignedBallot; index: number }[] = [];

  for (let i = 0; i < ballots.length; i++) {
    const b = ballots[i]!;
    const bad = structuralError(b, meeting);
    if (bad) {
      rejected.push({ index: i, reason: bad });
      continue;
    }
    if (!(await verifyBallot(b))) {
      rejected.push({ index: i, reason: 'bad signature' });
      continue;
    }
    valid.push({ b, index: i });
  }

  // One latest ballot per voter. Ties break on signature text so input order never matters.
  const latest = new Map<string, SignedBallot>();
  for (const { b } of valid) {
    const k = b.message.voter.toLowerCase();
    const cur = latest.get(k);
    if (
      !cur ||
      b.message.issuedAt > cur.message.issuedAt ||
      (b.message.issuedAt === cur.message.issuedAt && b.signature > cur.signature)
    ) {
      latest.set(k, b);
    }
  }
  for (const { b, index } of valid) {
    if (latest.get(b.message.voter.toLowerCase()) !== b) rejected.push({ index, reason: 'superseded' });
  }

  const totals: TallyResult['totals'] = {};
  for (const p of meeting.proposals) totals[p.id] = { FOR: '0', AGAINST: '0', ABSTAIN: '0' };

  const counted: Counted[] = [];
  const voice: Voice[] = [];
  for (const b of [...latest.values()].sort(byVoter)) {
    const voter = b.message.voter;
    const atRecord = weight(voter, wrappers, meeting.recordBlock, read);
    const atClose = weight(voter, wrappers, meeting.closeBlock, read);
    const w = atRecord < atClose ? atRecord : atClose;
    const base = { voter, recordE18: atRecord.toString(), closeE18: atClose.toString() };
    if (w === 0n) {
      voice.push({ ...base, reason: atRecord === 0n ? 'zero_at_record_date' : 'sold_before_close' });
      continue;
    }
    const choices: Record<string, Choice> = {};
    b.message.proposalIds.forEach((id, i) => {
      const c = b.message.choices[i]!;
      choices[id] = c;
      const t = totals[id]!;
      t[c] = (BigInt(t[c]) + w).toString();
    });
    counted.push({ ...base, weightE18: w.toString(), issuedAt: b.message.issuedAt.toString(), choices });
  }

  rejected.sort((a, b) => a.index - b.index);
  return { meetingId: meeting.id, totals, counted, voice, rejected };
}
