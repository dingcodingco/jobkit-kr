// company-name-kr.mjs — Korean corporate-form handling for company names.
//
// WHY THIS EXISTS. The shared normalizer (tracker-utils.mjs `normalizeCompany`)
// folds case, whitespace and punctuation, which lets "Acme Corp." match
// "acme corp". The Korean equivalents are not punctuation, so none of them fold:
//
//   아크미          -> 아크미
//   ㈜아크미        -> 주아크미
//   (주)아크미      -> 주아크미
//   아크미 주식회사  -> 아크미주식회사
//
// Three spellings of one company, three different keys. That is a real gap for
// Korean users of the blacklist gate: a row for "아크미" silently fails to catch
// a posting that says "㈜아크미", and modes/ko/gonggo.md tells the candidate
// those three are treated as the same company.
//
// WHY NOT CHANGE THE SHARED NORMALIZER. `normalizeCompany` is the tracker's key
// function. Changing what it returns would re-key every row a user has already
// written, silently orphaning their history. So this module ADDS a second key
// instead: callers match on the shared key first and fall back to this one,
// which widens matching without moving anything that already exists.
//
// SCOPE. Only legal-entity forms are stripped, and only where they sit at the
// start or the end of the name. A company whose actual name contains one of
// these words in the middle keeps it.

import { normalizeCompany } from './tracker-utils.mjs';

/**
 * Korean legal entity forms, longest first so "주식회사" is consumed before
 * the shorter "회사" inside it could be.
 *
 * Bracketed and circled variants (㈜, (주), （주）) are normalized to their
 * plain form before this list is applied, so each form appears once.
 */
const ENTITY_FORMS = [
  '주식회사',
  '유한책임회사',
  '유한회사',
  '합자회사',
  '합명회사',
  '사단법인',
  '재단법인',
  '의료법인',
  '학교법인',
  '농업회사법인',
  '주',
  '유',
];

/** Circled and full-width variants seen in real Korean postings. */
const BRACKET_VARIANTS = [
  [/㈜/g, '(주)'],
  [/㈐/g, '(유)'],
  [/（/g, '('],
  [/）/g, ')'],
  [/［/g, '['],
  [/］/g, ']'],
];

/**
 * Strip one leading or trailing legal-entity form.
 *
 * Deliberately not global: "주식회사 아크미 주식회사" is not a real name, and a
 * global strip would eat a company genuinely called 주 something. One pass at
 * each end is what the real spellings need.
 *
 * @param {string} name
 * @returns {string}
 */
export function stripKoreanEntityForm(name) {
  if (typeof name !== 'string') return '';

  let s = name;
  for (const [pattern, replacement] of BRACKET_VARIANTS) s = s.replace(pattern, replacement);

  // Bracketed forms: (주)아크미, 아크미(주), [주]아크미
  s = s.replace(/^[([]\s*(주|유)\s*[)\]]\s*/, '');
  s = s.replace(/\s*[([]\s*(주|유)\s*[)\]]$/, '');

  const trimmed = s.trim();
  for (const form of ENTITY_FORMS) {
    // Leading: "주식회사 아크미". A separator is required so a company actually
    // named 주단위 keeps its name.
    const lead = new RegExp(`^${form}[\\s·,]+`);
    if (lead.test(trimmed)) return trimmed.replace(lead, '').trim();

    // Trailing: "아크미 주식회사".
    const tail = new RegExp(`[\\s·,]+${form}$`);
    if (tail.test(trimmed)) return trimmed.replace(tail, '').trim();
  }

  return trimmed;
}

/**
 * A second, wider key for one company name: the shared normalization applied
 * after the Korean entity form is removed.
 *
 * Returns '' when the name is empty or is nothing but an entity form, so a
 * caller can skip it rather than matching everything.
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeKoreanCompany(name) {
  const stripped = stripKoreanEntityForm(name);
  if (!stripped) return '';
  return normalizeCompany(stripped);
}

/**
 * Both keys for one name, deduped, widest last.
 *
 * Callers look a company up by trying these in order: the exact shared key
 * first, so existing behaviour is untouched, then the Korean-stripped key.
 *
 * @param {string} name
 * @returns {string[]}
 */
export function companyKeys(name) {
  const exact = normalizeCompany(name || '');
  const korean = normalizeKoreanCompany(name || '');
  const keys = [];
  if (exact) keys.push(exact);
  if (korean && korean !== exact) keys.push(korean);
  return keys;
}

/**
 * Look one company up in a Map keyed by company name, trying the exact key
 * before the wider Korean one.
 *
 * @template T
 * @param {Map<string, T>} map
 * @param {string} name
 * @returns {T | undefined}
 */
export function lookupCompany(map, name) {
  if (!map || typeof map.get !== 'function') return undefined;
  for (const key of companyKeys(name)) {
    const hit = map.get(key);
    if (hit !== undefined) return hit;
  }
  return undefined;
}
