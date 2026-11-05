(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const demoMode = new URLSearchParams(location.search).get('demo') === '1';
  const todayKst = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const moveDate = (date, days) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const clockFormat = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const shortClock = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  });

  const dom = {
    date: $('date'), search: $('search'), terminal: $('terminal'),
    rows: $('flight-rows'), table: document.querySelector('.table-scroll'),
    empty: $('empty-state'), title: $('empty-title'), description: $('empty-description'),
    banner: $('demo-banner'), refresh: $('refresh'), updated: $('updated-label'),
    pulse: document.querySelector('.pulse'), statusText: $('board-status-text'),
    boardTitle: $('board-title'), count: $('result-count'), pageNote: $('page-note'),
    more: $('more-container'), moreCount: $('more-count'), demoButton: $('demo-button'),
    dialog: $('flight-dialog'),
  };

  const state = {
    kind: 'departures', status: 'all', flights: [], total: 0, partial: false,
    loading: false, demo: demoMode, updatedAt: null, shown: 80,
    controller: null, requestId: 0,
  };

  function category(remark) {
    const value = String(remark || '').toLowerCase();
    if (/결항|취소|cancel/.test(value)) return 'cancelled';
    if (/지연|delay/.test(value)) return 'delayed';
    if (/탑승|boarding|gate open/.test(value)) return 'boarding';
    if (/정상|예정|on.?time|scheduled/.test(value)) return 'normal';
    if (/출발|도착|착륙|이륙|departed|arrived|landed/.test(value)) return 'complete';
    return 'unknown';
  }

  function terminalText(raw) {
    const value = String(raw || '').trim();
    if (/^(t1|1|제1터미널|terminal 1)$/i.test(value)) return '제1터미널';
    if (/^(t2|2|제2터미널|terminal 2)$/i.test(value)) return '제2터미널';
    return value || '미정';
  }

  function terminalCode(raw) {
    const value = String(raw || '').trim();
    if (/^(t1|1|제1터미널|terminal 1)$/i.test(value)) return 'T1';
    if (/^(t2|2|제2터미널|terminal 2)$/i.test(value)) return 'T2';
    return '';
  }

  function el(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = value;
    return element;
  }

  function cell(label, children) {
    const td = el('td');
    td.dataset.label = label;
    for (const child of children) td.append(child);
    return td;
  }

  function label(value, fallback = '—') {
    return value && String(value).trim() ? String(value).trim() : fallback;
  }

  function displayStatus(flight) {
    const kind = category(flight.remark);
    const text = label(flight.remark, '상태 미정');
    return el('span', `status-pill ${kind}`, text);
  }

  function createFlightRow(flight) {
    const tr = el('tr');
    tr.tabIndex = 0;
    tr.setAttribute('aria-label', `${label(flight.flightId)} ${label(flight.city)} 상세정보 보기`);

    tr.append(cell('예정 시각', [el('span', 'time-primary', label(flight.scheduled))]));
    const changed = flight.estimated && flight.estimated !== flight.scheduled;
    tr.append(cell('변경 시각', [el('span', `time-secondary${changed ? ' time-changed' : ''}`, label(flight.estimated))]));
    const code = el('span', 'flight-code', label(flight.flightId));
    const isShare = flight.codeshare && !/^(n|no|0)$/i.test(flight.codeshare);
    const share = isShare ? el('span', 'sub-label', flight.masterFlight ? `공동운항 ${flight.masterFlight}` : '공동운항편') : null;
    tr.append(cell('항공편', share ? [code, share] : [code]));
    tr.append(cell('항공사', [el('span', 'airline-text', label(flight.airline))]));
    const city = el('span', 'city-text', label(flight.city));
    if (flight.airportCode) city.append(el('span', 'city-code', flight.airportCode));
    tr.append(cell(state.kind === 'departures' ? '목적지' : '출발지', [city]));
    tr.append(cell('터미널 / 게이트', [
      el('span', 'terminal', terminalText(flight.terminal)),
      el('span', 'gate', `GATE ${label(flight.gate)}`),
    ]));
    tr.append(cell('운항 상태', [displayStatus(flight)]));
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrow.setAttribute('viewBox', '0 0 24 24');
    arrow.setAttribute('fill', 'none');
    arrow.setAttribute('class', 'row-arrow');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'm9 5 7 7-7 7');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.8');
    path.setAttribute('stroke-linecap', 'round');
    arrow.append(path);
    tr.append(cell('상세보기', [arrow]));

    tr.addEventListener('click', () => openDetails(flight));
    tr.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openDetails(flight);
      }
    });
    return tr;
  }

  function openDetails(flight) {
    $('detail-title').textContent = label(flight.flightId);
    $('detail-route').textContent = state.kind === 'departures'
      ? `인천 ICN  →  ${label(flight.city)} ${label(flight.airportCode, '')}`
      : `${label(flight.city)} ${label(flight.airportCode, '')}  →  인천 ICN`;
    $('detail-status').replaceChildren(displayStatus(flight));

    const fields = [
      ['항공사', flight.airline], ['운항 구분', state.kind === 'departures' ? '출발' : '도착'],
      ['예정 시각 (KST)', flight.scheduled], ['변경 시각 (KST)', flight.estimated],
      ['터미널', terminalText(flight.terminal)], ['게이트', flight.gate],
    ];
    if (state.kind === 'departures') fields.push(['체크인 카운터', flight.checkin]);
    else fields.push(['도착 출구', flight.exit], ['수하물 수취대', flight.baggage]);
    fields.push(
      ['주기장', flight.stand],
      ['공동운항편', flight.masterFlight],
      ['항공기 기종', flight.aircraft],
      ['등록 기호', flight.registration],
    );
    const dl = $('detail-list');
    dl.replaceChildren();
    for (const [key, value] of fields) {
      const wrap = el('div');
      wrap.append(el('dt', '', key), el('dd', '', label(value)));
      dl.append(wrap);
    }
    dom.dialog.showModal();
  }

  function filteredFlights() {
    const query = dom.search.value.trim().toLocaleLowerCase();
    const terminal = dom.terminal.value;
    return state.flights.filter((flight) => {
      if (state.status !== 'all' && category(flight.remark) !== state.status) return false;
      if (terminal !== 'all' && terminalCode(flight.terminal) !== terminal) return false;
      if (!query) return true;
      return [flight.flightId, flight.airline, flight.city, flight.airportCode, flight.masterFlight]
        .some((value) => String(value || '').toLocaleLowerCase().includes(query));
    });
  }

  function setStats() {
    $('stat-total').textContent = state.flights.length.toLocaleString('ko-KR');
    const counts = { normal: 0, delayed: 0, complete: 0 };
    for (const flight of state.flights) {
      const kind = category(flight.remark);
      if (kind in counts) counts[kind]++;
    }
    $('stat-normal').textContent = counts.normal.toLocaleString('ko-KR');
    $('stat-delayed').textContent = counts.delayed.toLocaleString('ko-KR');
    $('stat-complete').textContent = counts.complete.toLocaleString('ko-KR');
  }

  function render() {
    const filtered = filteredFlights();
    const shown = filtered.slice(0, state.shown);
    const nodes = shown.map(createFlightRow);
    dom.rows.replaceChildren(...nodes);

    const filtersOn = !!dom.search.value.trim() || dom.terminal.value !== 'all' || state.status !== 'all';
    dom.table.hidden = !filtered.length;
    dom.empty.hidden = !!filtered.length;
    dom.more.hidden = filtered.length <= state.shown;
    dom.moreCount.textContent = `(${Math.min(state.shown, filtered.length)} / ${filtered.length})`;
    dom.count.textContent = filtersOn
      ? `${filtered.length.toLocaleString('ko-KR')}편 검색됨`
      : `${state.flights.length.toLocaleString('ko-KR')}편 조회`;
    dom.statusText.textContent = `${state.kind === 'departures' ? '출발' : '도착'} 항공편 ${filtered.length.toLocaleString('ko-KR')}편 표시${filtersOn ? ' · 필터 적용' : ''}`;
    dom.pageNote.textContent = state.partial
      ? `전체 ${state.total.toLocaleString('ko-KR')}편 중 ${state.flights.length.toLocaleString('ko-KR')}편만 API에서 수신되었습니다. 일부 항공편이 검색되지 않을 수 있습니다.`
      : `조회 날짜: ${dom.date.value} · ${state.demo ? '예시 데이터' : '공공데이터포털 제공 정보'}`;

    if (!filtered.length) {
      dom.title.textContent = filtersOn ? '검색 조건에 맞는 항공편이 없습니다.' : '조회된 항공편이 없습니다.';
      dom.description.textContent = filtersOn ? '검색어 또는 필터를 조정해 주세요.' : '다른 날짜를 선택해 보세요. 승인되지 않은 미래 운항정보는 조회되지 않을 수 있습니다.';
      dom.demoButton.hidden = true;
    }
  }

  function showLoading() {
    state.loading = true;
    dom.refresh.disabled = true;
    dom.updated.textContent = '항공편 불러오는 중';
    dom.pulse.className = 'pulse';
    dom.table.hidden = false;
    dom.empty.hidden = true;
    dom.more.hidden = true;
    dom.rows.replaceChildren(...Array.from({ length: 6 }, () => {
      const tr = el('tr');
      tr.className = 'skeleton-row';
      for (let i = 0; i < 8; i++) {
        const td = el('td');
        td.append(el('div', `loading-line${i % 3 === 0 ? ' short' : ''}`));
        tr.append(td);
      }
      return tr;
    }));
    dom.count.textContent = '조회 중';
    dom.statusText.textContent = '공공데이터에서 운항정보를 불러오고 있습니다.';
  }

  function showError(message, missingKey = false) {
    state.flights = [];
    state.total = 0;
    state.partial = false;
    for (const id of ['stat-total', 'stat-normal', 'stat-delayed', 'stat-complete']) $(id).textContent = '—';
    dom.rows.replaceChildren();
    dom.table.hidden = true;
    dom.empty.hidden = false;
    dom.more.hidden = true;
    dom.title.textContent = missingKey ? '실시간 데이터 연결이 필요합니다.' : '항공편 정보를 불러오지 못했습니다.';
    dom.description.textContent = message;
    dom.demoButton.hidden = false;
    dom.count.textContent = '데이터 없음';
    dom.statusText.textContent = '운항정보 연결 상태를 확인해 주세요.';
    dom.updated.textContent = '연결 확인 필요';
    dom.pulse.className = 'pulse';
  }

  function sampleFlights(kind) {
    // Explicitly fictitious examples. Never label these as live flights.
    const departures = [
      ['KE703','대한항공','도쿄(나리타)','NRT','06:45','06:45','T2','251','출발','B02'],
      ['OZ361','아시아나항공','상하이(푸둥)','PVG','07:10','07:10','T2','264','출발','C16'],
      ['TW201','티웨이항공','오사카(간사이)','KIX','07:35','08:10','T1','113','지연','F19'],
      ['7C1101','제주항공','도쿄(나리타)','NRT','08:05','08:05','T1','132','출발','L03'],
      ['KE901','대한항공','파리(샤를드골)','CDG','08:40','08:40','T2','253','탑승중','D04'],
      ['SQ607','싱가포르항공','싱가포르','SIN','09:00','09:00','T1','125','탑승중','E21'],
      ['BX811','에어부산','후쿠오카','FUK','09:25','09:25','T1','108','정상','G15'],
      ['KE017','대한항공','로스앤젤레스','LAX','09:50','10:20','T2','259','지연','C11'],
      ['JL092','일본항공','도쿄(하네다)','HND','10:15','10:15','T1','117','정상','J08'],
      ['OZ721','아시아나항공','홍콩','HKG','10:40','10:40','T2','270','정상','A14'],
      ['CX411','캐세이퍼시픽','홍콩','HKG','11:05','11:05','T1','121','정상','M08'],
      ['KE081','대한항공','뉴욕(JFK)','JFK','11:40','11:40','T2','260','정상','B03'],
      ['VJ861','비엣젯항공','호찌민','SGN','12:20','12:20','T1','110','정상','H02'],
      ['LJ225','진에어','삿포로(신치토세)','CTS','13:05','','T2','241','예정','F07'],
      ['TR841','스쿠트항공','싱가포르','SIN','14:30','','T1','118','예정','E09'],
      ['KE658','대한항공','방콕(수완나품)','BKK','15:10','','T2','','예정','B12'],
      ['TW615','티웨이항공','세부','CEB','16:45','','T1','','결항','F21'],
      ['OZ211','아시아나항공','샌프란시스코','SFO','18:20','','T2','','예정','A10'],
    ];
    const arrivals = [
      ['KE704','대한항공','도쿄(나리타)','NRT','06:50','06:50','T2','254','도착','05'],
      ['OZ362','아시아나항공','상하이(푸둥)','PVG','07:20','07:20','T2','263','도착','03'],
      ['7C1102','제주항공','도쿄(나리타)','NRT','07:55','08:20','T1','121','지연','C'],
      ['KE902','대한항공','파리(샤를드골)','CDG','08:35','08:35','T2','255','도착','08'],
      ['SQ608','싱가포르항공','싱가포르','SIN','09:05','09:05','T1','113','도착','B'],
      ['KE018','대한항공','로스앤젤레스','LAX','09:30','09:30','T2','257','도착','09'],
      ['JL093','일본항공','도쿄(하네다)','HND','10:05','10:05','T1','116','정상','D'],
      ['BX812','에어부산','후쿠오카','FUK','10:35','10:50','T1','105','지연','A'],
      ['OZ722','아시아나항공','홍콩','HKG','11:10','11:10','T2','263','정상','04'],
      ['CX412','캐세이퍼시픽','홍콩','HKG','12:00','12:00','T1','112','정상','C'],
      ['KE082','대한항공','뉴욕(JFK)','JFK','13:15','13:15','T2','259','예정','05'],
      ['VJ862','비엣젯항공','호찌민','SGN','14:05','','T1','','예정','A'],
      ['TW616','티웨이항공','세부','CEB','15:40','','T1','','결항','D'],
      ['TR842','스쿠트항공','싱가포르','SIN','17:00','','T1','','예정','B'],
      ['OZ212','아시아나항공','샌프란시스코','SFO','18:45','','T2','','예정','03'],
    ];
    return (kind === 'departures' ? departures : arrivals).map((row, i) => ({
      id: `sample-${kind}-${i}`, flightId: row[0], airline: row[1], city: row[2],
      airportCode: row[3], scheduled: row[4], estimated: row[5], terminal: row[6],
      gate: row[7], remark: row[8], checkin: kind === 'departures' ? row[9] : '',
      exit: kind === 'arrivals' ? row[9] : '', baggage: kind === 'arrivals' ? String(i % 9 + 1) : '',
      stand: '', codeshare: '', masterFlight: '', aircraft: '', registration: '',
    }));
  }

  async function loadFlights() {
    state.controller?.abort();
    const current = ++state.requestId;
    state.controller = new AbortController();
    state.shown = 80;
    showLoading();

    try {
      let payload;
      if (state.demo) {
        payload = { flights: sampleFlights(state.kind), total: 0, partial: false, fetchedAt: new Date().toISOString() };
      } else {
        const url = `/api/flights?kind=${encodeURIComponent(state.kind)}&date=${encodeURIComponent(dom.date.value)}`;
        const response = await fetch(url, { signal: state.controller.signal });
        payload = await response.json();
        if (!response.ok) {
          const error = new Error(payload.error || '항공편 조회에 실패했습니다.');
          error.missingKey = payload.code === 'NO_API_KEY';
          throw error;
        }
        if (!Array.isArray(payload.flights)) throw new Error('항공편 목록 형식이 올바르지 않습니다.');
      }
      if (current !== state.requestId) return;
      state.flights = payload.flights.sort((a, b) => (a.scheduled || '').localeCompare(b.scheduled || ''));
      state.total = payload.total || payload.flights.length;
      state.partial = Boolean(payload.partial);
      state.updatedAt = payload.fetchedAt ? new Date(payload.fetchedAt) : new Date();
      dom.updated.textContent = state.demo ? '예시 데이터 표시 중' : `마지막 조회 ${shortClock.format(state.updatedAt)} 기준`;
      dom.pulse.className = `pulse ${state.demo ? 'demo' : 'online'}`;
      setStats();
      render();
    } catch (error) {
      if (current !== state.requestId || error.name === 'AbortError') return;
      showError(error.message, Boolean(error.missingKey));
    } finally {
      if (current === state.requestId) {
        state.loading = false;
        dom.refresh.disabled = false;
      }
    }
  }

  function setKind(kind) {
    if (state.kind === kind) return;
    state.kind = kind;
    state.status = 'all';
    document.querySelectorAll('.flight-tab').forEach((button) => {
      const selected = button.dataset.kind === kind;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    document.querySelectorAll('.status-filter').forEach((button) => {
      const selected = button.dataset.status === 'all';
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    dom.boardTitle.replaceChildren(
      document.createTextNode(kind === 'departures' ? '출발 항공편 ' : '도착 항공편 '),
      el('small', '', kind === 'departures' ? 'DEPARTURES' : 'ARRIVALS'),
    );
    $('city-header').textContent = kind === 'departures' ? '목적지' : '출발지';
    $('flight-panel').setAttribute('aria-labelledby', kind === 'departures' ? 'tab-departures' : 'tab-arrivals');
    loadFlights();
  }

  function initialize() {
    const today = todayKst();
    dom.date.value = today;
    dom.date.min = moveDate(today, -3);
    dom.date.max = moveDate(today, 6);
    dom.banner.hidden = !state.demo;
    $('global-clock').textContent = clockFormat.format(new Date());
    setInterval(() => { $('global-clock').textContent = clockFormat.format(new Date()); }, 1000);
    setInterval(() => {
      if (document.visibilityState === 'visible' && !state.loading) loadFlights();
    }, 300000);

    document.querySelectorAll('.flight-tab').forEach((button) => button.addEventListener('click', () => setKind(button.dataset.kind)));
    document.querySelectorAll('.status-filter').forEach((button) => button.addEventListener('click', () => {
      state.status = button.dataset.status;
      state.shown = 80;
      document.querySelectorAll('.status-filter').forEach((candidate) => {
        const selected = candidate === button;
        candidate.classList.toggle('active', selected);
        candidate.setAttribute('aria-pressed', String(selected));
      });
      if (!state.loading) render();
    }));

    let filterTimer;
    dom.search.addEventListener('input', () => {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(() => { state.shown = 80; if (!state.loading) render(); }, 150);
    });
    dom.terminal.addEventListener('change', () => { state.shown = 80; if (!state.loading) render(); });
    dom.date.addEventListener('change', () => { if (dom.date.validity.valid && dom.date.value) loadFlights(); });
    $('filter-form').addEventListener('submit', (event) => event.preventDefault());
    $('reset-filters').addEventListener('click', () => {
      const changedDate = dom.date.value !== todayKst();
      dom.date.value = todayKst();
      dom.search.value = '';
      dom.terminal.value = 'all';
      state.status = 'all';
      document.querySelectorAll('.status-filter').forEach((button) => {
        const selected = button.dataset.status === 'all';
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
      state.shown = 80;
      if (changedDate) loadFlights(); else if (!state.loading) render();
    });
    dom.refresh.addEventListener('click', loadFlights);
    $('load-more').addEventListener('click', () => { state.shown += 80; render(); });
    dom.demoButton.addEventListener('click', () => { location.search = '?demo=1'; });
    $('close-dialog').addEventListener('click', () => dom.dialog.close());
    dom.dialog.addEventListener('click', (event) => {
      if (event.target === dom.dialog) dom.dialog.close();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.updatedAt && Date.now() - state.updatedAt.getTime() >= 300000 && !state.loading) loadFlights();
    });
    loadFlights();
  }

  initialize();
})();
