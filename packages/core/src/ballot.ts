import { hashTypedData, recoverTypedDataAddress, getAddress, hexToBigInt, type Hex } from 'viem';
import type { BallotMessage, Choice, SignedBallot } from './types.ts';

/** secp256k1 group order. A signature with s above half of it is the malleable twin of a valid one. */
export const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

export const DOMAIN = { name: 'Say Ballot', version: '1', chainId: 56 } as const;

export const TYPES = {
  Ballot: [
    { name: 'meetingId', type: 'string' },
    { name: 'ticker', type: 'string' },
    { name: 'voter', type: 'address' },
    { name: 'recordBlock', type: 'uint256' },
    { name: 'issuedAt', type: 'uint256' },
    { name: 'proposalIds', type: 'string[]' },
    { name: 'choices', type: 'string[]' },
  ],
} as const;

export const CHOICES: readonly Choice[] = ['FOR', 'AGAINST', 'ABSTAIN'];

export function buildTypedData(m: BallotMessage) {
  if (m.proposalIds.length !== m.choices.length) throw new Error('proposalIds and choices differ in length');
  return {
    domain: DOMAIN,
    types: TYPES,
    primaryType: 'Ballot' as const,
    message: {
      meetingId: m.meetingId,
      ticker: m.ticker,
      voter: getAddress(m.voter),
      recordBlock: m.recordBlock,
      issuedAt: m.issuedAt,
      proposalIds: m.proposalIds,
      choices: m.choices as string[],
    },
  };
}

export function ballotHash(m: BallotMessage): Hex {
  return hashTypedData(buildTypedData(m));
}

/** True when the 65-byte signature has the canonical low-s form and a valid v. */
export function isCanonicalSignature(sig: string): boolean {
  if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) return false;
  const s = hexToBigInt(`0x${sig.slice(66, 130)}`);
  const v = parseInt(sig.slice(130, 132), 16);
  return s > 0n && s <= SECP256K1_N / 2n && (v === 27 || v === 28 || v === 0 || v === 1);
}

/** Recover the signer. Returns null for a non-canonical or unrecoverable signature. */
export async function recoverSigner(b: SignedBallot): Promise<string | null> {
  if (!isCanonicalSignature(b.signature)) return null;
  try {
    return await recoverTypedDataAddress({ ...buildTypedData(b.message), signature: b.signature as Hex });
  } catch {
    return null;
  }
}

/** A ballot is valid when the recovered signer is the voter named inside the message. */
export async function verifyBallot(b: SignedBallot): Promise<boolean> {
  try {
    const signer = await recoverSigner(b);
    return signer !== null && signer.toLowerCase() === b.message.voter.toLowerCase();
  } catch {
    return false;
  }
}
