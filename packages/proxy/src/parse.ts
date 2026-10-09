import { runChecks } from './checks.ts';
import { extractHeadings } from './extract.ts';
import { htmlToText } from './text.ts';
import type { Extractor, FilingRef, ParsedMeeting } from './types.ts';

/** Text in, parsed meeting out. `ready` only when every deterministic check passed. */
export function parseText(text: string, filing: FilingRef, extract: Extractor = extractHeadings): ParsedMeeting {
  const e = extract(text);
  const checks = runChecks(text, e);
  return {
    filing,
    recordDate: e.recordDate,
    meetingDate: e.meetingDate,
    proposals: e.proposals,
    checks,
    status: checks.every((c) => c.ok) ? 'ready' : 'needs_review',
  };
}

export const parseHtml = (html: string, filing: FilingRef, extract?: Extractor): ParsedMeeting =>
  parseText(htmlToText(html), filing, extract);
