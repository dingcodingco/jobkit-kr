// tests/providers/saramin.test.mjs — Saramin Open API provider.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — saramin');

const KEY = 'TEST-ACCESS-KEY-DO-NOT-LEAK';

function row({
  title = 'CRM 마케터',
  company = '아크미',
  location = '서울 &gt; 강남구',
  url = 'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=1',
  postingDate = '2026-08-11T11:44:54+09:00',
  expirationDate = '2026-10-31T23:59:59+09:00',
  jobType = '정규직',
  experience = '경력 3~7년',
  industry = '금융',
} = {}) {
  return {
    url,
    active: 1,
    company: { detail: { href: 'https://www.saramin.co.kr/x', name: company } },
    position: {
      title,
      industry: industry ? { code: '1', name: industry } : undefined,
      location: location ? { code: '101', name: location } : undefined,
      'job-type': jobType ? { code: '1', name: jobType } : undefined,
      'experience-level': experience ? { code: '2', name: experience } : undefined,
    },
    'posting-date': postingDate,
    'expiration-date': expirationDate,
  };
}

const page = (jobs, total = jobs.length) => ({
  jobs: { count: jobs.length, start: 0, total, job: jobs },
});

try {
  const {
    default: saramin,
    buildSaraminUrl,
    parseSaraminPage,
    normalizeSaraminJob,
    resolveAccessKey,
    redact,
  } = await import(pathToFileURL(join(ROOT, 'providers/saramin.mjs')).href);

  // ---------------------------------------------------------------- identity

  if (saramin.id === 'saramin') pass('saramin.id is "saramin"');
  else fail(`saramin.id is "${saramin.id}"`);

  if (saramin.detect({ provider: 'saramin' })?.url === 'https://oapi.saramin.co.kr/job-search') {
    pass('detect() claims an explicit saramin entry');
  } else {
    fail('detect() failed on an explicit saramin entry');
  }
  if (saramin.detect({ provider: 'other' }) === null) {
    pass('detect() ignores other provider ids');
  } else {
    fail('detect() should ignore other provider ids');
  }
  let detectThrew = false;
  for (const junk of [null, undefined, {}, [], { provider: 42 }, 'string']) {
    try {
      saramin.detect(junk);
    } catch {
      detectThrew = true;
    }
  }
  if (!detectThrew) pass('detect() never throws on junk input');
  else fail('detect() threw on junk input');

  // ------------------------------------------------------------ key handling

  if (
    resolveAccessKey({}, { SARAMIN_ACCESS_KEY: '  abc  ' }) === 'abc' &&
    resolveAccessKey({}, {}) === '' &&
    resolveAccessKey({ saramin_access_key_env: 'OTHER_KEY' }, { OTHER_KEY: 'xyz' }) === 'xyz'
  ) {
    pass('the access key comes from the environment, with a renameable variable');
  } else {
    fail('access key resolution is wrong');
  }

  // A key must never survive into something loggable.
  const url = buildSaraminUrl({ saramin_keywords: 'CRM' }, KEY, 0, 110);
  if (url.includes(KEY)) pass('the key is sent in the request');
  else fail('the key never reached the request');
  if (!redact(url).includes(KEY) && redact(url).includes('access-key=<redacted>')) {
    pass('redact() removes the key from a URL');
  } else {
    fail(`redact() left the key in: ${redact(url)}`);
  }
  if (
    !redact('a?access-key=one&b=2 and &access-key=two end').includes('one') &&
    !redact('a?access-key=one&b=2 and &access-key=two end').includes('two')
  ) {
    pass('redact() removes every occurrence');
  } else {
    fail('redact() missed an occurrence');
  }
  if (redact(null) === '' && redact(undefined) === '') {
    pass('redact() tolerates empty input');
  } else {
    fail('redact() mishandled empty input');
  }

  // ------------------------------------------------------------- url building

  const full = buildSaraminUrl(
    {
      saramin_keywords: 'CRM 마케터',
      saramin_loc_mcd: '101,102',
      saramin_job_type: '1',
      saramin_edu_lv: '6',
      saramin_sort: 'pd',
      saramin_exclude_directhire: true,
    },
    KEY,
    2,
    50,
  );
  const parsed = new URL(full);
  const q = parsed.searchParams;
  if (parsed.origin === 'https://oapi.saramin.co.kr' && parsed.pathname === '/job-search') {
    pass('the request goes to the documented endpoint over HTTPS');
  } else {
    fail(`request went to ${parsed.origin}${parsed.pathname}`);
  }
  if (q.get('start') === '2' && q.get('count') === '50') {
    pass('start and count are 0-based page and page size');
  } else {
    fail(`start/count were ${q.get('start')}/${q.get('count')}`);
  }
  if (q.get('fields') === 'posting-date,expiration-date') {
    pass('both dates are requested by default (the API omits them otherwise)');
  } else {
    fail(`fields was ${q.get('fields')}`);
  }
  if (
    q.get('keywords') === 'CRM 마케터' &&
    q.get('loc_mcd') === '101,102' &&
    q.get('job_type') === '1' &&
    q.get('edu_lv') === '6' &&
    q.get('sort') === 'pd'
  ) {
    pass('code-table parameters are forwarded verbatim, not translated');
  } else {
    fail('a passthrough parameter was mangled');
  }
  if (q.get('sr') === 'directhire') {
    pass('exclude-directhire maps to the documented sr parameter');
  } else {
    fail('exclude-directhire did not set sr');
  }
  // Dropping postings must be opt-in, never a default.
  if (new URL(buildSaraminUrl({}, KEY, 0, 10)).searchParams.get('sr') === null) {
    pass('directhire exclusion is off unless asked for');
  } else {
    fail('directhire exclusion was on by default');
  }
  // An unknown key must not be smuggled through.
  if (new URL(buildSaraminUrl({ saramin_bogus: 'x' }, KEY, 0, 10)).searchParams.get('saramin_bogus') === null) {
    pass('an unrecognized saramin_* key is not forwarded');
  } else {
    fail('an unrecognized key reached the API');
  }
  // Empty values must not turn into empty filters.
  if (new URL(buildSaraminUrl({ saramin_keywords: '' }, KEY, 0, 10)).searchParams.get('keywords') === null) {
    pass('an empty filter value is omitted rather than sent blank');
  } else {
    fail('an empty filter was sent');
  }

  // ------------------------------------------------------------ normalization

  const job = normalizeSaraminJob(row());
  if (job?.title === 'CRM 마케터' && job?.company === '아크미') {
    pass('title and company are normalized');
  } else {
    fail(`title/company were ${job?.title} / ${job?.company}`);
  }
  if (job?.location === '서울 > 강남구') {
    pass('HTML entities in the location are decoded');
  } else {
    fail(`location was ${JSON.stringify(job?.location)}`);
  }
  if (job?.url === 'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=1') {
    pass('the canonical URL from the API is used as-is');
  } else {
    fail(`url was ${job?.url}`);
  }
  if (job?.postedAt === Date.parse('2026-08-11T11:44:54+09:00')) {
    pass('posting-date becomes postedAt in epoch ms');
  } else {
    fail(`postedAt was ${job?.postedAt}`);
  }
  if (job?.salary === undefined) {
    pass('no salary is emitted (the search response carries none)');
  } else {
    fail('salary must not be emitted');
  }
  if (job?.description?.includes('금융') && job?.description?.includes('정규직')) {
    pass('list-payload fields fold into description at no extra request');
  } else {
    fail(`description was ${JSON.stringify(job?.description)}`);
  }

  if (normalizeSaraminJob(row({ title: '  ' })) === null) {
    pass('a row with no title is dropped');
  } else {
    fail('a titleless row survived');
  }
  if (normalizeSaraminJob(row({ url: '' })) === null) {
    pass('a row with no url is dropped');
  } else {
    fail('a urlless row survived');
  }
  if (normalizeSaraminJob(null) === null && normalizeSaraminJob('x') === null) {
    pass('junk rows return null rather than throwing');
  } else {
    fail('a junk row was not handled');
  }
  const undated = normalizeSaraminJob(row({ postingDate: 'not-a-date' }));
  if (undated && !('postedAt' in undated)) {
    pass('an unparseable posting-date leaves postedAt absent rather than NaN');
  } else {
    fail(`postedAt became ${undated?.postedAt}`);
  }
  const epochZero = normalizeSaraminJob(row({ postingDate: '1970-01-01T00:00:00Z' }));
  if (epochZero?.postedAt === 0) {
    pass('epoch 0 survives (not swallowed by a falsy check)');
  } else {
    fail(`epoch 0 became ${epochZero?.postedAt}`);
  }

  // -------------------------------------------------------------- page parse

  const okPage = parseSaraminPage(page([row(), row({ url: 'https://www.saramin.co.kr/b' })]));
  if (okPage.jobs.length === 2 && okPage.total === 2 && okPage.returned === 2) {
    pass('a normal page yields jobs, total and returned count');
  } else {
    fail(`page parse returned ${JSON.stringify({ n: okPage.jobs.length, t: okPage.total })}`);
  }

  // An empty board is an answer, not an error.
  if (
    parseSaraminPage({ jobs: { count: 0, start: 0, total: 0 } }).jobs.length === 0 &&
    parseSaraminPage(null).jobs.length === 0 &&
    parseSaraminPage(page([])).jobs.length === 0
  ) {
    pass('an empty board returns [] rather than throwing');
  } else {
    fail('an empty board did not return []');
  }

  // The API answers 200 with an error envelope. Unchecked, a bad key reads as
  // "the biggest board in Korea has nothing open".
  let keyErr = null;
  try {
    parseSaraminPage({ error: { code: 2, message: 'invalid key' } });
  } catch (err) {
    keyErr = err;
  }
  if (keyErr && /error 2/.test(keyErr.message) && /유효하지 않습니다/.test(keyErr.message)) {
    pass('an error envelope throws with the documented meaning, not an empty result');
  } else {
    fail(`error envelope produced ${keyErr?.message}`);
  }
  // And that message must not carry the key.
  let leakErr = null;
  try {
    parseSaraminPage({ error: { code: 3, message: `bad request ?access-key=${KEY}` } });
  } catch (err) {
    leakErr = err;
  }
  if (leakErr && !leakErr.message.includes(KEY)) {
    pass('an error message never carries the access key');
  } else {
    fail('the access key leaked into an error message');
  }

  // A shape that is neither a board nor a documented error must say so.
  let shapeErr = null;
  try {
    parseSaraminPage({ unexpected: true });
  } catch (err) {
    shapeErr = err;
  }
  if (shapeErr && /no "jobs" object/.test(shapeErr.message) && /unexpected/.test(shapeErr.message)) {
    pass('an unknown response shape throws and names the keys it got');
  } else {
    fail(`unknown shape produced ${shapeErr?.message}`);
  }
  let arrErr = null;
  try {
    parseSaraminPage({ jobs: { job: 'not an array' } });
  } catch (err) {
    arrErr = err;
  }
  if (arrErr && /expected an array/.test(arrErr.message)) {
    pass('a non-array job list throws descriptively');
  } else {
    fail(`non-array job list produced ${arrErr?.message}`);
  }

  // --------------------------------------------------------- fetch behaviour

  function makeCtx(handler) {
    const calls = [];
    return {
      calls,
      ctx: {
        transport: 'http',
        async fetchJson(u, opts) {
          calls.push({ url: u, opts });
          return handler(u, opts, calls.length);
        },
        async fetchText() {
          throw new Error('saramin must not call fetchText');
        },
        sleep: async () => {},
      },
    };
  }

  const ENTRY = { provider: 'saramin', saramin_keywords: 'CRM' };
  const ENV = { SARAMIN_ACCESS_KEY: KEY };
  const withEnv = async (fn) => {
    const prev = process.env.SARAMIN_ACCESS_KEY;
    process.env.SARAMIN_ACCESS_KEY = ENV.SARAMIN_ACCESS_KEY;
    try {
      return await fn();
    } finally {
      if (prev === undefined) delete process.env.SARAMIN_ACCESS_KEY;
      else process.env.SARAMIN_ACCESS_KEY = prev;
    }
  };

  {
    // No key is a configuration error, not an empty board.
    const prev = process.env.SARAMIN_ACCESS_KEY;
    delete process.env.SARAMIN_ACCESS_KEY;
    const { ctx, calls } = makeCtx(() => page([row()]));
    let caught = null;
    try {
      await saramin.fetch(ENTRY, ctx);
    } catch (err) {
      caught = err;
    }
    if (prev !== undefined) process.env.SARAMIN_ACCESS_KEY = prev;
    if (caught && /SARAMIN_ACCESS_KEY/.test(caught.message) && calls.length === 0) {
      pass('a missing key throws before any request and names the variable');
    } else {
      fail(`missing key produced ${caught?.message} after ${calls.length} requests`);
    }
  }

  await withEnv(async () => {
    const { ctx, calls } = makeCtx(() => page([row()], 1));
    const out = await saramin.fetch(ENTRY, ctx);
    if (out.length === 1) pass('fetch() returns the normalized jobs');
    else fail(`fetch() returned ${out.length}`);
    if (calls.every((c) => c.opts?.redirect === 'error')) {
      pass('every request sets redirect: "error"');
    } else {
      fail('a request did not set redirect: "error"');
    }
    if (calls.every((c) => c.url.startsWith('https://oapi.saramin.co.kr/job-search?'))) {
      pass('every request goes to the API host over HTTPS');
    } else {
      fail('a request went somewhere unexpected');
    }
  });

  await withEnv(async () => {
    // A full page means keep going; a short one means stop.
    const full = Array.from({ length: 110 }, (_, i) =>
      row({ url: `https://www.saramin.co.kr/j/${i}` }),
    );
    const { ctx, calls } = makeCtx((u, o, n) =>
      n === 1 ? page(full, 200) : page([row({ url: 'https://www.saramin.co.kr/last' })], 200),
    );
    const out = await saramin.fetch(ENTRY, ctx);
    if (calls.length === 2 && out.length === 111) {
      pass('pagination continues on a full page and stops on a short one');
    } else {
      fail(`pagination made ${calls.length} requests for ${out.length} jobs`);
    }
    const starts = calls.map((c) => new URL(c.url).searchParams.get('start'));
    if (starts.join(',') === '0,1') {
      pass('start advances locally as a 0-based page index');
    } else {
      fail(`start sequence was ${starts.join(',')}`);
    }
  });

  await withEnv(async () => {
    // total is a stop condition, never a page count to request.
    const full = Array.from({ length: 110 }, (_, i) =>
      row({ url: `https://www.saramin.co.kr/t/${i}` }),
    );
    const { ctx, calls } = makeCtx(() => page(full, 110));
    await saramin.fetch(ENTRY, ctx);
    if (calls.length === 1) {
      pass('the walk stops once total is covered');
    } else {
      fail(`total-based stop made ${calls.length} requests`);
    }
  });

  await withEnv(async () => {
    // A probe passes maxPages: 1.
    const full = Array.from({ length: 110 }, (_, i) =>
      row({ url: `https://www.saramin.co.kr/p/${i}` }),
    );
    const { ctx, calls } = makeCtx(() => page(full, 5000));
    ctx.maxPages = 1;
    await saramin.fetch(ENTRY, ctx);
    if (calls.length === 1) pass('ctx.maxPages = 1 stops after one page (probe budget)');
    else fail(`probe made ${calls.length} requests`);
  });

  await withEnv(async () => {
    const full = Array.from({ length: 110 }, (_, i) =>
      row({ url: `https://www.saramin.co.kr/m/${i}` }),
    );
    const { ctx, calls } = makeCtx(() => page(full, 5000));
    await saramin.fetch({ ...ENTRY, max_pages: 3 }, ctx);
    if (calls.length === 3) pass('max_pages caps the walk');
    else fail(`max_pages: 3 made ${calls.length} requests`);
  });

  await withEnv(async () => {
    // count is clamped to the documented ceiling.
    const { ctx, calls } = makeCtx(() => page([row()]));
    await saramin.fetch({ ...ENTRY, saramin_count: 500 }, ctx);
    if (new URL(calls[0].url).searchParams.get('count') === '110') {
      pass('count is clamped to the documented maximum of 110');
    } else {
      fail(`count was ${new URL(calls[0].url).searchParams.get('count')}`);
    }
  });

  await withEnv(async () => {
    // A ctx rejection must reach the caller unwrapped.
    const marker = new Error('ProbePageBudgetReached');
    const { ctx } = makeCtx(() => {
      throw marker;
    });
    let caught = null;
    try {
      await saramin.fetch(ENTRY, ctx);
    } catch (err) {
      caught = err;
    }
    if (caught === marker) pass('a ctx rejection propagates unwrapped');
    else fail(`rejection was wrapped: ${caught?.message}`);
  });

  await withEnv(async () => {
    // The same posting on two pages must not be counted twice.
    const { ctx } = makeCtx(() => page(Array.from({ length: 110 }, () => row()), 220));
    const out = await saramin.fetch({ ...ENTRY, max_pages: 2 }, ctx);
    if (out.length === 1) pass('duplicate postings collapse by url');
    else fail(`dedup left ${out.length} jobs`);
  });
} catch (err) {
  fail(`saramin provider tests threw: ${err?.stack || err}`);
}
