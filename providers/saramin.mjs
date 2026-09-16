// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Saramin (사람인) provider — Korea's largest job board, through its official
// Open API.
//
// OPT-IN, AND IT NEEDS A KEY. Every other source this fork ships opens without
// authentication, which is why Saramin was listed for a long time as "no public
// API". That was wrong: there is an official one, it just wants an access key.
// The no-auth default stands — this provider stays off until a key is present —
// but a user who wants the biggest Korean board can now have it.
//
//   - name: 사람인
//     provider: saramin
//     enabled: true
//     saramin_keywords: "CRM 마케터"
//     saramin_exclude_directhire: true
//
// The key is read from the environment, never from portals.yml:
//
//   export SARAMIN_ACCESS_KEY=...       # https://oapi.saramin.co.kr/guide/1
//
// portals.yml is a config file people paste into issues and commit by accident;
// a key does not belong in one. `saramin_access_key_env` renames the variable if
// you keep several. The key is stripped out of every error message this file
// produces — see redact().
//
// WHAT IT GIVES THAT THE OTHER KOREAN SOURCES DO NOT.
//
//   - Real search. Wanted and Jumpit hand over the whole board and leave the
//     filtering to us; Greeting has no search at all and needs a company named
//     up front. `keywords` searches company names, posting titles, job-category
//     keywords and posting bodies server-side.
//   - BOTH dates. `posting-date` and `expiration-date` arrive together when
//     asked for in `fields`, so a posting carries when it went up AND when it
//     closes. Wanted and Jumpit publish neither, and Greeting only the first.
//   - `sr=directhire` drops headhunting and staffing-agency listings at the
//     source. In Korea those are a large share of a keyword search and they
//     repost constantly, so filtering them by title keyword (what this fork has
//     to do on Wanted) misses most of them.
//
// CODE-TABLE PARAMETERS ARE PASSED THROUGH UNTOUCHED. `job_type`, `edu_lv`,
// `loc_cd`, `job_cd` and friends are numeric codes defined in Saramin's own
// table (https://oapi.saramin.co.kr/guide/code-table1). This file does not
// translate them and does not validate them against a copied list: a stale copy
// of somebody else's code table silently drops valid searches. Whatever the
// user writes is what gets sent, and Saramin answers for it.
//
// Reference: https://oapi.saramin.co.kr/guide/job-search (read 2026-09-16).

import {
  BROWSER_LIKE_USER_AGENT,
  fetchJsonWithRetry,
  sleep,
} from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';

const API_HOST = 'oapi.saramin.co.kr';
const API_URL = `https://${API_HOST}/job-search`;

// Saramin's documented ceiling is 110 per request; asking for more is a
// documented-param error, not a bigger page.
const MAX_COUNT = 110;
const DEFAULT_COUNT = 110;

const DEFAULT_MAX_PAGES = 20;
const MAX_PAGES_CAP = 200;

const PAGE_DELAY_MS = 250;

const DEFAULT_KEY_ENV = 'SARAMIN_ACCESS_KEY';

// Asked for explicitly: without this the response carries neither date.
const DEFAULT_FIELDS = 'posting-date,expiration-date';

/**
 * Parameters forwarded verbatim from the portals entry, minus the ones this
 * provider owns (`start`, `count`, `fields`, `access-key`). Keys are the
 * portals-side name; values are the API parameter name.
 *
 * Spelled out rather than forwarding anything that starts with `saramin_`, so a
 * typo surfaces as "that filter did nothing" instead of being posted to the API
 * as an unknown parameter.
 */
const PASSTHROUGH_PARAMS = {
  saramin_keywords: 'keywords',
  saramin_bbs_gb: 'bbs_gb',
  saramin_stock: 'stock',
  saramin_loc_cd: 'loc_cd',
  saramin_loc_mcd: 'loc_mcd',
  saramin_loc_bcd: 'loc_bcd',
  saramin_ind_cd: 'ind_cd',
  saramin_job_mid_cd: 'job_mid_cd',
  saramin_job_cd: 'job_cd',
  saramin_job_type: 'job_type',
  saramin_edu_lv: 'edu_lv',
  saramin_published: 'published',
  saramin_published_min: 'published_min',
  saramin_published_max: 'published_max',
  saramin_updated: 'updated',
  saramin_updated_min: 'updated_min',
  saramin_updated_max: 'updated_max',
  saramin_deadline: 'deadline',
  saramin_sort: 'sort',
};

/**
 * Documented error codes. The API answers 200 with an error envelope rather
 * than an HTTP status, so these have to be read out of the body or a bad key
 * looks like an empty board.
 */
