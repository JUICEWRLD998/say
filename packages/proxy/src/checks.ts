import { datesAfter, datesBefore } from './dates.ts';
import { normalize } from './text.ts';
import type { CheckResult, Extraction } from './types.ts';

/**
 * Deterministic checks. They read the filing text and the extraction only; they never trust the extractor.
 * Any failed check keeps the meeting out of the ballot list.
 */

const MENTION_RE =
  /\b(PROPOSALS?|ITEMS?)\s+(?:N\s?O\s?\.\s*)?(\d{1,2})\b(?![\d(])((?:\s*(?:,|and|&|-|to|through)\s*\d{1,2}\b(?!\())*)/gi;
const FORM_ITEM_FOLLOW = /^\s*[-–]\s*[A-Z]|^\s+of\s+(?:regulation|form|our\s+annual|the\s+form)/i;

/**
 * Proposal numbers the filing itself mentions ("Proposal 4", "Proposals 2 and 3", "Items 4-6"), as a sorted list.
 * Proposal mentions win. Item mentions are used only when the filing never says "Proposal N",
 * and Form 10-K item cross-references ("Item 7-Management's Discussion", "Item 402(v)") are dropped.
 */
export function declaredNumbers(text: string): number[] {
  const proposal = new Set<number>();
  const item = new Set<number>();
  for (const m of text.matchAll(MENTION_RE)) {
    const set = m[1]!.toUpperCase().startsWith('P') ? proposal : item;
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 40);
    if (set === item && FORM_ITEM_FOLLOW.test(after)) continue;
    const nums = [Number(m[2]), ...[...(m[3] ?? '').matchAll(/\d{1,2}/g)].map((x) => Number(x[0]))];
    const isRange = /(?:-|to|through)\s*\d/i.test(m[3] ?? '');
    if (isRange && nums.length === 2) {
      for (let k = nums[0]!; k <= nums[1]!; k++) set.add(k);
    } else {
      for (const k of nums) set.add(k);
    }
  }
  const pick = proposal.size >= 2 ? proposal : item;
  return [...pick].filter((k) => k >= 1 && k <= 15).sort((a, b) => a - b);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const written = (iso: string): string => {
  const [y, m, d] = iso.split('-');
  return `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}`;
};

export function runChecks(text: string, e: Extraction): CheckResult[] {
  const hay = text; // already normalized by htmlToText
  const out: CheckResult[] = [];
  const add = (name: CheckResult['name'], ok: boolean, detail: string) => out.push({ name, ok, detail });

  // record date: present, and the same date is printed next to "record date" in the filing.
  if (!e.recordDate) add('record-date', false, 'no record date extracted');
  else {
    const near = [
      ...datesAfter(hay, /record date[^.]{0,40}?(?:is|was|of|:)?/i, 60),
      ...datesBefore(hay, /,?\s*(?:the|our)?\s*["']?record date/i, 60),
    ];
    const ok = near.includes(e.recordDate);
    add('record-date', ok, ok ? `${written(e.recordDate)} printed next to "record date"` : `${e.recordDate} not printed next to "record date"`);
  }

  // meeting date: present and printed in the filing.
  if (!e.meetingDate) add('meeting-date', false, 'no meeting date extracted');
  else {
    const printed = hay.includes(written(e.meetingDate));
    add('meeting-date', printed, printed ? `${written(e.meetingDate)} printed in the filing` : `${written(e.meetingDate)} not found in the filing`);
  }

  add(
    'date-order',
    !!e.recordDate && !!e.meetingDate && e.recordDate < e.meetingDate,
    `record ${e.recordDate ?? '?'} before meeting ${e.meetingDate ?? '?'}`,
  );

  // quotes: every proposal quote is a verbatim span of the filing.
  const badQuotes = e.proposals.filter((p) => !p.quote || !hay.includes(normalize(p.quote))).map((p) => p.id);
  add(
    'quotes',
    e.proposals.length > 0 && badQuotes.length === 0,
    e.proposals.length === 0
      ? 'no proposals extracted'
      : badQuotes.length
        ? `quote not found verbatim for proposal ${badQuotes.join(', ')}`
        : `${e.proposals.length} quotes found verbatim`,
  );

  // recommendations: each has a verbatim sentence that carries the same word.
  const badRec = e.proposals
    .filter((p) => {
      if (!p.boardRec || !p.recQuote) return true;
      const q = normalize(p.recQuote);
      return !hay.includes(q) || !(q.toUpperCase().includes(p.boardRec) || (p.boardRec === 'FOR' && /in favor/i.test(q)));
    })
    .map((p) => p.id);
  add(
    'recommendations',
    e.proposals.length > 0 && badRec.length === 0,
    e.proposals.length === 0
      ? 'no proposals extracted'
      : badRec.length
        ? `no verified board recommendation for proposal ${badRec.join(', ')}`
        : 'every proposal has a verbatim board recommendation',
  );

  // ids and count against the filing's own mentions.
  const ids = e.proposals.map((p) => Number(p.id));
  const consecutive = ids.length > 0 && ids.every((id, i) => id === i + 1);
  add('ids', consecutive, consecutive ? `ids 1..${ids.length}` : `ids [${ids.join(',')}] are not 1..n`);

  const declared = declaredNumbers(text);
  const max = declared.length ? declared[declared.length - 1]! : 0;
  add('count', max > 0 && ids.length === max, `filing mentions proposals up to ${max || 'none'}; extracted ${ids.length}`);

  return out;
}
