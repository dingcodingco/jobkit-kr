// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Wanted provider — wanted.co.kr, the largest Korean tech/startup job board.
// Public JSON API, no auth, no cookie, no Referer:
//
//   https://www.wanted.co.kr/api/chaos/navigation/v1/results
//     ?country=kr&job_sort=job.latest_order&locations=all&years=-1
//     &limit=100&offset=0
//   → { data: [ { id, position, company: { id, name }, address: { country,
//       location, district }, employment_type, annual_from, annual_to,
//       is_newbie, skill_tags, is_outlink, … } ],
//       links: { prev, next } }
//
// Configure via a `job_boards` entry with `provider: wanted`:
//
//   - name: Wanted (Korean tech board)
//     provider: wanted
//     careers_url: https://www.wanted.co.kr/jobsfeed
//     enabled: true
//
// --- Design notes -----------------------------------------------------------
//
// Complete inventory (rule 3). `locations=all` + `years=-1` + no
// `job_group_id` is the board's unfiltered view: every location, every
// experience level, every job family. `job_sort=job.latest_order` is the
// board's own chronological ordering, not a promoted or recommended feed —
// the recommendation-ranked view lives behind a logged-in `job.recommend_order`
// sort this provider never requests. The walk continues until the API stops
// handing back a `links.next`, and scan.mjs's title/content/location filters
// decide what survives (rule 5).
//
// Pagination by offset, not by the served link. `links.next` is a
// server-supplied path and following it would let the response steer the next
// request; the offset is therefore advanced locally and `links.next` is read
// only as the end-of-board signal. Same outcome, no response-controlled URL.
//
// annual_from / annual_to are YEARS OF EXPERIENCE, not compensation. The
// Korean word 연차 (years in grade) shortens to "annual" in this payload, and
// a row reading `annual_from: 2, annual_to: 7` is a 2-to-7-year role, not a
// salary band. They are deliberately NOT mapped onto Job.salary: doing so
// would feed "2" and "7" into scan.mjs's salary_filter as if they were
// currency amounts and silently drop every posting the moment a candidate
// sets a floor. `reward` is likewise not compensation — it is the board's
// referral bounty, paid to whoever refers the candidate.
//
// No postedAt. The list payload carries no publication timestamp in any
// shape — absolute or relative. Per the Job contract it is omitted rather
// than synthesized, so scan-ats-full.mjs's recency filter is not fed a
// fabricated date.
//
// Employer attribution. `company.name` is the hiring employer, so tracker
// rows land under the real company rather than under "Wanted".
//
// is_outlink. Some rows are applied to on the employer's own site rather
// than through Wanted, but the payload exposes no destination URL for them —
// only the boolean. The Wanted posting page is therefore the canonical URL
// for every row (rule 2's fallback), and the outlink is discovered by the
// candidate on that page.

import { safeEncodeURIComponent } from './_safe-url.mjs';

const SITE_ORIGIN = 'https://www.wanted.co.kr';
const FEED_BASE = `${SITE_ORIGIN}/api/chaos/navigation/v1/results`;
const TRUSTED_HOST = 'www.wanted.co.kr';

const DEFAULT_PAGE_SIZE = 100; // the API's accepted maximum on a live walk
const PAGE_SIZE_CAP = 100;
// Safety bound only — the loop stops on links.next. 200 pages x 100 rows is
// well above the live board, and leaves room to grow without truncating.
const DEFAULT_MAX_PAGES = 200;
const MAX_PAGES_CAP = 1000;
const PAGE_DELAY_MS = 200;

/** @param {string} url */
function assertWantedUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`wanted: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`wanted: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`wanted: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST}`);
  }
  return url;
}

/** Resolve a positive-integer entry field against a default and a cap. */
function resolveBound(value, fallback, cap) {
  if (Number.isInteger(value) && value > 0) return Math.min(value, cap);
  return fallback;
}

/**
 * Build one page URL. Every parameter is provider-controlled or a plain
 * scalar off the portals.yml entry, and the host is a fixed literal.
 *
 * @param {any} entry
 * @param {number} offset
 * @param {number} pageSize
 */
