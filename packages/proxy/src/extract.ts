import type { Choice, ProposalKind } from '@say/core';
import { datesAfter, datesBefore, mode } from './dates.ts';
import type { ExtractedProposal, Extractor } from './types.ts';

/**
 * Deterministic extractor for proxies that print numbered "Proposal N" / "Item N" headings.
 * An LLM extractor can replace it behind the same `Extractor` type; every output is re-checked in checks.ts.
 */

// A heading is "Proposal 2", "PROPOSAL NO. 3:", "Item 4." followed by a title that starts with a capital.
// "Item 402(v) of Regulation S-K" and "Proposal 1)" do not match: the number is followed by "(" or ")" or a regulation word.
export const HEADING_RE =
  /\b(?:PROPOSAL|Proposal|ITEM|Item)\s+(?:N\s?[Oo]\s?\.\s*)?(\d{1,2})(?![\d(),])\s*[:.|\-]?\s*(?!of\s|and\s|to\s|is\s|are\s|in\s|will\s|that\s|\)|,)(?=([A-Z][^|]{4,200}))/g;

const REC_RE =
  /recommends?(?:\s+that)?(?:\s+(?:stockholders|shareholders|you))?(?:\s+to)?\s+(?:a\s+)?vote(?:\s+your\s+shares)?\s+["']?\s*(FOR|AGAINST|ABSTAIN)\b/i;
const REC_IN_FAVOR_RE = /recommends?\s+that\s+you\s+vote\s+in\s+favor/i;

export function classify(title: string): ProposalKind {
  const t = title.toLowerCase();
  if (/elect(ion)? of .{0,40}(director|nominee)|elect .*director/.test(t)) return 'director_election';
  if (/(stockholder|shareholder) proposal|requesting/.test(t)) return 'shareholder';
  if (/advisory (vote|basis|resolution)|say[- ]on[- ]pay|executive compensation|named executive officer compensation|compensation of .{0,40}named executive/.test(t)) return 'say_on_pay';
  if (/ratif|independent registered public accounting|auditor/.test(t)) return 'auditor';
  if (/incentive plan|equity (incentive )?plan|stock (option|purchase|incentive) plan|employee stock|share plan|omnibus/.test(t)) return 'equity_plan';
  return 'other';
}

/** Title decides first. A resolution by a proponent marks a shareholder proposal whose title does not say so. */
export function classifySection(title: string, sectionStart: string): ProposalKind {
  const byTitle = classify(title);
  if (byTitle !== 'other') return byTitle;
  // "RESOLVED" alone is not enough: management resolutions use it too.
  return /\bproponent\b|submitted (?:the following )?proposal|\bproposal (?:was )?submitted by\b/i.test(sectionStart) ? 'shareholder' : 'other';
}

interface Heading {
  n: number;
  at: number;
  word: string;
  title: string;
  heading: string;
}

// Form 10-K item names that "Item N" cross-references drag in ("Item 7-Management's Discussion ...").
const FORM_ITEM_TITLE =
  /^(?:Management|Risk Factors|Business|Legal Proceedings|Mine Safety|Quantitative|Financial Statements|Controls|Properties|Unresolved|Selected|Market for|Other Information|Exhibits|Security Ownership|Certain Relationships|Principal Account|Executive Compensation Table)/i;

const NEXT_HEADING_RE = /\s+(?:PROPOSAL|Proposal|ITEMS?|Items?)\s+(?:N\s?[Oo]\s?\.\s*)?\d/;
const PAGE_NUMBER_RE = /\s+\d{1,3}(?=\s|$).*$/;
const SEE_PAGE_RE = /\s*\((?:see|beginning on)\s+pages?[^)]*\).*$/i;

