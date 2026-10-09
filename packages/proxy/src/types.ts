import type { Choice, Proposal } from '@say/core';

/** What an extractor returns. Extractors are untrusted: every field is re-checked against the filing text. */
export interface Extraction {
  recordDate: string | null; // ISO yyyy-mm-dd
  meetingDate: string | null; // ISO yyyy-mm-dd
  proposals: ExtractedProposal[];
}

export interface ExtractedProposal extends Proposal {
  /** Verbatim sentence in the filing that carries the board recommendation; null when the filing gives none. */
  recQuote: string | null;
}

export type Extractor = (text: string) => Extraction;

export type CheckName = 'record-date' | 'meeting-date' | 'date-order' | 'quotes' | 'recommendations' | 'count' | 'ids';

export interface CheckResult {
  name: CheckName;
  ok: boolean;
  detail: string;
}

export interface FilingRef {
  ticker: string;
  cik: string;
  form: string;
  filingDate: string;
  accession: string;
  url: string;
}

export interface ParsedMeeting {
  filing: FilingRef;
  recordDate: string | null;
  meetingDate: string | null;
  proposals: ExtractedProposal[];
  checks: CheckResult[];
  /** `ready` only when every check passed. Anything else is never shown as a ballot. */
  status: 'ready' | 'needs_review';
}

export type { Choice };
