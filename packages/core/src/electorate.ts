import type { BalanceReader, Wrapper } from './types.ts';

const BSC = 56;
export const E18 = 10n ** 18n;

/** Parse a non-negative decimal string into a 1e18-scaled bigint. Throws on bad input. */
export function parseScaled(s: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,18})0*)?$/.exec(s.trim());
  if (!m) throw new Error(`bad multiplier: ${JSON.stringify(s)}`);
  const whole = BigInt(m[1]!);
  const frac = BigInt((m[2] ?? '').padEnd(18, '0'));
  return whole * E18 + frac;
}

/**
 * Real shares (1e18-scaled) represented by `balance` base units of one wrapper:
 * balance / 10^decimals * multiplier. Rounds down.
 */
export function sharesOf(wrapper: Wrapper, balance: bigint): bigint {
  if (balance < 0n) throw new Error('negative balance');
  return (balance * parseScaled(wrapper.multiplier)) / 10n ** BigInt(wrapper.decimals);
}

/**
 * Voting weight of `holder` at `block`: the sum over every BSC wrapper of the company.
 * Wrappers on other chains are ignored: a BSC record block says nothing about them.
 */
export function weight(
  holder: string,
  wrappers: readonly Wrapper[],
  block: bigint,
  read: BalanceReader,
): bigint {
  let total = 0n;
  for (const w of wrappers) {
    if (w.chainId !== BSC) continue;
    total += sharesOf(w, read(w, holder, block));
  }
  return total;
}
