// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Jumpit provider — jumpit.saramin.co.kr, a Korean developer-only job board
// run by Saramin. Public JSON API, no auth, no cookie, no Referer:
//
//   https://jumpit-api.saramin.co.kr/api/positions?page=1
//   → { message, status, code,
//       result: { totalCount, page, keyword, keywordType,
//         positions: [ { id, title, companyName, jobCategory, techStacks: [],
//           locations: [], minCareer, maxCareer, newcomer, alwaysOpen,
//           closedAt, viewCount, … } ],
//         emptyPosition } }
//
// Configure via a `job_boards` entry with `provider: jumpit`:
//
//   - name: Jumpit (Korean developer board)
//     provider: jumpit
//     careers_url: https://jumpit.saramin.co.kr/positions
//     enabled: true
//
// --- Design notes -----------------------------------------------------------
//
// Two hosts, one source. The API answers on jumpit-api.saramin.co.kr and the
// postings are read on jumpit.saramin.co.kr. Both are fixed literals here —
// the API host is the only one this provider requests, the site host only
// ever appears in an emitted URL.
//
// Complete inventory (rule 3). The default view with no `sort` and no
// `keyword` is the full board — 702 rows across 44 pages of 16 on a live walk
// (2026-09-14), with `result.totalCount` agreeing. The response-rate ranking
// (`sort=rsp_rate`) the site's own UI defaults to is deliberately not
// requested: it reorders the same inventory, and asking for it would make the
// early pages a ranked slice rather than a neutral one. The walk continues
// until a page comes back empty and lets scan.mjs's filters decide (rule 5).
//
// techStacks → description. The list payload carries the posting's stack for
// free (no per-job request, so the scanner stays zero-token), and on a
// developer board that array is the single most useful thing to match a
// candidate's keywords against — the title alone is usually just a role name
// ("백엔드 개발자"). It is joined into `description` so scan.mjs's
// content_filter has something real to read. Rows with an empty array get no
// description, which always passes the filter.
//
// No postedAt. The payload exposes `closedAt` (the application deadline) but
// no publication date, and the two are not interchangeable: feeding a
// deadline into a recency filter would rank a posting by when it expires.
// Per the Job contract, postedAt is omitted rather than guessed.
//
// minCareer / maxCareer are years of experience, not compensation, and are
// not mapped onto Job.salary. The board exposes no salary figures at all.
//
// Employer attribution. `companyName` is the hiring employer, so tracker rows
// land under the real company rather than under "Jumpit".

import { safeEncodeURIComponent } from './_safe-url.mjs';

const API_ORIGIN = 'https://jumpit-api.saramin.co.kr';
const SITE_ORIGIN = 'https://jumpit.saramin.co.kr';
const FEED_BASE = `${API_ORIGIN}/api/positions`;
const TRUSTED_API_HOST = 'jumpit-api.saramin.co.kr';

// Safety bound only — the loop stops on an empty page. The live board was 44
// pages on 2026-09-14; this leaves room to grow without silently truncating.
const DEFAULT_MAX_PAGES = 200;
const MAX_PAGES_CAP = 1000;
const PAGE_DELAY_MS = 200;

/** @param {string} url */
function assertJumpitApiUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`jumpit: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`jumpit: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_API_HOST) {
    throw new Error(`jumpit: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_API_HOST}`);
  }
  return url;
}

/** Resolve the page cap: a positive integer `max_pages` on the entry, capped. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/**
 * Location string for a row. `locations` is an array of "시 구" strings
 * ("서울 성동구"); a role open in several offices carries several. They are
 * joined with ", " so scan.mjs's location filter can match any of them.
 *
 * @param {any} locations
 * @returns {string}
 */
export function formatJumpitLocation(locations) {
  if (!Array.isArray(locations)) return '';
  const parts = locations
    .filter(v => typeof v === 'string')
    .map(v => v.trim())
    .filter(Boolean);
  return parts.join(', ');
}

/**
 * Normalize a single Jumpit row. Exported for unit tests.
 *
 * Field mapping → the normalized Job shape:
 *   - title:       `title`, trimmed (rows without one are dropped).
 *   - url:         SITE_ORIGIN + /position/{id} (rows without a usable id are dropped).
 *   - company:     `companyName`, falling back to the portal entry name, then "Jumpit".
 *   - location:    see formatJumpitLocation.
 *   - description: `techStacks` joined, omitted when the array is empty.
 *   - postedAt:    never emitted; see the header note.
 *
 * @param {any} p
 * @param {string} [fallbackCompany]
 * @returns {{ title: string, url: string, company: string, location: string, description?: string } | null}
 */
export function normalizeJumpitPosition(p, fallbackCompany) {
  if (!p || typeof p !== 'object') return null;

  const title = typeof p.title === 'string' ? p.title.trim() : '';
  if (!title) return null;

  const rawId = p.id;
  if (rawId === null || rawId === undefined || rawId === '') return null;
  const seg = safeEncodeURIComponent(String(rawId));
  if (seg === null) return null;
  const url = `${SITE_ORIGIN}/position/${seg}`;

  const name = typeof p.companyName === 'string' ? p.companyName.trim() : '';
  const company = name || fallbackCompany || 'Jumpit';
  const location = formatJumpitLocation(p.locations);

  /** @type {{ title: string, url: string, company: string, location: string, description?: string }} */
  const job = { title, url, company, location };

  const stacks = Array.isArray(p.techStacks)
    ? p.techStacks.filter(v => typeof v === 'string').map(v => v.trim()).filter(Boolean)
    : [];
  if (stacks.length) job.description = stacks.join(', ');

  return job;
}

/** @type {Provider} */
export default {
  id: 'jumpit',

  async fetch(entry, ctx) {
    // ctx.maxPages is verify-portals.mjs's "first page only" health probe — it
    // always wins over the entry's own bound.
    const maxPages = Math.min(resolveMaxPages(entry), ctx?.maxPages ?? Number.POSITIVE_INFINITY);
    const fallbackCompany = entry?.name;
    const out = [];

    for (let page = 1; page <= maxPages; page++) {
      const url = assertJumpitApiUrl(`${FEED_BASE}?page=${page}`);
      // redirect:'error' prevents SSRF via server-side redirects
      const json = await ctx.fetchJson(url, { redirect: 'error' });
      const positions = json?.result?.positions;
      if (!Array.isArray(positions)) {
        throw new Error(
          `jumpit: unexpected API response on page ${page} — expected { result: { positions: [...] } }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`,
        );
      }
      // Past the last page the API answers 200 with an empty positions array
      // and totalCount 0 — that, not a short page, is the end signal: an
      // intermediate page can legitimately come back short.
      if (positions.length === 0) break;
      for (const p of positions) {
        const normalized = normalizeJumpitPosition(p, fallbackCompany);
        if (normalized) out.push(normalized);
      }
      if (page < maxPages) {
        await (ctx.sleep ? ctx.sleep(PAGE_DELAY_MS) : new Promise(r => setTimeout(r, PAGE_DELAY_MS)));
      }
    }
    return out;
  },
};
