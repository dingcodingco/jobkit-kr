#!/usr/bin/env node
// company-rating.mjs — company reputation, as a lookup aid and a record of what
// the candidate actually read.
//
// READ-ONLY. This script never writes a file and never reaches the network.
//
// WHAT IT DOES
//   1. builds the lookup links for a company name, so the candidate can open
//      the review sites themselves, and
//   2. reads back whatever they recorded in `data/회사평점.md`.
//
// WHY IT DOES NOT FETCH. Both Korean review sites have said, in the one place
// a site says it, that they don't want this:
//   - Jobplanet's robots.txt disallows `/search`. Company review pages are not
//     disallowed, but you can only reach one by searching for the company
//     first, and that door is shut.
//   - Blind's robots.txt names AI agents and blocks them by name — ClaudeBot,
//     anthropic-ai, GPTBot, CCBot. The rating data is in the page as
//     schema.org EmployerAggregateRating, and we still don't take it.
// A person clicking a link is not a crawler, so links are what this produces.
// (Checked 2026-09-15.)
//
// WHY IT REPORTS FACTS AND NOT A VERDICT. Same rule company-history.mjs
// follows: a rating is context for the candidate's own judgement, not a score.
// It is never folded into the posting score, and a low rating is never read as
// "don't apply" — a good team exists inside a badly-reviewed company, and the
// reverse is just as common. The candidate decides; this prints what they
// recorded and where to look.
//
// Usage:
//   node company-rating.mjs --company "아크미"
//   node company-rating.mjs --summary
//   node company-rating.mjs --company "아크미" --json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isMainModule } from './lib/is-main-module.mjs';
import { normalizeCompany } from './tracker-utils.mjs';
import { companyKeys } from './company-name-kr.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = process.env.CAREER_OPS_DATA_ROOT || ROOT;
const RATINGS_PATH = path.join(DATA_ROOT, 'data', '회사평점.md');
const TEMPLATE_REL = 'templates/company-ratings.kr.example.md';

/**
 * Where to look a Korean company up. `search` is the URL a person opens; this
 * script only prints it.
 *
 * `blocksAutomation` is not decoration — it is why the fetch this script
 * deliberately does not do, does not exist. Keeping the reason next to the link
 * stops a later change from "helpfully" adding a fetcher.
 */
export const LOOKUP_SOURCES = [
  {
    id: 'jobplanet',
    label: '잡플래닛',
    what: '기업 리뷰·평점. 총평은 로그인 없이 보이고, 항목별 점수와 리뷰 본문은 로그인 뒤에 열린다',
    search: (name) =>
      `https://www.jobplanet.co.kr/search?query=${encodeURIComponent(name)}`,
    blocksAutomation: 'robots.txt가 /search를 막아 놨다',
  },
  {
    id: 'blind',
    label: '블라인드',
    what: '재직자 익명 리뷰·평점. 표본이 큰 편이다',
    search: (name) =>
      `https://www.teamblind.com/kr/company/${encodeURIComponent(name)}`,
    blocksAutomation: 'robots.txt가 ClaudeBot·anthropic-ai를 이름으로 막아 놨다',
  },
  {
    id: 'kreditjob',
    label: '크레딧잡',
    what: '국민연금 신고 기준 인원·평균 보수 추정. 리뷰가 아니라 숫자다',
    search: (name) => `https://kreditjob.com/search?keyword=${encodeURIComponent(name)}`,
    blocksAutomation: null,
  },
  {
    id: 'nps',
    label: '국민연금 가입자 조회',
    what: '가입자 수 변동. 사람이 빠르게 줄고 있는지 같은 것이 보인다',
    search: () => 'https://www.nps.or.kr/jsppage/business/pay/pay_02_01.jsp',
    blocksAutomation: null,
  },
];

/** What a recorded row must carry for the number to be worth anything later. */
const REQUIRED_COLUMNS = ['회사', '출처', '평점', '표본', '조회일'];

/**
 * Parse the user's ratings table.
 *
 * A missing file is not an error — the whole feature is opt-in, exactly like
 * `data/blacklist.md`. Malformed rows are skipped rather than thrown on: one
 * bad line in a hand-edited table should not cost the rest.
 *
 * @param {string} text
 * @returns {{rows: Record<string, string>[], skipped: number}}
 */
