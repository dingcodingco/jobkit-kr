// tests/company-rating.test.mjs — company reputation lookup and record.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\ncompany-rating — 회사 평판 기록');

const TABLE = [
  '| 회사 | 출처 | 평점 | 표본 | 조회일 | 재직/전직 | 메모 |',
  '|---|---|---|---|---|---|---|',
  '| 아크미 | 잡플래닛 | 3.1 / 5 | 9 | 2026-09-15 | 혼재 | 예시 |',
  '| 아크미 | 블라인드 | 3.1 / 5 | 367 | 2026-09-15 | 재직 | — |',
  '| 글로벡스 | 크레딧잡 | — | — | 2026-01-02 | — | 평점 없는 출처 |',
  '| 칸수가 | 모자란 | 줄 |',
  '| | 잡플래닛 | 4.0 | 10 | 2026-09-15 | 혼재 | 회사명 없음 |',
].join('\n');

try {
  const {
    parseRatings,
    findCompanyRatings,
    ageInDays,
    renderCompany,
    renderSummary,
    loadRatings,
    LOOKUP_SOURCES,
    STALE_AFTER_DAYS,
  } = await import(pathToFileURL(join(ROOT, 'company-rating.mjs')).href);

  // ------------------------------------------------------------------- parse

  const { rows, skipped } = parseRatings(TABLE);
  if (rows.length === 3) pass('parseRatings() reads the three complete rows');
  else fail(`parseRatings() returned ${rows.length} rows`);

  if (skipped === 2) pass('a short row and a row with no company are skipped, not thrown on');
  else fail(`skipped count was ${skipped}`);

  if (rows[0]['출처'] === '잡플래닛' && rows[0]['표본'] === '9') {
    pass('columns are keyed by their header names');
  } else {
    fail(`first row parsed as ${JSON.stringify(rows[0])}`);
  }

  if (parseRatings('').rows.length === 0 && parseRatings(null).rows.length === 0) {
    pass('empty input returns no rows rather than throwing');
  } else {
    fail('empty input misbehaved');
  }

  // A file with no table at all must not invent rows.
  if (parseRatings('# 제목\n\n본문만 있고 표는 없다.').rows.length === 0) {
    pass('a file with no table returns no rows');
  } else {
    fail('a table-less file produced rows');
  }

  // --------------------------------------------------------------- lookup

  const loaded = { rows, exists: true, path: 'test' };
  if (findCompanyRatings(loaded, '아크미').length === 2) {
    pass('both recorded sources are found for one company');
  } else {
    fail('lookup did not return both sources');
  }

  // The Korean corporate-form layer must apply here too.
  if (
    findCompanyRatings(loaded, '㈜아크미').length === 2 &&
    findCompanyRatings(loaded, '아크미 주식회사').length === 2
  ) {
    pass('a company is found through its legal-entity spellings');
  } else {
    fail('legal-entity spellings did not match the recorded rows');
  }

  if (findCompanyRatings(loaded, '없는회사').length === 0) {
    pass('an unrecorded company returns nothing');
  } else {
    fail('an unrecorded company matched something');
  }
  if (findCompanyRatings(loaded, '').length === 0) {
    pass('an empty name matches nothing rather than everything');
  } else {
    fail('an empty name matched rows');
  }

  // ------------------------------------------------------------------ age

  const now = Date.parse('2026-09-15T00:00:00Z');
  if (ageInDays('2026-09-15', now) === 0 && ageInDays('2026-09-05', now) === 10) {
    pass('ageInDays() counts days from the recorded date');
  } else {
    fail(`ageInDays() returned ${ageInDays('2026-09-05', now)}`);
  }
  if (ageInDays('기억 안 남', now) === null && ageInDays(null, now) === null) {
    pass('an undated reading stays undated rather than counting as today');
  } else {
    fail('an undated reading was given an age');
  }

  // --------------------------------------------------------------- render

  const out = renderCompany('아크미', loaded, now);
  if (out.includes('표본 9') && out.includes('표본 367')) {
    pass('the sample size is shown next to each rating');
  } else {
    fail('the sample size was not shown');
  }
  if (out.includes('평균 내지 않는다')) {
    pass('multiple sources come with a do-not-average note');
  } else {
    fail('the do-not-average note is missing');
  }
  if (out.includes('공고 점수에 더해지지 않는다')) {
    pass('the output states that a rating does not change the posting score');
  } else {
    fail('the score-separation note is missing');
  }
  if (out.includes('지원하지 말라는 뜻은 아니다')) {
    pass('the output refuses to read a low rating as a verdict');
  } else {
    fail('the no-verdict note is missing');
  }
  for (const source of LOOKUP_SOURCES) {
    if (!out.includes(source.label)) fail(`lookup link missing for ${source.label}`);
  }
  pass('every lookup source is printed');

  // A stale reading has to say so.
  const later = Date.parse('2026-09-15T00:00:00Z') + (STALE_AFTER_DAYS + 5) * 86_400_000;
  if (renderCompany('아크미', loaded, later).includes('다시 본다')) {
    pass('a reading older than the staleness window is flagged');
  } else {
    fail('a stale reading was not flagged');
  }
  if (!renderCompany('아크미', loaded, now).includes('다시 본다')) {
    pass('a fresh reading is not flagged');
  } else {
    fail('a fresh reading was flagged as stale');
  }

  // A missing file points at the template instead of erroring.
  const absent = renderCompany('아크미', { rows: [], exists: false, path: 'x' }, now);
  if (absent.includes('templates/company-ratings.kr.example.md')) {
    pass('a missing record file names the template to copy');
  } else {
    fail('a missing record file did not name the template');
  }

  // ------------------------------------------------------------- summary

  const summary = renderSummary(loaded, now);
  if (summary.includes('기록된 회사 2곳') && summary.includes('행 3개')) {
    pass('the summary counts companies and rows');
  } else {
    fail(`summary header was ${summary.split('\n')[0]}`);
  }
  if (renderSummary({ rows: [], exists: false, path: 'x' }, now).includes('cp templates/')) {
    pass('an absent file summary tells the user how to create it');
  } else {
    fail('the absent-file summary is unhelpful');
  }

  // ---------------------------------------------------- lookup sources

  // The reason a source is not fetched has to travel with the source, so a
  // later change cannot quietly add a fetcher for a site that blocked us.
  const jobplanet = LOOKUP_SOURCES.find((s) => s.id === 'jobplanet');
  const blind = LOOKUP_SOURCES.find((s) => s.id === 'blind');
  if (jobplanet?.blocksAutomation && blind?.blocksAutomation) {
    pass('sites that block automation carry the reason they are not fetched');
  } else {
    fail('a blocking site lost its reason');
  }
  if (LOOKUP_SOURCES.every((s) => typeof s.search === 'function' && s.search('아크미').startsWith('https://'))) {
    pass('every source builds an https lookup URL');
  } else {
    fail('a source built a non-https URL');
  }
  if (LOOKUP_SOURCES.every((s) => !/\s/.test(s.search('아크 미')))) {
    pass('a company name with a space is encoded into the URL');
  } else {
    fail('a space leaked into a lookup URL');
  }

  // A missing file is not an error anywhere in the load path.
  const missing = loadRatings(join(ROOT, 'data', '존재하지-않는-파일.md'));
  if (missing.exists === false && missing.rows.length === 0) {
    pass('loadRatings() treats a missing file as opt-out, not as an error');
  } else {
    fail('loadRatings() mishandled a missing file');
  }
} catch (err) {
  fail(`company-rating tests threw: ${err?.stack || err}`);
}