const ERROR_MESSAGES = {
  1: 'access-key가 비어 있습니다',
  2: 'access-key가 유효하지 않습니다',
  3: '요청 파라미터가 유효하지 않습니다',
  4: '일일 요청 한도를 넘었습니다',
  99: '사람인 쪽 오류입니다',
};

/**
 * Remove the access key from anything that might be logged or thrown.
 *
 * The key travels in the query string, so an unredacted URL in an error message
 * puts a credential into a log file or a pasted bug report.
 *
 * @param {string} text
 * @returns {string}
 */
export function redact(text) {
  return String(text ?? '').replace(/([?&]access-key=)[^&\s]*/gi, '$1<redacted>');
}

/**
 * Epoch ms, or undefined. Never `Date.parse(x) || undefined`: that drops epoch 0
 * and lets a NaN through.
 * @param {unknown} value
 * @returns {number | undefined}
 */
function toEpochMs(value) {
  if (typeof value !== 'string' || value === '') return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * @param {Record<string, any>} entry
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
export function resolveAccessKey(entry, env = process.env) {
  const varName =
    typeof entry?.saramin_access_key_env === 'string' && entry.saramin_access_key_env.trim()
      ? entry.saramin_access_key_env.trim()
      : DEFAULT_KEY_ENV;
  const key = env?.[varName];
  return typeof key === 'string' ? key.trim() : '';
}

/**
 * @param {Record<string, any>} entry
 * @param {string} accessKey
 * @param {number} start
 * @param {number} count
 * @returns {string}
 */
export function buildSaraminUrl(entry, accessKey, start, count) {
  const params = new URLSearchParams();
  params.set('access-key', accessKey);
  params.set('start', String(start));
  params.set('count', String(count));

  const fields =
    typeof entry?.saramin_fields === 'string' && entry.saramin_fields.trim()
      ? entry.saramin_fields.trim()
      : DEFAULT_FIELDS;
  params.set('fields', fields);

  for (const [portalKey, apiKey] of Object.entries(PASSTHROUGH_PARAMS)) {
    const value = entry?.[portalKey];
    if (value === undefined || value === null || value === '') continue;
    params.set(apiKey, String(value));
  }

  // Headhunting and staffing-agency listings. Off by default — dropping
  // postings is the kind of thing that has to be asked for, not assumed — and
  // switched on in the shipped Korean template with a comment saying why.
  if (entry?.saramin_exclude_directhire === true) params.set('sr', 'directhire');

  return `${API_URL}?${params.toString()}`;
}

/**
 * Read the first string out of a value Saramin returns either bare or wrapped
 * in `{name}`. Both shapes appear across fields in the documented sample.
 * @param {unknown} value
 * @returns {string}
 */
function textOf(value) {
  if (typeof value === 'string') return decodeEntities(value).trim();
  if (value && typeof value === 'object' && typeof value.name === 'string') {
    return decodeEntities(value.name).trim();
  }
  return '';
}

/**
 * @param {Record<string, any>} raw
 * @returns {Record<string, any> | null}
 */
export function normalizeSaraminJob(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const position = raw.position && typeof raw.position === 'object' ? raw.position : {};
  const title = textOf(position.title);
  if (!title) return null;

  // The API hands back the canonical posting URL, so nothing is assembled from
  // an id here and there is no encoding hazard.
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  if (!url) return null;

  const job = {
    title,
    url,
    company: textOf(raw.company?.detail?.name),
    location: textOf(position.location),
  };

  // Free in the response — no extra request — and it is what lets a content
  // filter see past the job title. Same rule providers/jumpit.mjs follows.
  const descriptionBits = [
    textOf(position['job-type']),
    textOf(position['experience-level']),
    textOf(position['required-education-level']),
    textOf(position['job-code']),
  ].filter(Boolean);
  const industry = textOf(position.industry);
  if (industry) descriptionBits.unshift(industry);
  if (descriptionBits.length > 0) job.description = descriptionBits.join(' · ');

  const postedAt = toEpochMs(raw['posting-date']);
  if (postedAt !== undefined) job.postedAt = postedAt;

  // No salary. Saramin's search response carries no compensation figure, and a
  // number read out of the posting body would be a fabricated one.

  return job;
}

/**
 * @param {unknown} payload
 * @param {number} pageIndex
 * @returns {{jobs: Record<string, any>[], total: number | null, returned: number}}
 */
export function parseSaraminPage(payload, pageIndex = 0) {
  if (payload === null || payload === undefined) return { jobs: [], total: null, returned: 0 };

  // Errors arrive as HTTP 200 with an error envelope. Left unchecked, a bad key
  // reads as "the biggest job board in Korea has nothing open".
  const errorCode = payload?.error?.code ?? payload?.code;
  if (errorCode !== undefined && errorCode !== null && payload?.jobs === undefined) {
    const known = ERROR_MESSAGES[Number(errorCode)];
    const detail = payload?.error?.message ?? payload?.message ?? '';
    throw new Error(
      `saramin: API returned error ${errorCode}` +
        (known ? ` — ${known}` : '') +
        (detail ? ` (${redact(String(detail))})` : ''),
    );
  }

  const jobsEnvelope = payload?.jobs;
  if (!jobsEnvelope || typeof jobsEnvelope !== 'object') {
    throw new Error(
      `saramin: response has no "jobs" object on page ${pageIndex} ` +
        `(top-level keys: ${Object.keys(payload || {}).join(', ') || 'none'})`,
    );
  }

  const rows = jobsEnvelope.job;
  // An empty board is a legitimate answer; a missing array is not the same as
  // an empty one, but Saramin omits `job` entirely when nothing matches.
  if (rows === undefined || rows === null) return { jobs: [], total: null, returned: 0 };
  if (!Array.isArray(rows)) {
    throw new Error(
      `saramin: "jobs.job" is ${typeof rows}, expected an array ` +
        `(jobs keys: ${Object.keys(jobsEnvelope).join(', ')})`,
    );
  }

  const jobs = [];
  for (const row of rows) {
    const job = normalizeSaraminJob(row);
    if (job) jobs.push(job);
  }

  const totalRaw = Number(jobsEnvelope.total);
  return {
    jobs,
    total: Number.isFinite(totalRaw) ? totalRaw : null,
    returned: rows.length,
  };
}

/** @type {Provider} */
const provider = {
  id: 'saramin',

  // Explicit opt-in only. There is no URL to detect against: the board is
  // reached through an API host, not through a careers page.
  detect(entry) {
    return entry?.provider === 'saramin' ? { url: API_URL } : null;
  },

  async fetch(entry, ctx) {
    const accessKey = resolveAccessKey(entry);
    if (!accessKey) {
      const varName =
        typeof entry?.saramin_access_key_env === 'string' && entry.saramin_access_key_env.trim()
          ? entry.saramin_access_key_env.trim()
          : DEFAULT_KEY_ENV;
      throw new Error(
        `saramin: no access key. Set ${varName} in the environment ` +
          `(get one at https://oapi.saramin.co.kr/guide/1). ` +
          `Do not put the key in portals.yml.`,
      );
    }

    const configuredCount = Number(entry?.saramin_count);
    const count =
      Number.isFinite(configuredCount) && configuredCount > 0
        ? Math.min(configuredCount, MAX_COUNT)
        : DEFAULT_COUNT;

    const configuredPages = Number(entry?.max_pages);
    const requestedPages =
      Number.isFinite(configuredPages) && configuredPages > 0
        ? Math.min(configuredPages, MAX_PAGES_CAP)
        : DEFAULT_MAX_PAGES;
    const maxPages =
      Number.isFinite(ctx?.maxPages) && ctx.maxPages > 0
        ? Math.min(requestedPages, ctx.maxPages)
        : requestedPages;

    const jobs = [];
    const seen = new Set();

    for (let page = 0; page < maxPages; page += 1) {
      if (page > 0) await sleep(PAGE_DELAY_MS, ctx);

      const url = buildSaraminUrl(entry, accessKey, page, count);

      // No per-page catch: a ctx rejection must reach the caller unwrapped so a
      // probe budget error keeps its identity. The key is redacted at the point
      // it could reach a message, not here.
      const payload = await fetchJsonWithRetry(ctx, url, {
        redirect: 'error',
        headers: {
          'User-Agent': BROWSER_LIKE_USER_AGENT,
          Accept: 'application/json',
          'Accept-Language': 'ko-KR,ko;q=0.9',
        },
      });

      const { jobs: pageJobs, total, returned } = parseSaraminPage(payload, page);

      for (const job of pageJobs) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push(job);
      }

      // Stop on a short page — the documented end of the walk. `total` is used
      // only as a second stop condition, never to compute how many pages to
      // request: a page count derived from a server-reported total is exactly
      // the unbounded-pagination hazard the provider contract warns about.
      if (returned < count) break;
      if (total !== null && (page + 1) * count >= total) break;
    }

    return jobs;
  },
};

export default provider;
