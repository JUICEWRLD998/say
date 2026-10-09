// EDGAR access. Node fetch gets ECONNRESET from sec.gov here, so requests go through curl (see DEVEX_NOTES).
// SEC fair access: at most 10 requests/s and a descriptive User-Agent. We stay at 5/s.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const ex = promisify(execFile);
// The SEC asks for a contact in the User-Agent. Set SAY_SEC_UA="Say research you@example.org" to include yours;
// the default carries no email so the public repo does not.
export const UA = process.env.SAY_SEC_UA ?? 'Say research (Mustapha Fadhlullah, independent security researcher)';
const MIN_GAP_MS = 200;
let nextSlot = 0;

async function slot() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + MIN_GAP_MS;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

export async function get(url, { retries = 3 } = {}) {
  for (let i = 0; ; i++) {
    await slot();
    try {
      const { stdout } = await ex(
        'curl',
        ['-s', '--fail', '--max-time', '60', '--compressed', '-A', UA, url],
        { maxBuffer: 1 << 28, encoding: 'utf8' },
      );
      return stdout;
    } catch (e) {
      if (i >= retries) throw new Error(`GET ${url} failed: ${String(e.message).slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

export const getJson = async (url) => JSON.parse(await get(url));

export const padCik = (c) => String(c).padStart(10, '0');
export const submissionsUrl = (cik) => `https://data.sec.gov/submissions/CIK${padCik(cik)}.json`;
export const docUrl = (cik, accession, primaryDocument) =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll('-', '')}/${primaryDocument}`;

export const PROXY_FORMS = new Set(['DEF 14A', 'DEFA14A']);

/** Pure: pick proxy filings out of a submissions JSON, newest first. */
export function proxyFilings(sub, sinceDate) {
  const r = sub.filings?.recent;
  if (!r) return [];
  const out = [];
  for (let i = 0; i < r.form.length; i++) {
    if (!PROXY_FORMS.has(r.form[i]) || r.filingDate[i] < sinceDate) continue;
    out.push({
      cik: padCik(sub.cik),
      company: sub.name,
      form: r.form[i],
      filingDate: r.filingDate[i],
      accession: r.accessionNumber[i],
      primaryDocument: r.primaryDocument[i],
      url: docUrl(sub.cik, r.accessionNumber[i], r.primaryDocument[i]),
    });
  }
  return out.sort((a, b) => b.filingDate.localeCompare(a.filingDate));
}
