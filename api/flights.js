const BASE = 'https://apis.data.go.kr/B551177/statusOfAllFltDeOdp';
const ROUTES = {
  departures: 'getFltDeparturesDeOdp',
  arrivals: 'getFltArrivalsDeOdp',
};

function seoulToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function validDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return false;
  const days = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${seoulToday()}T00:00:00Z`)) / 86400000;
  return days >= -3 && days <= 6;
}

function clean(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  return /^(null|undefined|none|-|n\/a)$/i.test(text) ? '' : text;
}

function time(value) {
  const raw = clean(value);
  if (!raw) return '';
  // API dates are commonly YYYYMMDDHHmm or YYYY-MM-DD HH:mm.
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 12) return `${digits.slice(8, 10)}:${digits.slice(10, 12)}`;
  if (/^\d{4}$/.test(raw)) return `${raw.slice(0, 2)}:${raw.slice(2, 4)}`;
  if (/^\d{2}:\d{2}$/.test(raw)) return raw;
  return '';
}

function normalize(item, index, kind) {
  return {
    id: clean(item.fid) || `${kind}-${clean(item.flightId)}-${clean(item.scheduleDatetime)}-${index}`,
    flightId: clean(item.flightId),
    airline: clean(item.airline),
    city: clean(item.airport),
    airportCode: clean(item.airportCode),
    scheduled: time(item.scheduleDatetime),
    estimated: time(item.estimatedDatetime),
    terminal: clean(item.terminalId),
    gate: clean(item.gateNumber),
    remark: clean(item.remark),
    checkin: clean(item.chkinRange),
    exit: clean(item.exitNumber),
    baggage: clean(item.carousel),
    stand: clean(item.fstandPosition),
    codeshare: clean(item.codeshare),
    masterFlight: clean(item.masterFlightId),
    aircraft: clean(item.aircraftSubtype),
    registration: clean(item.aircraftRegNo),
  };
}

function decodeKey(key) {
  // Accept both Decoding and Encoding keys supplied by the portal.
  try { return key.includes('%') ? decodeURIComponent(key) : key; }
  catch { return key; }
}

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET 요청만 지원합니다.' });

  const kind = String(req.query?.kind || 'departures');
  const date = String(req.query?.date || seoulToday());
  if (!Object.hasOwn(ROUTES, kind)) return res.status(400).json({ error: '출발편 또는 도착편을 선택하세요.' });
  if (!validDate(date)) return res.status(400).json({ error: '조회 날짜는 한국시간 기준 오늘부터 -3일에서 +6일 사이여야 합니다.' });

  const key = process.env.AIRPORT_API_KEY?.trim();
  if (!key) return res.status(503).json({ error: 'API 인증키가 설정되지 않았습니다. Vercel 환경변수 AIRPORT_API_KEY를 등록하세요.', code: 'NO_API_KEY' });

  const params = new URLSearchParams({
    serviceKey: decodeKey(key),
    pageNo: '1',
    numOfRows: '1000',
    searchdtCode: 'S',
    searchDate: date.replaceAll('-', ''),
    searchFrom: '0000',
    searchTo: '2400',
    passengerOrCargo: 'P',
    type: 'json',
  });

  try {
    const response = await fetch(`${BASE}/${ROUTES[kind]}?${params}`, {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json' },
    });
    const bodyText = await response.text();
    let payload;
    try { payload = JSON.parse(bodyText); }
    catch {
      const message = bodyText.match(/<resultMsg>([^<]+)<\/resultMsg>/i)?.[1];
      throw new Error(message || '공공데이터 API가 JSON 형식으로 응답하지 않았습니다.');
    }

    const root = payload.response || payload;
    const resultCode = clean(root.header?.resultCode);
    if (resultCode && !['00', '0000', '0'].includes(resultCode)) {
      throw new Error(clean(root.header?.resultMsg) || `API 오류 코드 ${resultCode}`);
    }
    if (!response.ok) throw new Error(`공공데이터 API HTTP ${response.status}`);
    if (!root.body || typeof root.body !== 'object') throw new Error('공공데이터 응답의 항공편 목록을 읽을 수 없습니다.');

    const items = root.body.items?.item ?? (Array.isArray(root.body.items) ? root.body.items : []);
    const list = Array.isArray(items) ? items : items && typeof items === 'object' ? [items] : [];
    const flights = list.map((item, i) => normalize(item, i, kind));
    const total = Number(root.body.totalCount);

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=180');
    return res.status(200).json({
      kind, date, flights,
      total: Number.isFinite(total) ? total : flights.length,
      partial: Number.isFinite(total) && total > flights.length,
      fetchedAt: new Date().toISOString(),
      source: '인천국제공항공사',
    });
  } catch (error) {
    const message = error?.name === 'TimeoutError' ? 'API 응답 시간이 초과되었습니다. 잠시 후 다시 시도하세요.' : error.message;
    return res.status(502).json({ error: message || '항공편 정보를 가져오지 못했습니다.', code: 'UPSTREAM_ERROR' });
  }
}

module.exports = handler;
module.exports._internals = { normalize, time, validDate, decodeKey };
