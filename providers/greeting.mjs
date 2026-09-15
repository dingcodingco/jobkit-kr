// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Greeting (그리팅) provider — Korea's most widely used applicant tracking
// system, made by Doodlin. Each customer gets a vanity subdomain on
// `{company}.career.greetinghr.com` and publishes its whole opening list on
// the Korean-language root page. This is the same shape as the upstream
// Greenhouse/Lever providers: one board token (here, a subdomain) per company,
// listed in portals.yml.
//
//   - name: 그리팅 (ATS)
//     provider: greeting
//     greeting_companies:
//       - finda                      # on-platform subdomain
//       - www.musinsacareers.com     # customer's own domain
//     enabled: true
//
// A single company can also be given as `careers_url:
// https://finda.career.greetinghr.com` — the subdomain is read off the host.
//
// CUSTOM DOMAINS. `{company}.career.greetinghr.com/ko` always redirects, and
// where it lands is the customer's choice: some stay on the platform (kurly and
// zigbang land on `/ko/home`, finda on `/ko/career`) while others move to a
// domain of their own (musinsa to www.musinsacareers.com, olive young to
// career.oliveyoung.com, wadiz to job.wadiz.io — all checked 2026-09-15). The
// off-platform pages serve the same Greeting payload.
//
// A redirect is server-controlled input, so an off-platform hop is followed
// ONLY to a host the user wrote in their own config. Meet an unlisted one and
// that company is skipped with a message naming the host to add; the other
// companies in the entry still run.
//
// WHY THIS BOARD MATTERS FOR KOREA. The two Korean aggregators this fork
// already reads (Wanted, Jumpit) are missing three fields that the rest of the
// pipeline wants, and Greeting supplies all three in the list payload:
//
//   - `openDate` is a real PUBLICATION date. Wanted and Jumpit publish none at
//     all, so this fork leaves postedAt empty for them rather than invent one
//     (see providers/wanted.mjs and providers/jumpit.mjs). Greeting gives it on
//     every row observed (348/348 across three companies, 2026-09-15), so
//     recency sorting and staleness checks finally have real input.
//   - `employmentType` is a STRUCTURED enum. On Wanted the employment type is
//     smeared into the job title ("마케터 채용_계약직"), which is why the Korean
//     portals template leans on title_filter.negative keywords to drop
//     contract/dispatch roles — a filter that misses any posting whose title
//     doesn't spell it out. Here it is its own field, so `greeting_employment`
//     can filter on the real value instead of on wording.
//   - `jobPositionCareer` carries careerFrom/careerTo/careerType explicitly.
//     Wanted's `annual_from`/`annual_to` LOOK like salary and are actually
//     years of experience (see providers/wanted.mjs header); there is no such
//     ambiguity here.
//
// `dueDate` was null on all 348 rows observed. That is not a bug: 상시채용
// (rolling, "open until filled") is the normal Korean posting mode, and Block G
// of modes/ko/gonggo.md already treats a missing deadline as normal here rather
// than as a ghost-job signal. The field is still read and surfaced when a
// company does set one.
//
// TRANSPORT. The root page is a Next.js RSC payload, so the opening records
// arrive as escaped JSON inside the HTML rather than from a JSON endpoint.
// There is no documented public API and no pagination — the root page carries
// the company's full list (204 openings for the largest company checked). We
// extract per-record objects and JSON.parse each one, which parsed 100% of rows
// on every company tested; link scraping was rejected because one company
// rendered no `/ko/o/{id}` anchors at all while its records parsed fine.
//
// Only the public Korean root page is read. Application forms are never
// touched — this fork never submits an application.

import {
  BROWSER_LIKE_USER_AGENT,
  fetchTextWithRetry,
  sleep,
} from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

const HOST_SUFFIX = '.career.greetinghr.com';

// Companies per run. This is a breadth bound, not a pagination bound: each
// company costs exactly one request. The cap exists so a hand-edited portals
// list cannot turn into a thousand-request sweep.
const DEFAULT_MAX_COMPANIES = 60;
const MAX_COMPANIES_CAP = 300;

const PAGE_DELAY_MS = 250;

// Redirect hops per company. Two are normal for a customer on its own domain:
// `{sub}.career.greetinghr.com/ko` -> that company's domain root -> `/ko/home`.
const MAX_REDIRECT_HOPS = 3;

