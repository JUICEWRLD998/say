import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { datesIn, declaredNumbers, extractHeadings, htmlToText, normalize, parseText, runChecks, toIso } from '../src/index.ts';
import type { Extraction, FilingRef } from '../src/index.ts';

const fx = (p: string) => new URL(`../../../fixtures/edgar/${p}`, import.meta.url);
const text = (t: string) => readFileSync(fx(`text/${t}.txt`), 'utf8');
const filing = (t: string): FilingRef => JSON.parse(readFileSync(fx(`text/${t}.filing.json`), 'utf8'));
const gold = (t: string) =>
  JSON.parse(readFileSync(fx(`gold/${t}.json`), 'utf8')) as {
    recordDate: string;
    meetingDate: string;
    proposals: { id: string; kind: string; boardRec: string; titleHas: string }[];
  };

const GOLD = ['MSTR', 'ORCL', 'PG', 'LRCX', 'WDC', 'CRDO', 'MDT', 'AEHR', 'SNDK', 'LITE'];

describe('text', () => {
  it('strips tags, hidden XBRL header and decodes entities', () => {
    const html =
      '<html><head><title>x</title></head><body><ix:header><b>HIDDEN</b></ix:header><p>Record&nbsp;Date: &ldquo;June&nbsp;1, 2026&rdquo; &amp; more</p><script>evil()</script></body></html>';
    expect(htmlToText(html)).toBe('Record Date: "June 1, 2026" & more');
  });
  it('normalizes typographic quotes, dashes and whitespace the same way for text and quotes', () => {
    expect(normalize('The  Board’s “vote” – FOR\n now')).toBe('The Board\'s "vote" - FOR now');
  });
});

describe('dates', () => {
  it('rejects impossible calendar dates', () => {
    expect(toIso('February', '30', '2026')).toBeNull();
    expect(toIso('October', '28', '2026')).toBe('2026-10-28');
  });
  it('finds written dates', () => {
    expect(datesIn('on September 21, 2026 , the record date and November 18, 2026')).toEqual(['2026-09-21', '2026-11-18']);
  });
});

describe('declaredNumbers', () => {
  it('reads Proposal mentions, lists and ranges', () => {
    expect(declaredNumbers('vote on Proposal 1, Proposals 2 and 3 and Proposal No. 4.')).toEqual([1, 2, 3, 4]);
  });
  it('uses Item ranges when the filing has no Proposal mentions, and skips Form item cross-references', () => {
    expect(declaredNumbers("Items 4-6 Shareholder. Item 1 Election. See Item 402(v) of Regulation S-K and Item 7-Management's Discussion.")).toEqual([1, 4, 5, 6]);
  });
  it('ignores numbers above 15', () => {
    expect(declaredNumbers('Proposal 1 and Proposal 2 and Proposal 99')).toEqual([1, 2]);
  });
});

describe('gold set: hand-checked filings parse exactly and pass every check', () => {
  for (const t of GOLD) {
    it(t, () => {
      const g = gold(t);
      const r = parseText(text(t), filing(t));
      expect(r.checks.filter((c) => !c.ok)).toEqual([]);
      expect(r.status).toBe('ready');
      expect(r.recordDate).toBe(g.recordDate);
      expect(r.meetingDate).toBe(g.meetingDate);
      expect(r.proposals.map((p) => p.id)).toEqual(g.proposals.map((p) => p.id));
      for (const [i, gp] of g.proposals.entries()) {
        const p = r.proposals[i]!;
        expect(p.kind, `${t} #${gp.id} kind`).toBe(gp.kind);
        expect(p.boardRec, `${t} #${gp.id} rec`).toBe(gp.boardRec);
        expect(p.text.toLowerCase(), `${t} #${gp.id} title`).toContain(gp.titleHas);
      }
    });
  }
});

describe('planted controls: each must FAIL on purpose', () => {
  const orcl = () => text('ORCL');
  const check = (e: Extraction) => runChecks(orcl(), e);
  const failing = (cs: { name: string; ok: boolean }[]) => cs.filter((c) => !c.ok).map((c) => c.name);

  it('KLAC (no numbered headings) is needs_review, never a ballot', () => {
    const r = parseText(text('KLAC'), filing('KLAC'));
    expect(r.status).toBe('needs_review');
    expect(failing(r.checks)).toContain('count');
  });

  it('a filing with one proposal deleted fails the count check', () => {
    // Remove every "PROPOSAL NO. 3" heading; the summary still mentions Proposal 3 and 4.
    const cut = orcl().replace(/PROPOSAL N ?O ?\. 3:/g, 'REMOVED SECTION:');
    const r = parseText(cut, filing('ORCL'));
    expect(r.status).toBe('needs_review');
    expect(failing(r.checks)).toContain('count');
    expect(r.proposals.map((p) => p.id)).toEqual(['1', '2', '4']);
  });

  it('an extraction missing its last proposal fails the count check', () => {
    const e = extractHeadings(orcl());
    expect(failing(check({ ...e, proposals: e.proposals.slice(0, 3) }))).toContain('count');
  });

  it('a quote that is not in the filing fails the quotes check', () => {
    const e = extractHeadings(orcl());
    const bad = { ...e, proposals: e.proposals.map((p, i) => (i === 1 ? { ...p, quote: p.quote + ' invented words' } : p)) };
    expect(failing(check(bad))).toEqual(['quotes']);
  });

  it('a flipped board recommendation fails the recommendations check', () => {
    const e = extractHeadings(orcl());
    const bad = { ...e, proposals: e.proposals.map((p, i) => (i === 0 ? { ...p, boardRec: 'AGAINST' as const } : p)) };
    expect(failing(check(bad))).toEqual(['recommendations']);
  });

  it('a record date not printed next to "record date" fails', () => {
    const e = extractHeadings(orcl());
    expect(failing(check({ ...e, recordDate: '2026-09-22' }))).toEqual(['record-date']);
  });

  it('a meeting date before the record date fails the order check', () => {
    const e = extractHeadings(orcl());
    expect(failing(check({ ...e, meetingDate: '2026-09-01' }))).toContain('date-order');
  });

  it('missing dates fail', () => {
    const e = extractHeadings(orcl());
    expect(failing(check({ ...e, recordDate: null, meetingDate: null }))).toEqual(
      expect.arrayContaining(['record-date', 'meeting-date', 'date-order']),
    );
  });
});

describe('determinism', () => {
  it('100 reruns on ORCL give identical output', () => {
    const t = text('ORCL');
    const first = JSON.stringify(parseText(t, filing('ORCL')));
    for (let i = 0; i < 100; i++) expect(JSON.stringify(parseText(t, filing('ORCL')))).toBe(first);
  });
});
