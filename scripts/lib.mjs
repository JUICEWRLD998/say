// Shared loaders for fixtures/meetings/<id>/. bigints travel as decimal strings in JSON.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const readJson = (dir, file) => JSON.parse(readFileSync(join(dir, file), 'utf8'));

export function loadMeeting(dir) {
  const m = readJson(dir, 'meeting.json');
  return { ...m, recordBlock: BigInt(m.recordBlock), closeBlock: BigInt(m.closeBlock) };
}

export const loadWrappers = (dir) => readJson(dir, 'wrappers.json');

export const loadBallots = (dir) =>
  readJson(dir, 'ballots.json').map((b) => ({
    signature: b.signature,
    message: { ...b.message, recordBlock: BigInt(b.message.recordBlock), issuedAt: BigInt(b.message.issuedAt) },
  }));

export const ballotsToJson = (ballots) =>
  ballots.map((b) => ({
    signature: b.signature,
    message: { ...b.message, recordBlock: b.message.recordBlock.toString(), issuedAt: b.message.issuedAt.toString() },
  }));

/**
 * Strict balance reader over a snapshot file. A (wrapper, holder) pair with no row throws, so a missing
 * read can never pass as a zero balance. A row with empty steps is an explicit zero.
 */
export function readerFromSnapshot(dir) {
  const rows = readJson(dir, 'balances.json');
  return (wrapper, holder, block) => {
    const row = rows.find(
      (r) => r.wrapper.toLowerCase() === wrapper.address.toLowerCase() && r.holder.toLowerCase() === holder.toLowerCase(),
    );
    if (!row) throw new Error(`snapshot has no row for ${wrapper.symbol} / ${holder}`);
    let bal = 0n;
    for (const [b, v] of row.steps) if (BigInt(b) <= block) bal = BigInt(v);
    return bal;
  };
}

/** Key-sorted JSON, so two tallies compare equal exactly when their content is equal. */
export function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}