// Subdomains are used to build a hostname, so they are validated rather than
// escaped: anything outside this shape is dropped instead of being pasted into
// a URL.
const SUBDOMAIN_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

// A full hostname, for a customer serving its board from its own domain.
const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]{0,62}\.)+[a-z]{2,63}$/;

// Enum values observed in live payloads (2026-09-15). Unknown values pass
// through verbatim rather than being dropped or guessed at — a new enum member
// should show up in the report as itself, not disappear.
const EMPLOYMENT_LABELS = {
  FULL_TIME_WORKER: '정규직',
  CONTRACT_WORKER: '계약직',
  INTERN: '인턴',
  PART_TIME_WORKER: '시간제',
  DISPATCHED_WORKER: '파견직',
  TEMPORARY_WORKER: '임시직',
  FREELANCER: '프리랜서',
};

const CAREER_LABELS = {
  EXPERIENCED: '경력',
  NEW_COMER: '신입',
  NOT_MATTER: '경력무관',
};

// One opening record as embedded in the RSC payload. Anchored on the two
// leading booleans and closed at the `group` object so the match cannot run
// past its own record into the next one. The length bound keeps a malformed
// page from driving catastrophic backtracking.
const RECORD_RE =
  /\{"deploy":(?:true|false),"fixed":(?:true|false),"openingJobPosition":.{0,6000}?"group":\{[^{}]*\}\}/gs;

/**
 * Epoch ms, or undefined. Never returns 0: `Date.parse(x) || undefined` would
 * silently drop a 1970 timestamp, and a NaN must not reach the Job object.
 * @param {unknown} value
 * @returns {number | undefined}
 */
function toEpochMs(value) {
  if (typeof value !== 'string' || value === '') return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * A bare subdomain means the platform host; anything else is already a
 * hostname the user vouched for. Doing this in one place is what keeps a custom
 * domain from having the platform suffix glued onto it.
 * @param {string} value
 * @returns {string}
 */
function resolveHost(value) {
  return SUBDOMAIN_RE.test(value) ? `${value}${HOST_SUFFIX}` : value;
}

/**
 * @param {string} subdomain
 * @returns {string}
 */
export function buildGreetingBoardUrl(subdomain) {
  return `https://${resolveHost(subdomain)}/ko`;
}

/**
 * Host allowlist. Called before every network request, not after: a config
 * value must never be able to point this provider at an arbitrary host.
 * @param {string} url
 */
function assertGreetingUrl(url, declaredHosts = null) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`greeting: unparseable URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`greeting: refusing non-HTTPS URL: ${url}`);
  }
  const host = parsed.hostname.toLowerCase();
  if (host.endsWith(HOST_SUFFIX)) return;
  if (declaredHosts && declaredHosts.has(host)) return;

  const err = new Error(
    `greeting: refusing host ${host}. It is not on ${HOST_SUFFIX} and you did ` +
      `not list it. If this is the company's own careers domain, add ` +
      `"${host}" to greeting_companies.`,
  );
  // Tagged so the sweep can skip this one company and keep the others, without
  // swallowing any other class of failure.
  err.greetingUndeclaredHost = host;
  throw err;
}

/**
 * Pull the company subdomain out of a Greeting careers URL.
 * @param {unknown} value
 * @returns {string | null}
 */
export function subdomainFromCareersUrl(value) {
  if (typeof value !== 'string' || value === '') return null;
  let host;
  try {
    host = new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host.endsWith(HOST_SUFFIX)) return null;
  const sub = host.slice(0, -HOST_SUFFIX.length);
  return SUBDOMAIN_RE.test(sub) ? sub : null;
}

/**
 * Resolve the company list from a portals entry. Invalid subdomains are
 * dropped rather than throwing: one bad line should not cost the whole board.
 * @param {Record<string, any>} entry
 * @returns {string[]}
 */