export function parseRatings(text) {
  if (typeof text !== 'string' || text === '') return { rows: [], skipped: 0 };

  const rows = [];
  let skipped = 0;
  let header = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('|')) continue;

    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length === 0) continue;

    // A separator row (|---|---|) closes the header, it is not data.
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;

    if (!header) {
      // The first table row that names the required columns is the header.
      if (REQUIRED_COLUMNS.every((col) => cells.includes(col))) header = cells;
      continue;
    }

    if (cells.length !== header.length) {
      skipped += 1;
      continue;
    }

    const row = {};
    header.forEach((key, i) => {
      row[key] = cells[i];
    });

    const company = row['회사'];
    if (!company || company === '—') {
      skipped += 1;
      continue;
    }
    row._key = normalizeCompany(company);
    // Second, wider key so a row written as "㈜아크미" is found by "아크미".
    const [, korean] = companyKeys(company);
    if (korean) row._keyKr = korean;
    rows.push(row);
  }

  return { rows, skipped };
}

/**
 * @param {string} [filePath]
 * @returns {{rows: Record<string, string>[], skipped: number, exists: boolean, path: string}}
 */
export function loadRatings(filePath = RATINGS_PATH) {
  let text = '';
  let exists = true;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    exists = false;
  }
  const { rows, skipped } = parseRatings(text);
  return { rows, skipped, exists, path: filePath };
}

/**
 * Every recorded row for one company. Matching goes through the same
 * normalizer the tracker and the blacklist gate use, so "㈜아크미", "아크미"
 * and "아크미 주식회사" all find each other.
 *
 * @param {{rows: Record<string, string>[]}} loaded
 * @param {string} company
 * @returns {Record<string, string>[]}
 */
export function findCompanyRatings(loaded, company) {
  const keys = new Set(companyKeys(company || ''));
  if (keys.size === 0) return [];
  return (loaded?.rows || []).filter(
    (r) => keys.has(r._key) || (r._keyKr && keys.has(r._keyKr)),
  );
}

/**
 * How old a recorded reading is, in days. A rating with no usable date is
 * treated as undated rather than as today — guessing would make a stale number
 * look fresh.
 *
 * @param {string} value
 * @param {number} [now]
 * @returns {number | null}
 */
