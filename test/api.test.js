const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../api/flights');
const { normalize, time, validDate, decodeKey } = api._internals;

function mockResponse() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('normalizes departure and arrival fields according to official schema', () => {
  const source = {
    fid: 'abc', flightId: 'KE703', airline: '대한항공', airport: '나리타', airportCode: 'NRT',
    scheduleDatetime: '202611050900', estimatedDatetime: '202611050935', gateNumber: '251',
    terminalId: 'T2', remark: '지연', chkinRange: 'A01-A05', exitNumber: '3', carousel: '8',
  };
  const dep = normalize(source, 0, 'departures');
  const arr = normalize(source, 0, 'arrivals');
  assert.equal(dep.flightId, 'KE703');
  assert.equal(dep.scheduled, '09:00');
  assert.equal(dep.estimated, '09:35');
  assert.equal(dep.gate, '251');
  assert.equal(dep.checkin, 'A01-A05');
  assert.equal(arr.exit, '3');
  assert.equal(arr.baggage, '8');
  assert.equal(dep.remark, '지연');
});

test('handles absent times and encoded keys', () => {
  assert.equal(time(''), '');
  assert.equal(time('08:20'), '08:20');
  assert.equal(time('2026-11-05 18:42'), '18:42');
  assert.equal(decodeKey('abc%2Fdef%3D'), 'abc/def=');
  assert.equal(normalize({ flightId: 'OZ100', remark: null }, 1, 'arrivals').estimated, '');
});

test('validates date and kind before requesting upstream', async () => {
  const result = mockResponse();
  await api({ method: 'GET', query: { kind: 'unknown' } }, result);
  assert.equal(result.statusCode, 400);
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(validDate('invalid'), false);
  const result2 = mockResponse();
  await api({ method: 'POST', query: {} }, result2);
  assert.equal(result2.statusCode, 405);
});

test('returns a clear error when no key is set', async () => {
  const previous = process.env.AIRPORT_API_KEY;
  delete process.env.AIRPORT_API_KEY;
  const result = mockResponse();
  try {
    await api({ method: 'GET', query: {} }, result);
    assert.equal(result.statusCode, 503);
    assert.equal(result.body.code, 'NO_API_KEY');
  } finally {
    if (previous !== undefined) process.env.AIRPORT_API_KEY = previous;
  }
});

test('fetches official JSON response, normalizes arrays, and keeps credentials server-side', async () => {
  const previous = process.env.AIRPORT_API_KEY;
  const oldFetch = global.fetch;
  process.env.AIRPORT_API_KEY = 'test/secret=';
  let fetchedUrl;
  global.fetch = async (url) => {
    fetchedUrl = new URL(url);
    return {
      ok: true,
      text: async () => JSON.stringify({
        header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
        body: { items: { item: [{ flightId: 'KE100', scheduleDatetime: '202611050905', remark: '정상' }] }, totalCount: '1' },
      }),
    };
  };
  const result = mockResponse();
  try {
    await api({ method: 'GET', query: { kind: 'arrivals' } }, result);
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.flights[0].flightId, 'KE100');
    assert.equal(result.body.total, 1);
    assert.equal(fetchedUrl.pathname, '/B551177/statusOfAllFltDeOdp/getFltArrivalsDeOdp');
    assert.equal(fetchedUrl.searchParams.get('serviceKey'), 'test/secret=');
    assert.equal(fetchedUrl.searchParams.get('type'), 'json');
    assert.equal(fetchedUrl.searchParams.get('searchdtCode'), 'S');
    assert.equal(JSON.stringify(result.body).includes('test/secret='), false);
    assert.match(result.headers['Cache-Control'], /s-maxage=300/);
  } finally {
    global.fetch = oldFetch;
    if (previous === undefined) delete process.env.AIRPORT_API_KEY;
    else process.env.AIRPORT_API_KEY = previous;
  }
});

test('reports upstream API errors without showing an empty flight board', async () => {
  const previous = process.env.AIRPORT_API_KEY;
  const oldFetch = global.fetch;
  process.env.AIRPORT_API_KEY = 'key';
  global.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ header: { resultCode: '30', resultMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR' } }),
  });
  const result = mockResponse();
  try {
    await api({ method: 'GET', query: {} }, result);
    assert.equal(result.statusCode, 502);
    assert.match(result.body.error, /SERVICE_KEY/);
  } finally {
    global.fetch = oldFetch;
    if (previous === undefined) delete process.env.AIRPORT_API_KEY;
    else process.env.AIRPORT_API_KEY = previous;
  }
});

test('empty items object means zero flights, not a blank row', async () => {
  const previous = process.env.AIRPORT_API_KEY;
  const oldFetch = global.fetch;
  process.env.AIRPORT_API_KEY = 'key';
  global.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ header: { resultCode: '00' }, body: { items: {}, totalCount: '0' } }),
  });
  const result = mockResponse();
  try {
    await api({ method: 'GET', query: {} }, result);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body.flights, []);
  } finally {
    global.fetch = oldFetch;
    if (previous === undefined) delete process.env.AIRPORT_API_KEY;
    else process.env.AIRPORT_API_KEY = previous;
  }
});