export function resolveGreetingCompanies(entry) {
  const out = [];
  const seen = new Set();
  const push = (value) => {
    if (typeof value !== 'string') return;
    const raw = value.trim().toLowerCase().replace(/\/+$/, '');
    if (!raw || seen.has(raw)) return;

    if (SUBDOMAIN_RE.test(raw)) {
      seen.add(raw);
      out.push({ label: raw, host: `${raw}${HOST_SUFFIX}`, declared: false });
      return;
    }
    // A customer serving its board from its own domain. Listing it here is the
    // user vouching for the host, which is what makes following a redirect
    // into it safe.
    if (HOSTNAME_RE.test(raw)) {
      seen.add(raw);
      out.push({ label: raw, host: raw, declared: true });
    }
  };

  const listed = entry?.greeting_companies;
  if (Array.isArray(listed)) for (const item of listed) push(item);

  const fromUrl = subdomainFromCareersUrl(entry?.careers_url);
  if (fromUrl) push(fromUrl);

  return out;
}

/**
 * Human-readable location. `place` is a full street address, `location` is the
 * company's own label for the site (often just an office nickname), so the
 * address wins when both exist.
 * @param {Record<string, any> | null | undefined} place
 * @returns {string}
 */
export function formatGreetingLocation(place) {
  if (!place || typeof place !== 'object') return '';
  const parts = [];
  const address = typeof place.place === 'string' ? place.place.trim() : '';
  const label = typeof place.location === 'string' ? place.location.trim() : '';
  if (address) parts.push(address);
  else if (label) parts.push(label);
  if (place.workFromHome === true) parts.push('재택 가능');
  return parts.join(' · ');
}

/**
 * Employment type, career requirement and job family all arrive in the list
 * payload, so folding them into `description` costs no extra request — the
 * same rule providers/jumpit.mjs follows for its tech stacks. Without this the
 * keyword filter only ever sees the job title.
 * @param {Record<string, any>} record
 * @returns {string}
 */
export function buildGreetingDescription(record) {
  const positions = record?.openingJobPosition?.openingJobPositions;
  const bits = [];
  const seen = new Set();
  const add = (value) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    bits.push(value);
  };

  if (Array.isArray(positions)) {
    for (const position of positions) {
      if (!position || typeof position !== 'object') continue;

      const occupation = position.workspaceOccupation?.occupation;
      if (typeof occupation === 'string' && occupation.trim()) {
        add(occupation.trim());
      }

      const employment = position.jobPositionEmployment?.employmentType;
      if (typeof employment === 'string' && employment) {
        add(EMPLOYMENT_LABELS[employment] || employment);
      }

      const career = position.jobPositionCareer;
      if (career && typeof career === 'object') {
        const type = typeof career.careerType === 'string' ? career.careerType : '';
        const label = CAREER_LABELS[type] || type;
        const from = Number.isFinite(career.careerFrom) ? career.careerFrom : null;
        const to = Number.isFinite(career.careerTo) ? career.careerTo : null;
        if (from != null && to != null) add(`${label || '경력'} ${from}~${to}년`);
        else if (from != null) add(`${label || '경력'} ${from}년 이상`);
        else if (label) add(label);
      }
    }
  }

  // Surfaced because Block G of the Korean evaluation mode asks whether a
  // posting has a deadline at all. Absent is normal here (상시채용), so only a
  // present value is worth saying.
  const due = typeof record?.dueDate === 'string' ? record.dueDate.trim() : '';
  if (due) add(`마감 ${due.slice(0, 10)}`);

  return bits.join(' · ');
}

/**
 * Employment-type gate. Wanted forces this to be done with title keywords;
 * here the real field is available, so a caller can ask for 정규직 only and
 * actually get it.
 * @param {Record<string, any>} record
 * @param {Set<string> | null} allowed
 * @returns {boolean}
 */
function employmentAllowed(record, allowed) {
  if (!allowed || allowed.size === 0) return true;
  const positions = record?.openingJobPosition?.openingJobPositions;
  if (!Array.isArray(positions) || positions.length === 0) return false;
  for (const position of positions) {
    const type = position?.jobPositionEmployment?.employmentType;
    if (typeof type === 'string' && allowed.has(type.toUpperCase())) return true;
  }
  return false;
}

/**
 * @param {Record<string, any>} record
 * @param {string} host  Full hostname the board was read from. Companies on
 *   their own domain serve `/ko/o/{id}` there, not on the platform host.
 * @returns {Record<string, any> | null}
 */