export function buildWantedPageUrl(entry, offset, pageSize) {
  const params = new URLSearchParams({
    country: typeof entry?.country === 'string' && entry.country.trim() ? entry.country.trim() : 'kr',
    job_sort:
      typeof entry?.job_sort === 'string' && entry.job_sort.trim()
        ? entry.job_sort.trim()
        : 'job.latest_order',
    locations:
      typeof entry?.locations === 'string' && entry.locations.trim() ? entry.locations.trim() : 'all',
    years: String(Number.isInteger(entry?.years) ? entry.years : -1),
    limit: String(pageSize),
    offset: String(offset),
  });
  // job_group_id narrows the board to one job family. Absent by default so
  // the walk covers the whole inventory; set it only to scan one family.
  if (Number.isInteger(entry?.job_group_id)) {
    params.set('job_group_id', String(entry.job_group_id));
  }
  return `${FEED_BASE}?${params.toString()}`;
}

/**
 * Location string for a row: "서울 서초구", "서울", or '' when the payload
 * carries neither. `country` is dropped — every row on a `country=kr` walk
 * repeats "한국", which tells a Korean candidate nothing and would only make
 * scan.mjs's location filter match on noise.
 *
 * @param {any} address
 * @returns {string}
 */
export function formatWantedLocation(address) {
  if (!address || typeof address !== 'object') return '';
  const location = typeof address.location === 'string' ? address.location.trim() : '';
  const district = typeof address.district === 'string' ? address.district.trim() : '';
  if (location && district) return `${location} ${district}`;
  return location || district || '';
}

/**
 * Normalize a single Wanted row. Exported for unit tests.
 *
 * Field mapping → the normalized Job shape:
 *   - title:    `position`, trimmed (rows without one are dropped).
 *   - url:      SITE_ORIGIN + /wd/{id} (rows without a usable id are dropped).
 *   - company:  `company.name`, falling back to the portal entry name, then "Wanted".
 *   - location: see formatWantedLocation.
 *   - postedAt: never emitted; see the header note.
 *   - salary:   never emitted; annual_* are years of experience.
 *
 * @param {any} j
 * @param {string} [fallbackCompany]
 * @returns {{ title: string, url: string, company: string, location: string } | null}
 */
export function normalizeWantedJob(j, fallbackCompany) {
  if (!j || typeof j !== 'object') return null;

  const title = typeof j.position === 'string' ? j.position.trim() : '';
  if (!title) return null;

  const rawId = j.id;
  if (rawId === null || rawId === undefined || rawId === '') return null;
  const seg = safeEncodeURIComponent(String(rawId));
  if (seg === null) return null;
  const url = `${SITE_ORIGIN}/wd/${seg}`;

  const name = typeof j.company?.name === 'string' ? j.company.name.trim() : '';
  const company = name || fallbackCompany || 'Wanted';
  const location = formatWantedLocation(j.address);

  return { title, url, company, location };
}

/** @type {Provider} */
export default {
  id: 'wanted',

  async fetch(entry, ctx) {
    const pageSize = resolveBound(entry?.page_size, DEFAULT_PAGE_SIZE, PAGE_SIZE_CAP);
    // ctx.maxPages is verify-portals.mjs's "first page only" health probe — it
    // always wins over the entry's own bound.
    const maxPages = Math.min(
      resolveBound(entry?.max_pages, DEFAULT_MAX_PAGES, MAX_PAGES_CAP),
      ctx?.maxPages ?? Number.POSITIVE_INFINITY,
    );
    const fallbackCompany = entry?.name;
    const out = [];

    for (let page = 0; page < maxPages; page++) {
      const url = assertWantedUrl(buildWantedPageUrl(entry, page * pageSize, pageSize));
      // redirect:'error' prevents SSRF via server-side redirects
      const json = await ctx.fetchJson(url, { redirect: 'error' });
      const rows = json?.data;
      if (!Array.isArray(rows)) {
        throw new Error(
          `wanted: unexpected API response on page ${page + 1} — expected { data: [...] }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`,
        );
      }
      for (const row of rows) {
        const normalized = normalizeWantedJob(row, fallbackCompany);
        if (normalized) out.push(normalized);
      }
      // The board's own end signal. `links.next` is read, never followed:
      // past the last page the API answers with an empty data array and a
      // null next. An empty page also stops the walk, so a missing links
      // object cannot spin the loop to maxPages.
      if (rows.length === 0) break;
      if (!json?.links?.next) break;
      if (page + 1 < maxPages) {
        await (ctx.sleep ? ctx.sleep(PAGE_DELAY_MS) : new Promise(r => setTimeout(r, PAGE_DELAY_MS)));
      }
    }
    return out;
  },
};