/** First four words must be mostly capitalised: rejects prose such as "Among other things, approval of Proposal". */
function looksLikeTitle(t: string): boolean {
  const ws = t.split(' ').slice(0, 4);
  const caps = ws.filter((w) => /^[A-Z"'(]/.test(w)).length;
  return /^[A-Z]/.test(t) && caps >= Math.ceil(ws.length / 2);
}

const SMALL = new Set(['of', 'the', 'and', 'to', 'for', 'in', 'a', 'an', 'our', 'on', 'by', 'with', 'or', 'as', 'at']);

/** Share of content words that start with a capital, over the first 12 words. Real headings score near 1. */
function capScore(t: string): number {
  const ws = t.split(' ').slice(0, 12).filter((w) => !SMALL.has(w.toLowerCase()));
  return ws.length === 0 ? 0 : ws.filter((w) => /^[A-Z"'(]/.test(w)).length / ws.length;
}

function cleanTitle(raw: string): string {
  let t = raw;
  const next = NEXT_HEADING_RE.exec(t);
  if (next) t = t.slice(0, next.index);
  t = t.replace(SEE_PAGE_RE, '').replace(PAGE_NUMBER_RE, '');
  return t.slice(0, 140).trim();
}

export function headings(text: string): Heading[] {
  const out: Heading[] = [];
  for (const m of text.matchAll(HEADING_RE)) {
    const n = Number(m[1]);
    if (n < 1 || n > 20) continue;
    const word = m[0].slice(0, 4).toUpperCase();
    const raw = m[2]!;
    const title = cleanTitle(raw);
    if (title.length < 5 || !looksLikeTitle(title)) continue;
    // A quote mark inside the title, or just before the heading, marks a cross-reference ("see the "Proposal 3: ..." section").
    if (title.slice(0, 80).includes('"') || text.slice(Math.max(0, m.index! - 3), m.index!).includes('"')) continue;
    if (word === 'ITEM' && FORM_ITEM_TITLE.test(title)) continue;
    const lead = m[0].length;
    out.push({ n, at: m.index!, word, title, heading: text.slice(m.index!, m.index! + lead + title.length).trim() });
  }
  return out;
}

export function findRec(window: string): { choice: Choice; quote: string } | null {
  const m = REC_RE.exec(window);
  if (m) {
    // Start the quote at the subject ("The Board of Directors ...") when it sits just before the verb.
    const before = window.slice(Math.max(0, m.index - 120), m.index);
    const subj = [...before.matchAll(/\b(?:the|our)\s+(?:board|audit committee)\b/gi)].pop();
    const start = subj ? Math.max(0, m.index - 120) + subj.index! : Math.max(0, m.index - 40);
    return { choice: m[1]!.toUpperCase() as Choice, quote: window.slice(start, m.index + m[0].length).trim() };
  }
  const f = REC_IN_FAVOR_RE.exec(window);
  if (f) return { choice: 'FOR', quote: f[0] };
  return null;
}

export const extractHeadings: Extractor = (text) => {
  const hs = headings(text);
  const byN = new Map<number, Heading[]>();
  for (const h of hs) byN.set(h.n, [...(byN.get(h.n) ?? []), h]);

  const proposals: ExtractedProposal[] = [];
  for (const n of [...byN.keys()].sort((a, b) => a - b)) {
    const occ = byN.get(n)!;
    // Prefer the occurrence whose section (up to the next heading of another number) carries a recommendation.
    let best: { h: Heading; rec: ReturnType<typeof findRec> } | null = null;
    for (const h of occ) {
      // A section ends where the next numbered heading starts. Cross-references to other numbers do not end it.
      const next = hs.find((x) => x.at > h.at + 20 && x.n === n + 1);
      const end = Math.min(next ? next.at : Infinity, h.at + 12000, text.length);
      const rec = findRec(text.slice(h.at, end));
      if (!best || (rec && !best.rec)) best = { h, rec };
      if (rec) break;
    }
    if (!best) continue;
    // Title from the cleanest occurrence: table-of-contents rows are short, body headings run into prose.
    const clean =
      [...occ]
        .filter((h) => h.title.length >= 8 && h.title.split(' ').length >= 3)
        .sort((x, y) => capScore(y.title) - capScore(x.title) || x.title.length - y.title.length)[0] ?? best.h;
    proposals.push({
      id: String(n),
      kind: classifySection(clean.title, text.slice(best.h.at, best.h.at + 2500)),
      text: clean.title,
      quote: clean.heading,
      boardRec: best.rec?.choice ?? null,
      recQuote: best.rec?.quote ?? null,
    });
  }

  const record = recordDate(text);
  return { recordDate: record, meetingDate: meetingDate(text, record), proposals };
};

export function recordDate(text: string): string | null {
  return mode([
    ...datesAfter(text, /record date[^.]{0,40}?(?:is|was|of|:)?/i, 60),
    ...datesBefore(text, /,?\s*(?:the|our)?\s*["']?record date/i, 60),
  ]);
}

/** `record` is excluded from the candidates: "RECORD DATE September 21" sits right next to the "DATE" anchor. */
export function meetingDate(text: string, record: string | null = null): string | null {
  return mode(
    [
      ...datesAfter(text, /(?<!record\s)\b(?:date and time|time and date|meeting date|date|when)\s*[:|]?\s*/i, 60),
      ...datesAfter(text, /\b(?:will be held|to be held|be held)\b[^.]{0,60}?\bon\s+/i, 40),
    ].filter((d) => d !== record),
  );
}
