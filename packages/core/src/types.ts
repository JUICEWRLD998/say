export type Choice = 'FOR' | 'AGAINST' | 'ABSTAIN';

export type ProposalKind =
  | 'director_election'
  | 'say_on_pay'
  | 'auditor'
  | 'equity_plan'
  | 'shareholder'
  | 'other';

export interface Proposal {
  id: string;
  kind: ProposalKind;
  text: string;
  /** Verbatim span from the filing. The parser checks that it exists in the source text. */
  quote: string;
  /** Board recommendation as printed in the proxy; null when the filing gives none. */
  boardRec: Choice | null;
  /** Optional facts a policy may need, for example { ceoPayToPeerMedian: 1.4 }. */
  meta?: Record<string, number>;
}

export interface Meeting {
  id: string;
  ticker: string;
  cik: string;
  /** Block on BSC (chain 56) whose state defines the electorate. */
  recordBlock: bigint;
  /** Ballot closes at this block. Holdings are re-read here. */
  closeBlock: bigint;
  proposals: Proposal[];
}

export type PolicyId =
  | 'follow-board'
  | 'against-outsized-pay'
  | 'abstain-all'
  | 'support-shareholder-proposals';

export interface Mark {
  proposalId: string;
  choice: Choice;
  reason: string;
}

/** One tokenized wrapper of a company (Ondo `on`, xStocks `x`, bStock `B`, pre-IPO). */
export interface Wrapper {
  symbol: string;
  address: string;
  chainId: number;
  decimals: number;
  /** Decimal string as the RWA API reports it, for example "1", "10", "1.000000000000000000". */
  multiplier: string;
}

/** Injected by the caller. The core never touches the network. */
export type BalanceReader = (wrapper: Wrapper, holder: string, block: bigint) => bigint;

export interface BallotMessage {
  meetingId: string;
  ticker: string;
  voter: string;
  recordBlock: bigint;
  /** Unix seconds. The latest ballot per voter wins. */
  issuedAt: bigint;
  proposalIds: string[];
  choices: Choice[];
}

export interface SignedBallot {
  message: BallotMessage;
  signature: string;
}
