import type { Choice, Mark, PolicyId, Proposal } from './types.ts';

type Rule = (p: Proposal) => { choice: Choice; reason: string };

const board: Rule = (p) =>
  p.boardRec
    ? { choice: p.boardRec, reason: `board recommends ${p.boardRec}` }
    : { choice: 'ABSTAIN', reason: 'no board recommendation in the filing' };

const POLICIES: Record<PolicyId, Rule> = {
  'follow-board': board,

  'against-outsized-pay': (p) => {
    if (p.kind !== 'say_on_pay' && p.kind !== 'equity_plan') return board(p);
    const ratio = p.meta?.['ceoPayToPeerMedian'];
    if (ratio === undefined) return { choice: 'ABSTAIN', reason: 'no pay data to apply the rule' };
    return ratio > 1
      ? { choice: 'AGAINST', reason: `CEO pay is ${ratio}x the peer median` }
      : { choice: 'FOR', reason: `CEO pay is ${ratio}x the peer median, not above it` };
  },

  'abstain-all': () => ({ choice: 'ABSTAIN', reason: 'policy abstains on every proposal' }),

  'support-shareholder-proposals': (p) =>
    p.kind === 'shareholder'
      ? { choice: 'FOR', reason: 'policy supports shareholder proposals' }
      : board(p),
};

export const POLICY_IDS = Object.keys(POLICIES) as PolicyId[];

/** Pure and deterministic. The LLM never runs here. */
export function mark(policy: PolicyId, proposals: readonly Proposal[]): Mark[] {
  const rule = POLICIES[policy];
  if (!rule) throw new Error(`unknown policy: ${String(policy)}`);
  return proposals.map((p) => {
    const r = rule(p);
    return { proposalId: p.id, choice: r.choice, reason: r.reason };
  });
}