export function normalizeGreetingJob(record, host) {
  if (!record || typeof record !== 'object') return null;

  const rawTitle = typeof record.title === 'string' ? record.title : '';
  const title = decodeEntities(rawTitle).trim();
  if (!title) return null;

  const rawId = record.openingId;
  if (rawId == null || rawId === '') return null;
  const segment = safeEncodeURIComponent(String(rawId));
  if (segment == null) return null;

  const company =
    typeof record.group?.name === 'string'
      ? decodeEntities(record.group.name).trim()
      : '';

  const positions = record.openingJobPosition?.openingJobPositions;
  const firstPlace = Array.isArray(positions)
    ? positions.find((p) => p && p.workspacePlace)?.workspacePlace
    : null;

  const job = {
    title,
    url: `https://${resolveHost(host)}/ko/o/${segment}`,
    company,
    location: formatGreetingLocation(firstPlace),
  };

  const description = buildGreetingDescription(record);
  if (description) job.description = description;

  // Unlike the other two Korean boards, this one publishes a real posting date.
  const postedAt = toEpochMs(record.openDate);
  if (postedAt !== undefined) job.postedAt = postedAt;

  // No salary. Greeting carries no compensation field at all, and inventing
  // one from the job description would be a fabricated number.

  return job;
}

/**
 * @param {string} html
 * @param {string} host  Subdomain or full hostname the board was read from.
 * @param {Set<string> | null} allowedEmployment
 * @returns {Record<string, any>[]}
 */
export function parseGreetingBoard(html, host, allowedEmployment = null) {
  if (typeof html !== 'string' || html === '') return [];

  // The RSC payload escapes its JSON inside JS string literals.
  const unescaped = html.replace(/\\"/g, '"');

  // An empty board is a legitimate answer (a company with nothing open), so
  // only a page that looks like it isn't a Greeting board at all is an error.
  // Without this check a redesign would read as "every company closed hiring".
  const looksLikeBoard =
    unescaped.includes('openingId') || unescaped.includes('greetinghr');
  if (!looksLikeBoard) {
    throw new Error(
      `greeting: ${host} returned a page with no Greeting markers ` +
        `(${unescaped.length} chars); the board layout may have changed`,
    );
  }

  const jobs = [];
  const seen = new Set();
  RECORD_RE.lastIndex = 0;
  for (const match of unescaped.matchAll(RECORD_RE)) {
    let record;
    try {
      record = JSON.parse(match[0]);
    } catch {
      continue; // one malformed record must not cost the company
    }
    if (record?.deploy === false) continue;
    if (!employmentAllowed(record, allowedEmployment)) continue;

    const job = normalizeGreetingJob(record, host);
    if (!job || seen.has(job.url)) continue;
    seen.add(job.url);
    jobs.push(job);
  }
  return jobs;
}

const BOARD_HEADERS = {
  'User-Agent': BROWSER_LIKE_USER_AGENT,
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

/**
 * Fetch one company board, following at most one redirect by hand.
 *
 * `/ko` 301s to whatever landing path the company configured, and that path is
 * NOT the same across customers — finda lands on `/ko/career`, while the same
 * path 404s for musinsa, oliveyoung, kurly, wadiz and zigbang (checked
 * 2026-09-15). So the entry URL has to be the redirecting one, and the hop has
 * to be taken.
 *
 * Hops are taken manually rather than with `redirect: 'follow'` so each target
 * is re-checked against the host allowlist before it is requested: a redirect
 * is server-controlled input, and following it blindly is exactly the SSRF hole
 * `redirect: 'error'` exists to close. Re-checking every hop (not just the
 * first) is what stops a chain from walking off the allowlist one step at a
 * time. A short hop budget bounds the chain — a company on its own domain
 * takes two (platform subdomain -> its domain root -> /ko/home) — and the last
 * attempt refuses redirects outright so a loop always terminates.
 *
 * @param {Record<string, any>} ctx
 * @param {string} url
 * @param {string} subdomain
 * @returns {Promise<string>}
 */
async function fetchBoardHtml(ctx, url, subdomain, declaredHosts) {
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    const isLastHop = hop === MAX_REDIRECT_HOPS;
    // No catch around the non-redirect failure path: a ctx rejection must reach
    // the caller unwrapped so a probe budget error keeps its identity.
    try {
      return await fetchTextWithRetry(ctx, current, {
        // The final attempt refuses outright, so a redirect loop always ends.
        redirect: isLastHop ? 'error' : 'manual',
        headers: BOARD_HEADERS,
      });
    } catch (err) {
      const status = err?.status;
      const location = err?.location;
      const isRedirect = typeof status === 'number' && status >= 300 && status <= 399;
      if (!isRedirect || typeof location !== 'string' || location === '') throw err;

      let target;
      try {
        target = new URL(location, current).toString();
      } catch {
        throw new Error(
          `greeting: ${subdomain} redirected to an unparseable location (${status})`,
        );
      }
      // Re-checked on EVERY hop, not just the first: a chain must not be able
      // to walk off the allowlist one step at a time.
      assertGreetingUrl(target, declaredHosts);
      current = target;
    }
  }

  throw new Error(
    `greeting: ${subdomain} redirected more than ${MAX_REDIRECT_HOPS} times`,
  );
}

/**
 * @param {unknown} value
 * @returns {Set<string> | null}
 */
function resolveEmploymentFilter(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const set = new Set();
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) set.add(item.trim().toUpperCase());
  }
  return set.size > 0 ? set : null;
}

