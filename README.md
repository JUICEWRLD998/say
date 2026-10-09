# Say

Own the share. Have your say.

Tokenized stocks give you the price but take away your vote. Say reads each proxy statement for the companies you hold on BNB Chain, marks your ballot by a policy you chose, and signs it with your Agentic Wallet. The tally is weighted by on-chain shares at the company's record date, and anyone can recount it.

Status: Phase 4 (unattended agent pass, intake read, labelled local-key signing; Agentic Wallet and Agent Studio not used).

By Mustapha Fadhlullah, independent security researcher.

## Layout

- `packages/core`: policy engine, electorate, EIP-712 ballot, tally. Pure, no network. `pnpm test`.
- `packages/proxy`: proxy text to a structured meeting, then seven deterministic checks. Pure, no network.
- `scripts/edgar-scan.mjs`: watcher. Lists DEF 14A and DEFA14A filings for every BSC ticker with an SEC filer and reports what is new.
- `scripts/edgar-parse.mjs`: parses each DEF 14A and writes the meeting calendar `fixtures/edgar/meetings.json`.
- `scripts/bsc.mjs`: timestamp to BSC block (`pnpm bsc:test`). `scripts/open-ballots.mjs`: writes `meetings/<TICKER>-<meetingDate>/` for each ready meeting.
- `scripts/sign-ballot.mjs` (labelled local EIP-712 fallback signer), `scripts/tally-meeting.mjs`, `scripts/electorate.mjs` (real-holder test reads), `scripts/recount-all.mjs`.
- `scripts/agent.mjs`: one unattended pass (scan, parse, open, tally, close, recount) with a reason logged per action in `agent-log.jsonl`. `.github/workflows/agent.yml` runs it every 6 hours. `scripts/my-meetings.mjs <address>` answers "which of my stocks vote?".
- `scripts/doh-preload.cjs`: resolves `*.binance.com` over DNS-over-HTTPS for ISPs that block it.
- `meetings/`: the public record. 10 open ballots with record blocks resolved from 16:00 ET on the record date.
- `fixtures/edgar/gold/`: hand-checked expected output for 10 real filings. `fixtures/edgar/text/`: the filing text they are checked against.

## Proxy parser: what is trusted

The extractor is not trusted. Every meeting passes seven checks before it can become a ballot:

1. record date present and printed next to "record date" in the filing
2. meeting date present and printed in the filing
3. record date before meeting date
4. every proposal quote is a verbatim span of the filing
5. every board recommendation has a verbatim sentence carrying the same word (FOR, AGAINST, ABSTAIN)
6. proposal ids are 1..n
7. n equals the highest proposal number the filing itself mentions

A meeting that fails any check is `needs_review` and is not shown as a ballot. Run `pnpm edgar:parse` to see which ones and why.

Current result on the 24 DEF 14A filed 2026-07-15 to 2026-10-07: 10 ready, 14 needs_review. The 14 are layouts the extractor does not read yet (for example proposals that exist only on the proxy card). They are held back, not guessed.

The extractor is deterministic and runs without an LLM. An LLM extractor can be plugged in behind the same `Extractor` type; it would pass through the same seven checks.