export function ageInDays(value, now = Date.now()) {
  if (typeof value !== 'string') return null;
  const match = value.match(/\d{4}-\d{2}-\d{2}/);
  if (!match) return null;
  const ms = Date.parse(`${match[0]}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return Math.floor((now - ms) / 86_400_000);
}

/** Beyond this, a recorded rating is shown with a staleness note. */
export const STALE_AFTER_DAYS = 180;

/**
 * @param {string} company
 * @param {{rows: Record<string, string>[], exists: boolean, path: string}} loaded
 * @param {number} [now]
 * @returns {string}
 */
export function renderCompany(company, loaded, now = Date.now()) {
  const lines = [];
  lines.push(`회사: ${company}`);
  lines.push('');

  const found = findCompanyRatings(loaded, company);
  if (found.length > 0) {
    lines.push('기록해 둔 평판');
    for (const row of found) {
      const age = ageInDays(row['조회일'], now);
      const stale =
        age != null && age > STALE_AFTER_DAYS ? `  ← ${age}일 전 값이다. 다시 본다` : '';
      const sample = row['표본'] && row['표본'] !== '—' ? ` · 표본 ${row['표본']}` : '';
      const who = row['재직/전직'] && row['재직/전직'] !== '—' ? ` · ${row['재직/전직']}` : '';
      lines.push(
        `  - ${row['출처']}: ${row['평점']}${sample}${who} · ${row['조회일']}${stale}`,
      );
      if (row['메모'] && row['메모'] !== '—') lines.push(`      ${row['메모']}`);
    }
    if (found.length > 1) {
      lines.push('');
      lines.push(
        '  출처가 여럿이면 숫자를 평균 내지 않는다. 모수가 다른 값이라 평균이 뜻을 갖지 않는다.',
      );
    }
  } else if (!loaded.exists) {
    lines.push('기록해 둔 평판: 없음');
    lines.push(`  기록 파일이 아직 없다. 만들려면: cp ${TEMPLATE_REL} data/회사평점.md`);
  } else {
    lines.push('기록해 둔 평판: 없음 (이 회사는 아직 안 적었다)');
  }

  lines.push('');
  lines.push('직접 열어볼 곳');
  for (const source of LOOKUP_SOURCES) {
    lines.push(`  - ${source.label}: ${source.search(company)}`);
    lines.push(`      ${source.what}`);
  }

  lines.push('');
  lines.push('읽을 때');
  lines.push('  - 평점은 공고 점수에 더해지지 않는다. 판단할 때 같이 보는 자료다');
  lines.push('  - 낮은 평점이 지원하지 말라는 뜻은 아니다. 표본과 시점을 같이 본다');
  lines.push('  - 리뷰에서 걸리는 게 있으면 면접에서 확인할 질문으로 바꿔 둔다');

  return lines.join('\n');
}

/**
 * @param {{rows: Record<string, string>[], skipped: number, exists: boolean, path: string}} loaded
 * @param {number} [now]
 * @returns {string}
 */
export function renderSummary(loaded, now = Date.now()) {
  if (!loaded.exists) {
    return [
      '기록 파일이 없다.',
      `만들려면: cp ${TEMPLATE_REL} data/회사평점.md`,
      '',
      '이 파일은 본인이 채우는 것이고, 도구가 만들거나 고치지 않는다.',
    ].join('\n');
  }

  if (loaded.rows.length === 0) {
    return `${loaded.path}에 아직 기록이 없다.`;
  }

  const byCompany = new Map();
  for (const row of loaded.rows) {
    if (!byCompany.has(row._key)) byCompany.set(row._key, []);
    byCompany.get(row._key).push(row);
  }

  const lines = [`기록된 회사 ${byCompany.size}곳 · 행 ${loaded.rows.length}개`, ''];
  for (const rows of byCompany.values()) {
    lines.push(`${rows[0]['회사']}`);
    for (const row of rows) {
      const age = ageInDays(row['조회일'], now);
      const stale = age != null && age > STALE_AFTER_DAYS ? ' (오래됨)' : '';
      lines.push(`  ${row['출처']}: ${row['평점']} · 표본 ${row['표본']} · ${row['조회일']}${stale}`);
    }
  }
  if (loaded.skipped > 0) {
    lines.push('');
    lines.push(`칸 수가 안 맞아 건너뛴 줄: ${loaded.skipped}개`);
  }
  return lines.join('\n');
}

function parseArgs(argv) {
  const args = { company: null, summary: false, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--company') args.company = argv[++i] || null;
    else if (arg === '--summary') args.summary = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

const HELP = `company-rating.mjs — 회사 평판을 같이 보기 위한 조회 도구

  node company-rating.mjs --company "아크미"   한 회사의 기록 + 조회 링크
  node company-rating.mjs --summary            기록해 둔 회사 전체
  node company-rating.mjs --company "아크미" --json

기록 파일: data/회사평점.md (없으면 조회 링크만 나온다)
만들려면:  cp ${TEMPLATE_REL} data/회사평점.md

이 도구는 네트워크를 쓰지 않고 파일을 쓰지도 않는다. 평점은 사람이 직접 보고 적는다.`;

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.company && !args.summary)) {
    console.log(HELP);
    return;
  }

  const loaded = loadRatings();

  if (args.summary) {
    if (args.json) {
      console.log(JSON.stringify({ path: loaded.path, exists: loaded.exists, rows: loaded.rows }, null, 2));
    } else {
      console.log(renderSummary(loaded));
    }
    return;
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          company: args.company,
          recorded: findCompanyRatings(loaded, args.company),
          lookups: LOOKUP_SOURCES.map((s) => ({
            id: s.id,
            label: s.label,
            url: s.search(args.company),
          })),
          note: '평점은 공고 점수에 반영되지 않는다. 판단할 때 같이 보는 자료다.',
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(renderCompany(args.company, loaded));
}

if (isMainModule(import.meta.url)) main();