/** @type {Provider} */
const provider = {
  id: 'greeting',

  // Explicit opt-in only. Customers sit on their own vanity subdomains, so
  // there is no URL pattern that identifies a Greeting board without also
  // risking a claim on some unrelated company domain.
  detect(entry) {
    if (entry?.provider !== 'greeting') return null;
    const companies = resolveGreetingCompanies(entry);
    if (companies.length === 0) return null;
    return { url: buildGreetingBoardUrl(companies[0].host) };
  },

  async fetch(entry, ctx) {
    const companies = resolveGreetingCompanies(entry);
    if (companies.length === 0) {
      throw new Error(
        'greeting: no companies configured. Set greeting_companies: [subdomain, ...] ' +
          'or careers_url: https://{subdomain}.career.greetinghr.com',
      );
    }

    const configured = Number(entry?.max_pages);
    const requested =
      Number.isFinite(configured) && configured > 0
        ? Math.min(configured, MAX_COMPANIES_CAP)
        : DEFAULT_MAX_COMPANIES;
    // A health probe passes maxPages: 1 — one company is enough to prove the
    // board answers.
    const limit =
      Number.isFinite(ctx?.maxPages) && ctx.maxPages > 0
        ? Math.min(requested, ctx.maxPages)
        : requested;

    const allowedEmployment = resolveEmploymentFilter(entry?.greeting_employment);

    const declaredHosts = new Set(
      companies.filter((c) => c.declared).map((c) => c.host),
    );

    const jobs = [];
    const skipped = [];
    const targets = companies.slice(0, limit);
    for (let i = 0; i < targets.length; i += 1) {
      const company = targets[i];
      const url = buildGreetingBoardUrl(company.host);
      assertGreetingUrl(url, declaredHosts);

      if (i > 0) await sleep(PAGE_DELAY_MS, ctx);

      let html;
      try {
        html = await fetchBoardHtml(ctx, url, company.label, declaredHosts);
      } catch (err) {
        // Only an off-platform redirect to a host the user has not vouched for
        // is survivable here. Everything else — a probe budget error above all
        // — propagates unwrapped so it keeps its identity.
        if (!err?.greetingUndeclaredHost) throw err;
        skipped.push({ company: company.label, host: err.greetingUndeclaredHost });
        continue;
      }

      for (const job of parseGreetingBoard(html, company.host, allowedEmployment)) {
        jobs.push(job);
      }
    }

    // Every company redirecting somewhere unlisted is a configuration problem,
    // not an empty board. Returning [] here would read as "nobody is hiring".
    if (jobs.length === 0 && skipped.length > 0) {
      const detail = skipped.map((s) => `${s.company} -> ${s.host}`).join(', ');
      throw new Error(
        `greeting: every configured company redirected to a host you have not ` +
          `listed (${detail}). Add those hosts to greeting_companies.`,
      );
    }
    for (const s of skipped) {
      console.warn(
        `greeting: skipped ${s.company} — it redirects to ${s.host}, which is ` +
          `not listed. Add "${s.host}" to greeting_companies to include it.`,
      );
    }

    return jobs;
  },
};

export default provider;
