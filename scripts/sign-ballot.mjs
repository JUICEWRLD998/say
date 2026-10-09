// Mark a ballot by policy and sign it with a LOCAL EIP-712 key. This is the labelled fallback to the Agentic
// Wallet (`baw sign-message`), used while binance.com is unreachable. The signature is the same EIP-712 typed data.
//   node scripts/sign-ballot.mjs --init                       create .keys/voter.json (gitignored), print the address
//   node scripts/sign-ballot.mjs <meeting-dir> <policy>       mark, sign, verify, append to ballots.json
// policy: follow-board | against-outsized-pay | abstain-all | support-shareholder-proposals
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { POLICY_IDS, buildTypedData, mark, verifyBallot } from '../packages/core/src/index.ts';
import { ballotsToJson, loadBallots, readJson } from './lib.mjs';

const KEY = '.keys/voter.json';
const args = process.argv.slice(2);

if (args[0] === '--init') {
  if (existsSync(KEY)) {
    console.log(`exists: ${privateKeyToAccount(JSON.parse(readFileSync(KEY, 'utf8')).privateKey).address}`);
    process.exit(0);
  }
  mkdirSync('.keys', { recursive: true });
  const privateKey = generatePrivateKey();
  writeFileSync(KEY, JSON.stringify({ privateKey, note: 'local test signer for Say, holds no funds, never commit' }, null, 1));
  console.log(`created ${KEY}: ${privateKeyToAccount(privateKey).address}`);
  process.exit(0);
}

const [target, policy] = args;
if (!target || !POLICY_IDS.includes(policy)) {
  console.error(`usage: node scripts/sign-ballot.mjs <meeting-dir> <${POLICY_IDS.join('|')}>`);
  process.exit(2);
}
if (!existsSync(KEY)) {
  console.error('no key: run  node scripts/sign-ballot.mjs --init');
  process.exit(2);
}

const dir = resolve(target);
const meeting = readJson(dir, 'meeting.json');
const account = privateKeyToAccount(JSON.parse(readFileSync(KEY, 'utf8')).privateKey);

const marks = mark(policy, meeting.proposals);
const message = {
  meetingId: meeting.id,
  ticker: meeting.ticker,
  voter: account.address,
  recordBlock: BigInt(meeting.recordBlock),
  issuedAt: BigInt(Math.floor(Date.now() / 1000)),
  proposalIds: marks.map((m) => m.proposalId),
  choices: marks.map((m) => m.choice),
};
const typed = buildTypedData(message);
const signature = await account.signTypedData(typed);
const ballot = { message, signature };
if (!(await verifyBallot(ballot))) {
  console.error('signature did not verify against the voter. Not saved.');
  process.exit(1);
}

const file = resolve(dir, 'ballots.json');
const existing = existsSync(file) ? loadBallots(dir) : [];
writeFileSync(file, JSON.stringify(ballotsToJson([...existing, ballot]), null, 1));

const sfile = resolve(dir, 'signers.json');
const signers = existsSync(sfile) ? JSON.parse(readFileSync(sfile, 'utf8')) : {};
signers[account.address.toLowerCase()] = {
  label: 'local EIP-712 test key (fallback, not the Agentic Wallet)',
  holdsShares: 'unknown until weighed at the record block',
};
writeFileSync(sfile, JSON.stringify(signers, null, 1));

console.log(`signed ${meeting.id} as ${account.address} by policy ${policy}`);
for (const m of marks) console.log(`  ${m.proposalId}: ${m.choice}  (${m.reason})`);
