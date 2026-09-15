// tests/providers/greeting.test.mjs — Greeting (그리팅) Korean ATS provider.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — greeting');

/**
 * One opening record in the shape the live RSC payload embeds, with the
 * backslash-escaped quotes the page actually ships.
 */
function record({
  id = 1001,
  title = 'CRM 마케터',
  company = '아크미',
  openDate = '2026-08-11T02:44:54Z',
  dueDate = null,
  employment = 'FULL_TIME_WORKER',
  careerType = 'EXPERIENCED',
  careerFrom = 3,
  careerTo = null,
  occupation = '마케팅',
  place = '대한민국 서울특별시 강남구 테헤란로 518',
  workFromHome = false,
  deploy = true,
} = {}) {
  const json = JSON.stringify({
    deploy,
    fixed: false,
    openingJobPosition: {
      openingJobPositionSetting: { id: 1, maxPriority: 1 },
      openingJobPositions: [
        {
          id: 2,
          workspaceField: null,
          workspaceOccupation: occupation ? { id: 3, occupation, sortOrder: 1 } : null,
          workspaceJob: null,
          workspacePlace: place
            ? { id: 4, location: 'HQ', place, detailPlace: '4층', workFromHome, geo: null, sortOrder: 0 }
            : null,
          jobPositionCareer: careerType
            ? { id: 5, careerFrom, careerTo, careerType }
            : null,
          jobPositionEmployment: employment
            ? { id: 6, employmentType: employment }
            : null,
        },
      ],
      openingJobPositionCount: 1,
      fieldCount: 0,
      occupationCount: 1,
      jobCount: 0,
      placeCount: 1,
      careerCount: 1,
      employmentCount: 1,
    },
    openingId: id,
    title,
    workspaceDivision: null,
    openDate,
    dueDate,
    deadlineDDay: null,
    group: { name: company, imageUrl: 'https://profiles.greetinghr.com/group/abc' },
  });
  // The live page ships this JSON inside a JS string literal.
  return json.replace(/"/g, '\\"');
}

function page(...records) {
  return `<!doctype html><html><body><script>self.__next_f.push([1,"${records.join(',')}"])</script></body></html>`;
}

try {
  const {
    default: greeting,
    parseGreetingBoard,
    normalizeGreetingJob,
    formatGreetingLocation,
    buildGreetingDescription,
    subdomainFromCareersUrl,
    resolveGreetingCompanies,
    buildGreetingBoardUrl,
  } = await import(pathToFileURL(join(ROOT, 'providers/greeting.mjs')).href);

  // ---------------------------------------------------------------- identity

  if (greeting.id === 'greeting') pass('greeting.id is "greeting"');
  else fail(`greeting.id is "${greeting.id}"`);

  // ------------------------------------------------------------------ detect

  if (
    greeting.detect({ provider: 'greeting', greeting_companies: ['finda'] })?.url ===
    'https://finda.career.greetinghr.com/ko'
  ) {
    pass('detect() claims an explicit greeting entry');
  } else {
    fail('detect() failed on an explicit greeting entry');
  }

  if (greeting.detect({ provider: 'other', greeting_companies: ['finda'] }) === null) {
    pass('detect() ignores other provider ids');
  } else {
    fail('detect() should ignore other provider ids');
  }

  if (greeting.detect({ provider: 'greeting' }) === null) {
    pass('detect() returns null when no company is configured');
  } else {
    fail('detect() should return null with no company configured');
  }

  // detect() must never throw, whatever it is handed.
  let detectThrew = false;
  for (const junk of [null, undefined, {}, { provider: 'greeting', greeting_companies: 'nope' },
    { provider: 'greeting', careers_url: 'not a url' }, { careers_url: 42 }, []]) {
    try {
      greeting.detect(junk);
    } catch {
      detectThrew = true;
    }
  }
  if (!detectThrew) pass('detect() never throws on junk input');
  else fail('detect() threw on junk input');

  // ------------------------------------------------------- company resolution

  const companies = resolveGreetingCompanies({
    greeting_companies: ['Finda', 'finda', 'bad name!', 'MUSINSA', '', null, 'a'.repeat(80)],
    careers_url: 'https://oliveyoung.career.greetinghr.com/ko',
  });
  if (
    JSON.stringify(companies.map((c) => c.label)) ===
    JSON.stringify(['finda', 'musinsa', 'oliveyoung'])
  ) {
    pass('resolveGreetingCompanies() lowercases, dedupes and drops invalid subdomains');
  } else {
    fail(`resolveGreetingCompanies() returned ${JSON.stringify(companies)}`);
  }

  // A customer serving its board from its own domain. Listing the host is the
  // user vouching for it, which is what makes a redirect into it followable.
  const custom = resolveGreetingCompanies({
    greeting_companies: ['finda', 'www.musinsacareers.com'],
  });
  if (
    custom.length === 2 &&
    custom[0].host === 'finda.career.greetinghr.com' &&
    custom[0].declared === false &&
    custom[1].host === 'www.musinsacareers.com' &&
    custom[1].declared === true
  ) {
    pass('a full hostname is accepted as a user-declared custom domain');
  } else {
    fail(`custom domain resolution returned ${JSON.stringify(custom)}`);
  }

  // The platform suffix must never be glued onto a custom domain.
  const customJob = parseGreetingBoard(page(record({ id: 55 })), 'www.musinsacareers.com')[0];
  if (customJob?.url === 'https://www.musinsacareers.com/ko/o/55') {
    pass('a custom-domain board emits URLs on that domain');
  } else {
    fail(`custom-domain job url is ${customJob?.url}`);
  }

  if (
    subdomainFromCareersUrl('https://finda.career.greetinghr.com') === 'finda' &&
    subdomainFromCareersUrl('https://evil.com') === null &&
    subdomainFromCareersUrl('https://career.greetinghr.com.evil.com') === null &&
    subdomainFromCareersUrl('nonsense') === null &&
    subdomainFromCareersUrl(null) === null
  ) {
    pass('subdomainFromCareersUrl() accepts only real Greeting hosts');
  } else {
    fail('subdomainFromCareersUrl() accepted a host it should not');
  }

  // -------------------------------------------------------------- parse shape

  const jobs = parseGreetingBoard(page(record()), 'acme');
  if (jobs.length === 1) pass('parseGreetingBoard() returns one job for one record');
  else fail(`parseGreetingBoard() returned ${jobs.length} jobs`);

  const job = jobs[0];
  if (job?.url === 'https://acme.career.greetinghr.com/ko/o/1001') {
    pass('job url is built from the subdomain and openingId');
  } else {
    fail(`job url is ${job?.url}`);
  }
  if (job?.title === 'CRM 마케터' && job?.company === '아크미') {
    pass('title and company are normalized');
  } else {
    fail(`title/company are ${job?.title} / ${job?.company}`);
  }
  if (job?.postedAt === Date.parse('2026-08-11T02:44:54Z')) {
    pass('openDate becomes postedAt in epoch ms');
  } else {
    fail(`postedAt is ${job?.postedAt}`);
  }
  if (job?.salary === undefined) {
    pass('no salary is emitted (Greeting publishes none)');
  } else {
    fail('salary must not be emitted');
  }
  if (job?.description === '마케팅 · 정규직 · 경력 3년 이상') {
    pass('description folds occupation, employment type and career band');
  } else {
    fail(`description is ${JSON.stringify(job?.description)}`);
  }

  // A row with no title has nothing to match on, and one with no id has no URL.
  const filtered = parseGreetingBoard(
    page(record({ id: 1 }), record({ id: 2, title: '   ' }), record({ id: null, title: '유효' })),
    'acme',
  );
  if (filtered.length === 1 && filtered[0].url.endsWith('/1')) {
    pass('rows missing a title or an id are dropped');
  } else {
    fail(`expected 1 job, got ${filtered.length}`);
  }

  // Unpublished rows should not reach the pipeline.
  if (parseGreetingBoard(page(record({ deploy: false })), 'acme').length === 0) {
    pass('undeployed records are skipped');
  } else {
    fail('undeployed records must be skipped');
  }

  // Same opening embedded twice — dedup by url.
  if (parseGreetingBoard(page(record(), record()), 'acme').length === 1) {
    pass('duplicate records collapse by url');
  } else {
    fail('duplicate records were not deduped');
  }

  // A malformed record must cost only itself.
  const mixed = `<html><script>self.__next_f.push([1,"${record({ id: 7 })},{\\"deploy\\":true,\\"fixed\\":false,\\"openingJobPosition\\":{\\"broken\\":,\\"group\\":{}}"])</script></html>`;
  if (parseGreetingBoard(mixed, 'acme').length === 1) {
    pass('a malformed record is skipped without losing the good one');
  } else {
    fail('a malformed record took down the whole board');
  }

  // -------------------------------------------------------- date safety

  const undated = parseGreetingBoard(page(record({ openDate: 'not-a-date' })), 'acme')[0];
  if (undated && !('postedAt' in undated)) {
    pass('an unparseable openDate leaves postedAt absent rather than NaN');
  } else {
    fail(`postedAt is ${undated?.postedAt}`);
  }
  const epochZero = normalizeGreetingJob(
    { openingId: 9, title: 'T', openDate: '1970-01-01T00:00:00Z', group: { name: 'C' } },
    'acme',
  );
  if (epochZero?.postedAt === 0) {
    pass('epoch 0 survives (not swallowed by a falsy check)');
  } else {
    fail(`epoch 0 became ${epochZero?.postedAt}`);
  }

  // ------------------------------------------------------------ location

  if (
    formatGreetingLocation({ place: '서울시 강남구', location: 'HQ' }) === '서울시 강남구' &&
    formatGreetingLocation({ place: '', location: 'HQ' }) === 'HQ' &&
    formatGreetingLocation({ place: '서울시', workFromHome: true }) === '서울시 · 재택 가능' &&
    formatGreetingLocation(null) === ''
  ) {
    pass('formatGreetingLocation() prefers the address and marks remote');
  } else {
    fail('formatGreetingLocation() output was wrong');
  }

  // --------------------------------------------- employment type filtering

  const twoTypes = page(
    record({ id: 10, employment: 'FULL_TIME_WORKER' }),
    record({ id: 11, employment: 'CONTRACT_WORKER' }),
  );
  const fullTimeOnly = parseGreetingBoard(twoTypes, 'acme', new Set(['FULL_TIME_WORKER']));
  if (fullTimeOnly.length === 1 && fullTimeOnly[0].url.endsWith('/10')) {
    pass('greeting_employment filters on the structured field, not on title wording');
  } else {
    fail(`employment filter returned ${fullTimeOnly.length} jobs`);
  }
  if (parseGreetingBoard(twoTypes, 'acme', new Set()).length === 2) {
    pass('an empty employment filter is treated as no filter');
  } else {
    fail('an empty employment filter should not drop anything');
  }

  // An unknown enum member must pass through as itself.
  const unknownType = parseGreetingBoard(page(record({ employment: 'NEW_ENUM_VALUE' })), 'acme')[0];
  if (unknownType?.description?.includes('NEW_ENUM_VALUE')) {
    pass('an unrecognized employmentType is surfaced verbatim');
  } else {
    fail(`unknown employmentType became ${JSON.stringify(unknownType?.description)}`);
  }

  // A deadline is unusual in Korea, so it is only shown when present.
  const withDue = parseGreetingBoard(page(record({ dueDate: '2026-10-31T14:59:59Z' })), 'acme')[0];
  if (withDue?.description?.includes('마감 2026-10-31')) {
    pass('a present dueDate is surfaced in the description');
  } else {
    fail(`dueDate handling produced ${JSON.stringify(withDue?.description)}`);
  }
  if (!parseGreetingBoard(page(record()), 'acme')[0].description.includes('마감')) {
    pass('a null dueDate adds nothing (상시채용 is normal here)');
  } else {
    fail('a null dueDate should not produce a 마감 line');
  }

  // ------------------------------------------------- empty vs changed layout

  if (
    parseGreetingBoard('', 'acme').length === 0 &&
    parseGreetingBoard('<html>openingId absent but greetinghr present</html>', 'acme').length === 0
  ) {
    pass('an empty board returns [] rather than throwing');
  } else {
    fail('an empty board should return []');
  }

  let layoutThrew = null;
  try {
    parseGreetingBoard('<html><body>완전히 다른 페이지</body></html>', 'acme');
  } catch (err) {
    layoutThrew = err;
  }
  if (layoutThrew && /layout may have changed/.test(layoutThrew.message) &&
      /acme/.test(layoutThrew.message)) {
    pass('a page with no Greeting markers throws a descriptive error');
  } else {
    fail('an unrecognized page should throw a descriptive error');
  }

  // -------------------------------------------------------- fetch behaviour

  function makeCtx(handler) {
    const calls = [];
    return {
      calls,
      ctx: {
        transport: 'http',
        async fetchText(url, opts) {
          calls.push({ url, opts });
          return handler(url, opts, calls.length);
        },
        async fetchJson() {
          throw new Error('greeting must not call fetchJson');
        },
        async fetchResponse() {
          throw new Error('greeting must not call fetchResponse');
        },
        sleep: async () => {},
      },
    };
  }

  {
    const { ctx, calls } = makeCtx(() => page(record()));
    const out = await greeting.fetch(
      { provider: 'greeting', greeting_companies: ['finda', 'musinsa'] },
      ctx,
    );
    if (out.length === 2) pass('fetch() returns jobs from every configured company');
    else fail(`fetch() returned ${out.length} jobs`);

    // Boards always redirect, so the first attempt has to read the Location
    // header. What matters is that a redirect is never followed blindly: every
    // hop target is re-checked against the allowlist before it is requested,
    // and the last attempt refuses outright so a loop terminates.
    if (calls.every((c) => c.opts?.redirect === 'manual' || c.opts?.redirect === 'error')) {
      pass('every request pins an explicit redirect policy');
    } else {
      fail('a request left the redirect policy unset');
    }
    if (calls.every((c) => c.url.startsWith('https://') && c.url.includes('.career.greetinghr.com/ko'))) {
      pass('every request goes to a Greeting host over HTTPS');
    } else {
      fail(`a request went somewhere unexpected: ${calls.map((c) => c.url).join(', ')}`);
    }
  }

  {
    // A probe passes maxPages: 1 and must cost exactly one request.
    const { ctx, calls } = makeCtx(() => page(record()));
    ctx.maxPages = 1;
    await greeting.fetch(
      { provider: 'greeting', greeting_companies: ['finda', 'musinsa', 'oliveyoung'] },
      ctx,
    );
    if (calls.length === 1) pass('ctx.maxPages = 1 stops after one company (probe budget)');
    else fail(`probe made ${calls.length} requests`);
  }

  {
    // The caller's own cap still applies.
    const { ctx, calls } = makeCtx(() => page(record()));
    await greeting.fetch(
      { provider: 'greeting', greeting_companies: ['a', 'b', 'c', 'd'], max_pages: 2 },
      ctx,
    );
    if (calls.length === 2) pass('max_pages caps how many companies are swept');
    else fail(`max_pages: 2 made ${calls.length} requests`);
  }

  {
    // A ctx rejection must reach the caller unwrapped so a probe budget error
    // keeps its identity.
    const marker = new Error('ProbePageBudgetReached');
    const { ctx } = makeCtx(() => {
      throw marker;
    });
    let caught = null;
    try {
      await greeting.fetch({ provider: 'greeting', greeting_companies: ['finda'] }, ctx);
    } catch (err) {
      caught = err;
    }
    if (caught === marker) pass('a ctx rejection propagates unwrapped');
    else fail(`rejection was wrapped: ${caught?.message}`);
  }

  {
    // No companies configured is a configuration error, not an empty result:
    // returning [] would read as "this board has nothing open".
    const { ctx } = makeCtx(() => page(record()));
    let caught = null;
    try {
      await greeting.fetch({ provider: 'greeting' }, ctx);
    } catch (err) {
      caught = err;
    }
    if (caught && /greeting_companies/.test(caught.message)) {
      pass('fetch() throws a descriptive error when no company is configured');
    } else {
      fail(`missing-company error was ${caught?.message}`);
    }
  }

  {
    // The host guard must fire before any network call. A subdomain that could
    // escape the allowlist is dropped at resolution time, so the board ends up
    // with nothing to sweep rather than fetching an attacker-chosen host.
    const { ctx, calls } = makeCtx(() => page(record()));
    let caught = null;
    try {
      await greeting.fetch(
        { provider: 'greeting', greeting_companies: ['evil.com/x', '../../etc'] },
        ctx,
      );
    } catch (err) {
      caught = err;
    }
    if (caught && calls.length === 0) {
      pass('a hostile subdomain never reaches the network');
    } else {
      fail(`hostile subdomain made ${calls.length} requests`);
    }
  }

  // buildGreetingBoardUrl is the single place the host is assembled.
  if (buildGreetingBoardUrl('finda') === 'https://finda.career.greetinghr.com/ko') {
    pass('buildGreetingBoardUrl() builds the Korean root path');
  } else {
    fail(`buildGreetingBoardUrl() returned ${buildGreetingBoardUrl('finda')}`);
  }

  if (buildGreetingDescription({}) === '') {
    pass('buildGreetingDescription() tolerates an empty record');
  } else {
    fail('buildGreetingDescription() should return "" for an empty record');
  }
} catch (err) {
  fail(`greeting provider tests threw: ${err?.stack || err}`);
}
