const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DATE_RE = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\s*,\s*(20\d{2})\b/g;

export function toIso(month: string, day: string, year: string): string | null {
  const m = MONTHS.indexOf(month.toLowerCase()) + 1;
  const d = Number(day);
  if (m < 1 || d < 1 || d > 31) return null;
  const iso = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const probe = new Date(`${iso}T00:00:00Z`);
  return probe.getUTCMonth() + 1 === m && probe.getUTCDate() === d ? iso : null;
}

export function datesIn(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(DATE_RE)) {
    const iso = toIso(m[1]!, m[2]!, m[3]!);
    if (iso) out.push(iso);
  }
  return out;
}

/** Most frequent value; ties go to the earliest seen. null for an empty list. */
export function mode(xs: string[]): string | null {
  const n = new Map<string, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  let best: string | null = null;
  for (const [k, v] of n) if (best === null || v > n.get(best)!) best = k;
  return best;
}

/** Dates found within `span` characters after each anchor match. */
export function datesAfter(text: string, anchor: RegExp, span: number): string[] {
  const out: string[] = [];
  const re = new RegExp(anchor.source, anchor.flags.includes('g') ? anchor.flags : anchor.flags + 'g');
  for (const m of text.matchAll(re)) {
    const from = m.index! + m[0].length;
    const hit = datesIn(text.slice(from, from + span))[0];
    if (hit) out.push(hit);
  }
  return out;
}

export function datesBefore(text: string, anchor: RegExp, span: number): string[] {
  const out: string[] = [];
  const re = new RegExp(anchor.source, anchor.flags.includes('g') ? anchor.flags : anchor.flags + 'g');
  for (const m of text.matchAll(re)) {
    const win = text.slice(Math.max(0, m.index! - span), m.index!);
    const all = datesIn(win);
    const hit = all[all.length - 1];
    if (hit) out.push(hit);
  }
  return out;
}
