// tests/company-name-kr.test.mjs — Korean corporate-form name matching.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\ncompany-name-kr — 한국 법인 표기 매칭');

try {
  const { stripKoreanEntityForm, normalizeKoreanCompany, companyKeys, lookupCompany } =
    await import(pathToFileURL(join(ROOT, 'company-name-kr.mjs')).href);
  const { normalizeCompany } = await import(
    pathToFileURL(join(ROOT, 'tracker-utils.mjs')).href
  );

  // The three spellings modes/ko/gonggo.md promises are one company.
  const spellings = ['아크미', '㈜아크미', '(주)아크미', '아크미 주식회사', '주식회사 아크미', '아크미(주)'];
  const stripped = spellings.map(stripKoreanEntityForm);
  if (stripped.every((s) => s === '아크미')) {
    pass('every legal-entity spelling strips to the same name');
  } else {
    fail(`stripped to ${JSON.stringify(stripped)}`);
  }

  const keys = spellings.map((s) => normalizeKoreanCompany(s));
  if (new Set(keys).size === 1) {
    pass('every spelling produces one Korean key');
  } else {
    fail(`keys were ${JSON.stringify(keys)}`);
  }

  // Full-width brackets appear in real postings.
  if (stripKoreanEntityForm('（주）아크미') === '아크미') {
    pass('full-width brackets are handled');
  } else {
    fail(`full-width bracket form became ${stripKoreanEntityForm('（주）아크미')}`);
  }

  // Other entity forms.
  if (
    stripKoreanEntityForm('유한회사 글로벡스') === '글로벡스' &&
    stripKoreanEntityForm('재단법인 이니텍') === '이니텍' &&
    stripKoreanEntityForm('농업회사법인 하늘농원') === '하늘농원'
  ) {
    pass('other legal-entity forms are stripped');
  } else {
    fail('an entity form was not stripped');
  }

  // A name that merely contains the letters must survive. This is the reason
  // the strip requires a separator and only runs at the ends.
  if (
    stripKoreanEntityForm('아크미주식') === '아크미주식' &&
    stripKoreanEntityForm('주단위') === '주단위' &&
    stripKoreanEntityForm('회사원닷컴') === '회사원닷컴'
  ) {
    pass('a real name containing the same letters is left alone');
  } else {
    fail('a real name was damaged by the strip');
  }

  // Latin names keep going through the shared normalizer untouched.
  if (normalizeKoreanCompany('ACME Corp.') === normalizeCompany('ACME Corp.')) {
    pass('a Latin name is unchanged by the Korean layer');
  } else {
    fail('the Korean layer changed a Latin name');
  }

  // Degenerate input must not produce a key that matches everything.
  if (
    normalizeKoreanCompany('') === '' &&
    normalizeKoreanCompany(null) === '' &&
    companyKeys('').length === 0 &&
    companyKeys(undefined).length === 0
  ) {
    pass('empty input produces no key');
  } else {
    fail('empty input produced a key');
  }

  // A bare entity form is a name, not a wildcard.
  if (stripKoreanEntityForm('주식회사') === '주식회사') {
    pass('a bare entity form is left as a name rather than emptied');
  } else {
    fail('a bare entity form was emptied into a wildcard');
  }

  // Key order matters: exact first, so existing matches never change.
  const both = companyKeys('㈜아크미');
  if (both[0] === normalizeCompany('㈜아크미') && both[1] === '아크미') {
    pass('the exact key is tried before the wider Korean one');
  } else {
    fail(`companyKeys returned ${JSON.stringify(both)}`);
  }
  if (companyKeys('아크미').length === 1) {
    pass('a name with no entity form yields a single key');
  } else {
    fail('a plain name produced a duplicate key');
  }

  // lookupCompany over a Map, which is how the blacklist gate is keyed.
  const map = new Map([[normalizeCompany('아크미'), { reason: '예시' }]]);
  const hits = spellings.map((s) => Boolean(lookupCompany(map, s)));
  if (hits.every(Boolean)) {
    pass('a blacklist row for 아크미 catches every spelling');
  } else {
    fail(`lookup hits were ${JSON.stringify(hits)}`);
  }
  if (lookupCompany(map, '글로벡스') === undefined) {
    pass('an unrelated company is not matched');
  } else {
    fail('an unrelated company matched');
  }
  if (lookupCompany(null, '아크미') === undefined && lookupCompany(map, '') === undefined) {
    pass('lookupCompany tolerates a missing map and an empty name');
  } else {
    fail('lookupCompany mishandled degenerate input');
  }

  // The blacklist gate itself, end to end.
  const { parseBlacklist } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);
  const blacklist = parseBlacklist(
    '| Company | Since | Scope | Reason |\n|---|---|---|---|\n| 아크미 | 2026-01-01 | company | 예시 |',
  );
  const blocked = spellings.map((s) => Boolean(lookupCompany(blacklist, s)));
  if (blocked.every(Boolean)) {
    pass('the blacklist gate blocks every Korean spelling of a listed company');
  } else {
    fail(`blacklist hits were ${JSON.stringify(blocked)}`);
  }
} catch (err) {
  fail(`company-name-kr tests threw: ${err?.stack || err}`);
}
