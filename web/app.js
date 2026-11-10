(() => {
  'use strict';

  const ZONES = ['Norte', 'Sul', 'Leste', 'Oeste', 'Centro'];
  const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const VARIABLE_META = {
    temperature_c: { name: 'Temperatura', unit: '°C', digits: 1 },
    humidity_pct: { name: 'Umidade', unit: '%', digits: 0 },
    pressure_hpa: { name: 'Pressão', unit: 'hPa', digits: 0 }
  };
  const config = window.APP_CONFIG || {};
  const configured = Boolean(config.supabaseUrl && config.publishableKey);
  const state = {
    demoRows: null,
    metadata: null,
    monthly: [],
    climate: [],
    zones: {},
    sensor: [],
    latest: null,
    variable: 'temperature_c',
    historyError: null,
    sensorError: null
  };
  const $ = id => document.getElementById(id);
  const number = (value, digits = 0) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
    ? new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number(value))
    : '—';
  const dateString = date => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Sao_Paulo'
    }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const dateLabel = value => {
    if (!value) return '—';
    const date = new Date(value.includes('T') ? value : `${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
  };
  const escapeXml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const empty = message => `<div class="chart-empty">${escapeXml(message)}</div>`;

  function showNotice(message) {
    const el = $('notice');
    el.textContent = message;
    el.hidden = !message;
  }

  function apiUrl(path) {
    return `${String(config.supabaseUrl).replace(/\/+$/, '')}/rest/v1/${path}`;
  }

  function apiHeaders(json = false) {
    const headers = { apikey: config.publishableKey };
    if (json) headers['Content-Type'] = 'application/json';
    // Legacy anon keys are JWTs; newer publishable keys are sent in apikey only.
    if (config.publishableKey.startsWith('eyJ')) headers.Authorization = `Bearer ${config.publishableKey}`;
    return headers;
  }

  async function rpc(name, params) {
    const response = await fetch(apiUrl(`rpc/${name}`), {
      method: 'POST', headers: apiHeaders(true), body: JSON.stringify(params)
    });
    if (!response.ok) {
      const details = await response.text();
      throw new Error(`${name}: HTTP ${response.status}${details ? ` — ${details.slice(0, 160)}` : ''}`);
    }
    return response.json();
  }

  async function latestSensor() {
    const url = apiUrl('sensor_latest?select=station_code,observed_at,temperature_c,humidity_pct,pressure_hpa&order=observed_at.desc&limit=1');
    const response = await fetch(url, { headers: apiHeaders() });
    if (!response.ok) throw new Error(`sensor_latest: HTTP ${response.status}`);
    const rows = await response.json();
    return rows[0] || null;
  }

  async function localSensor() {
    const response = await fetch('/api/sensor', {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error(`Sensor local: HTTP ${response.status}`);
    const raw = await response.json();
    const value = (field, min, max) => {
      const input = raw?.[field];
      const parsed = input === null || input === undefined || input === '' ? NaN : Number(input);
      if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
        throw new Error(`Leitura inválida do sensor: ${field}`);
      }
      return parsed;
    };
    return {
      station_code: 'esp32-local',
      observed_at: new Date().toISOString(),
      temperature_c: value('temperature', -50, 85),
      humidity_pct: value('humidity', 0, 100),
      pressure_hpa: value('pressure', 300, 1100)
    };
  }

  function validFilters() {
    const start = $('start-filter').value;
    const end = $('end-filter').value;
    if (!start || !end || start > end) {
      showNotice('Informe um intervalo válido: a data inicial deve ser anterior ou igual à data final.');
      return null;
    }
    return { start, end, zone: $('zone-filter').value || null };
  }

  async function initDemo() {
    const response = await fetch('./demo-data.json');
    if (!response.ok) throw new Error(`Prévia histórica indisponível: HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.precipitation)) throw new Error('Formato da prévia histórica inválido.');
    state.demoRows = data.precipitation;
    state.metadata = data.metadata || {};
    $('start-filter').value = state.metadata.start_date || '2010-01-01';
    $('end-filter').value = state.metadata.end_date || dateString(new Date());
    $('start-filter').max = state.metadata.end_date || dateString(new Date());
    $('end-filter').max = state.metadata.end_date || dateString(new Date());
    $('mode-badge').textContent = 'HISTÓRICO LOCAL';
    $('footer-updated').textContent = `${number(state.metadata.source_files)} boletins CSV · ${state.metadata.start_date?.slice(0, 4) || '2010'}–${state.metadata.end_date?.slice(0, 4) || '2025'}`;
    $('history-caption').textContent = `Prévia gerada a partir dos ${number(state.metadata.source_files)} boletins CSV do projeto. ${number(state.metadata.observations)} medições de chuva importadas; disponibilidade de estações varia por data e região.`;
    renderCurrent();
    renderSensor();
    await Promise.all([refreshHistory(), refreshSensor()]);
  }

  function aggregateDemo(start, end, zone) {
    // A média diária de todas as zonas é ponderada pelo número de estações disponíveis.
    const daily = new Map();
    const zoneTotals = Object.fromEntries(ZONES.map(item => [item, 0]));
    for (const row of state.demoRows) {
      if (row.date < start || row.date > end) continue;
      const amount = Number(row.rain_mm);
      const count = Number(row.station_count);
      if (!Number.isFinite(amount) || !Number.isFinite(count) || count < 1) continue;
      if (Object.hasOwn(zoneTotals, row.zone)) zoneTotals[row.zone] += amount;
      if (zone && row.zone !== zone) continue;
      const entry = daily.get(row.date) || { weighted: 0, count: 0 };
      entry.weighted += amount * count;
      entry.count += count;
      daily.set(row.date, entry);
    }
    const months = new Map();
    for (const [day, entry] of daily) {
      const key = `${day.slice(0, 7)}-01`;
      const month = months.get(key) || { period_start: key, rain_mm: 0, observation_count: 0 };
      month.rain_mm += entry.weighted / entry.count;
      month.observation_count += entry.count;
      months.set(key, month);
    }
    return { monthly: [...months.values()].sort((a, b) => a.period_start.localeCompare(b.period_start)), zones: zoneTotals };
  }

  async function refreshHistory() {
    const filters = validFilters();
    if (!filters) return;
    showNotice('');
    $('annual-chart').innerHTML = empty('Carregando série histórica…');
    $('monthly-chart').innerHTML = empty('Carregando série histórica…');
    $('zone-chart').innerHTML = empty('Carregando regiões…');
    try {
      if (configured) {
        const args = { p_start_date: filters.start, p_end_date: filters.end, p_zone: filters.zone, p_bucket: 'month' };
        const [monthly, climate, ...zoneSeries] = await Promise.all([
          rpc('dashboard_precipitation_series', args),
          rpc('dashboard_precipitation_series', { p_start_date: '2010-01-01', p_end_date: dateString(new Date()), p_zone: filters.zone, p_bucket: 'month' }),
          ...ZONES.map(zone => rpc('dashboard_precipitation_series', { ...args, p_zone: zone, p_bucket: 'year' }))
        ]);
        state.monthly = monthly;
        state.climate = climate;
        state.zones = Object.fromEntries(ZONES.map((zone, index) => [zone, zoneSeries[index].reduce((sum, row) => sum + Number(row.rain_mm || 0), 0)]));
      } else {
        const result = aggregateDemo(filters.start, filters.end, filters.zone);
        const climate = aggregateDemo(state.metadata.start_date, state.metadata.end_date, filters.zone);
        state.monthly = result.monthly;
        state.climate = climate.monthly;
        state.zones = result.zones;
      }
      state.historyError = null;
      renderHistory();
    } catch (error) {
      console.error('Erro ao consultar pluviometria:', error);
      state.historyError = 'Não foi possível consultar a chuva histórica. Confira a conexão e as permissões do banco.';
      state.monthly = [];
      state.climate = [];
      state.zones = {};
      renderHistory();
      showNotice(state.historyError);
    }
  }

  function sensorWindow() {
    const end = new Date(Date.now() + 1000);
    const start = new Date();
    let bucket = 'hour';
    switch ($('sensor-range').value) {
      case '24h': start.setHours(start.getHours() - 24); break;
      case '7d': start.setDate(start.getDate() - 7); break;
      case '30d': start.setDate(start.getDate() - 30); bucket = 'day'; break;
      case '1y': start.setFullYear(start.getFullYear() - 1); bucket = 'day'; break;
      default: start.setFullYear(2010, 0, 1); bucket = 'month'; break;
    }
    return { p_start_at: start.toISOString(), p_end_at: end.toISOString(), p_bucket: bucket };
  }

  async function refreshSensor() {
    if (!configured) {
      try {
        const reading = await localSensor();
        state.latest = reading;
        state.sensor.push({ ...reading, period_start: reading.observed_at, sample_count: 1 });
        if (state.sensor.length > 5000) state.sensor.shift();
        state.sensorError = null;
        $('mode-badge').textContent = 'HISTÓRICO + SENSOR LOCAL';
        if ($('notice').textContent.startsWith('Sensor local indisponível')) showNotice('');
      } catch (error) {
        console.error('Erro ao consultar sensor local:', error);
        state.sensorError = 'Sensor local indisponível. Confira se a página antiga ainda mostra as leituras.';
        $('mode-badge').textContent = 'SENSOR LOCAL INDISPONÍVEL';
        showNotice(state.sensorError);
      }
      renderCurrent();
      renderSensor();
      return;
    }
    $('sensor-chart').innerHTML = empty('Carregando leituras do BME280…');
    try {
      const [latest, rows] = await Promise.all([latestSensor(), rpc('dashboard_sensor_series', sensorWindow())]);
      state.latest = latest;
      state.sensor = rows;
      state.sensorError = null;
    } catch (error) {
      console.error('Erro ao consultar sensor:', error);
      state.latest = null;
      state.sensor = [];
      state.sensorError = 'Não foi possível consultar as leituras do BME280.';
      showNotice(state.sensorError);
    }
    renderCurrent();
    renderSensor();
  }

  function renderCurrent() {
    const row = state.latest;
    const status = $('sensor-status');
    if (row) {
      $('current-temperature').textContent = number(row.temperature_c, 1);
      $('current-humidity').textContent = number(row.humidity_pct, 0);
      $('current-pressure').textContent = number(row.pressure_hpa, 0);
      const observed = new Date(row.observed_at);
      $('current-time').textContent = Number.isNaN(observed.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(observed);
      $('current-date').textContent = Number.isNaN(observed.getTime()) ? 'Horário desconhecido' : new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(observed);
      const ageMinutes = (Date.now() - observed.getTime()) / 60000;
      const online = !state.sensorError && ageMinutes >= 0 && ageMinutes <= 15;
      status.className = `status-pill ${online ? 'is-online' : 'is-offline'}`;
      status.innerHTML = `<span></span>${online ? 'Estação online' : state.sensorError ? 'Falha ao atualizar' : 'Sem envio recente'}`;
      $('current-footnote').textContent = configured
        ? `Estação ${row.station_code || 'BME280'} · Horário de São Paulo · Leituras armazenadas no Supabase.`
        : 'Leituras locais desta sessão. O histórico do sensor será armazenado após conectar o Supabase.';
    } else {
      for (const id of ['current-temperature', 'current-humidity', 'current-pressure', 'current-time']) $(id).textContent = '—';
      $('current-date').textContent = configured ? 'Nenhuma leitura armazenada' : 'Aguardando leitura do ESP32';
      status.className = `status-pill ${state.sensorError ? 'is-offline' : 'is-waiting'}`;
      status.innerHTML = `<span></span>${state.sensorError ? 'Sensor indisponível' : configured ? 'Sem leituras' : 'Aguardando sensor'}`;
      $('current-footnote').textContent = configured
        ? 'O painel mostrará as condições atuais quando o ESP32 enviar a primeira leitura.'
        : 'A página lê o mesmo sensor local usado pela interface antiga.';
    }
    renderContext();
  }

  function renderContext() {
    const zone = $('zone-filter').value || 'todas as zonas';
    const month = Number(new Intl.DateTimeFormat('en-US', { month: 'numeric', timeZone: 'America/Sao_Paulo' }).format(new Date()));
    const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'America/Sao_Paulo' }).format(new Date());
    const currentMonthStart = `${dateString(new Date()).slice(0, 7)}-01`;
    const years = state.climate.filter(row =>
      Number(String(row.period_start).slice(5, 7)) === month && String(row.period_start) < currentMonthStart);
    const mean = years.length ? years.reduce((sum, row) => sum + Number(row.rain_mm || 0), 0) / years.length : null;
    $('context-month').textContent = `CHUVA HISTÓRICA · ${monthName.toUpperCase()}`;
    $('context-rain').textContent = mean === null ? '—' : `${number(mean)} mm`;
    $('context-years').textContent = years.length ? `${number(years.length)} anos com registros · ${zone}` : `Sem registros de ${monthName} · ${zone}`;
    const lastRow = state.latest;
    const ageMinutes = lastRow ? (Date.now() - new Date(lastRow.observed_at).getTime()) / 60000 : Infinity;
    const row = !state.sensorError && ageMinutes >= 0 && ageMinutes <= 15 ? lastRow : null;
    $('context-sensor').textContent = row ? `${number(row.temperature_c, 1)} °C · ${number(row.humidity_pct, 0)} %` : 'Sem leitura recente';
    $('context-description').textContent = row && mean !== null
      ? `A última leitura registra ${number(row.temperature_c, 1)} °C, ${number(row.humidity_pct, 0)} % de umidade e ${number(row.pressure_hpa, 0)} hPa. Em ${monthName}, a chuva histórica média foi ${number(mean)} mm em ${zone}. É um contexto sazonal; não mede a chuva de hoje nem prevê alagamentos.`
      : row
        ? `A última leitura registra ${number(row.temperature_c, 1)} °C, ${number(row.humidity_pct, 0)} % de umidade e ${number(row.pressure_hpa, 0)} hPa. Não há chuva histórica suficiente para comparar este mês.`
        : `A referência de ${monthName} usa os boletins históricos de ${zone}. As condições atuais serão comparadas aqui quando o BME280 enviar uma leitura recente.`;
  }

  function annualRows(monthly) {
    const years = new Map();
    for (const row of monthly) {
      const year = String(row.period_start).slice(0, 4);
      years.set(year, (years.get(year) || 0) + Number(row.rain_mm || 0));
    }
    return [...years].sort((a, b) => a[0].localeCompare(b[0])).map(([label, value]) => ({ label, value }));
  }

  function monthRows(monthly) {
    const buckets = Array.from({ length: 12 }, (_, index) => ({ label: MONTHS[index], sum: 0, count: 0 }));
    for (const row of monthly) {
      const month = Number(String(row.period_start).slice(5, 7)) - 1;
      if (month < 0 || month > 11) continue;
      buckets[month].sum += Number(row.rain_mm || 0);
      buckets[month].count++;
    }
    return buckets.map(row => ({ label: row.label, value: row.count ? row.sum / row.count : 0 }));
  }

  function axisMax(max) {
    if (!Number.isFinite(max) || max <= 0) return 1;
    const power = Math.pow(10, Math.floor(Math.log10(max / 4)));
    const rough = max / 4 / power;
    const step = (rough <= 1 ? 1 : rough <= 2 ? 2 : rough <= 5 ? 5 : 10) * power;
    return Math.ceil(max / step) * step;
  }

  function barSvg(rows, variant) {
    if (!rows.length || rows.every(row => row.value === 0)) return empty('Não há registros de chuva para o período selecionado.');
    const width = 820, height = 244, left = 55, right = 10, top = 14, bottom = 34;
    const chartW = width - left - right, chartH = height - top - bottom;
    const yMax = axisMax(Math.max(...rows.map(row => row.value)));
    const grid = Array.from({ length: 5 }, (_, index) => {
      const y = top + chartH * index / 4;
      return `<line class="chart-gridline" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"/><text class="chart-axis" x="${left - 8}" y="${y + 3}" text-anchor="end">${number(yMax * (4 - index) / 4)}</text>`;
    }).join('');
    const band = chartW / rows.length;
    const bw = Math.min(variant === 'month' ? 43 : 37, band * .63);
    const bars = rows.map((row, index) => {
      const h = Math.max(0, chartH * row.value / yMax);
      const x = left + band * index + (band - bw) / 2;
      const y = top + chartH - h;
      const label = rows.length > 20 && index % 2 !== 0 ? '' : `<text class="chart-axis" x="${x + bw / 2}" y="${height - 10}" text-anchor="middle">${escapeXml(row.label)}</text>`;
      return `<rect class="${variant === 'month' ? 'chart-month-bar' : 'chart-bar'}" x="${x}" y="${y}" width="${bw}" height="${h}" rx="3"><title>${escapeXml(row.label)}: ${number(row.value, 1)} mm</title></rect>${label}`;
    }).join('');
    return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">${grid}${bars}</svg>`;
  }

  function renderZones() {
    const chart = $('zone-chart');
    const values = ZONES.map(zone => ({ zone, value: Number(state.zones[zone] || 0) }));
    const max = Math.max(...values.map(row => row.value));
    if (max <= 0) { chart.innerHTML = empty('Sem registros regionais neste período.'); return; }
    chart.innerHTML = '';
    for (const row of values) {
      const item = document.createElement('div');
      item.className = 'zone-row';
      item.innerHTML = `<span class="zone-label">${row.zone}</span><div class="zone-track"><div class="zone-fill" style="width:${Math.max(row.value / max * 100, row.value > 0 ? 1 : 0)}%"></div></div><span class="zone-value">${number(row.value)} mm</span>`;
      item.title = `${row.zone}: ${number(row.value, 1)} mm no período`;
      chart.append(item);
    }
  }

  function renderHistory() {
    if (state.historyError) {
      $('annual-chart').innerHTML = empty(state.historyError);
      $('monthly-chart').innerHTML = empty(state.historyError);
      $('zone-chart').innerHTML = empty(state.historyError);
      for (const id of ['summary-rain', 'summary-annual', 'summary-years']) $(id).textContent = '—';
      renderContext();
      return;
    }
    const annual = annualRows(state.monthly);
    const monthly = monthRows(state.monthly);
    const total = annual.reduce((sum, row) => sum + row.value, 0);
    $('summary-rain').textContent = annual.length ? `${number(total)} mm` : '—';
    $('summary-annual').textContent = annual.length ? `${number(total / annual.length)} mm` : '—';
    $('summary-years').textContent = annual.length ? number(annual.length) : '—';
    $('annual-chart').innerHTML = barSvg(annual, 'year');
    $('monthly-chart').innerHTML = barSvg(monthly, 'month');
    renderZones();
    if (configured) {
      const dates = state.monthly.map(row => String(row.period_start));
      $('history-caption').textContent = dates.length
        ? `Boletins históricos da CGE. Registros mensais disponíveis de ${dateLabel(dates[0])} a ${dateLabel(dates[dates.length - 1])}; a quantidade de estações varia conforme a data e a região.`
        : 'Não há registros históricos no período selecionado. A cobertura dos boletins da CGE varia conforme a data e a região.';
    }
    renderContext();
  }

  function lineSvg(rows, variable) {
    const meta = VARIABLE_META[variable];
    const points = rows.map(row => ({ time: new Date(row.period_start).getTime(), value: row[variable] == null ? NaN : Number(row[variable]) }))
      .filter(point => Number.isFinite(point.time) && Number.isFinite(point.value)).sort((a, b) => a.time - b.time);
    if (!points.length) return empty('Ainda não há leituras do BME280 neste período.');
    const width = 820, height = 260, left = 55, right = 10, top = 16, bottom = 34;
    const chartW = width - left - right, chartH = height - top - bottom;
    const values = points.map(point => point.value);
    const rawMin = Math.min(...values), rawMax = Math.max(...values);
    const padding = Math.max((rawMax - rawMin) * .14, meta.unit === 'hPa' ? .8 : .5);
    const yMin = rawMin - padding, yMax = rawMax + padding;
    const tMin = points[0].time, tMax = points[points.length - 1].time;
    const x = point => left + (tMax === tMin ? chartW / 2 : (point.time - tMin) / (tMax - tMin) * chartW);
    const y = point => top + (yMax - point.value) / (yMax - yMin) * chartH;
    const grid = Array.from({ length: 5 }, (_, index) => {
      const py = top + index * chartH / 4;
      return `<line class="chart-gridline" x1="${left}" y1="${py}" x2="${width - right}" y2="${py}"/><text class="chart-axis" x="${left - 8}" y="${py + 3}" text-anchor="end">${number(yMax - (yMax - yMin) * index / 4, meta.digits)}</text>`;
    }).join('');
    const path = points.map((point, index) => `${index ? 'L' : 'M'} ${x(point).toFixed(2)} ${y(point).toFixed(2)}`).join(' ');
    const area = `${path} L ${x(points[points.length - 1]).toFixed(2)} ${top + chartH} L ${x(points[0]).toFixed(2)} ${top + chartH} Z`;
    const labels = [0, .25, .5, .75, 1].map(fraction => {
      const time = tMin + (tMax - tMin) * fraction;
      const date = new Date(time);
      const label = $('sensor-range').value === '24h'
        ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(date)
        : new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone: 'America/Sao_Paulo' }).format(date);
      return `<text class="chart-axis" x="${left + chartW * fraction}" y="${height - 9}" text-anchor="${fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle'}">${escapeXml(label)}</text>`;
    }).join('');
    const stride = Math.max(1, Math.ceil(points.length / 32));
    const dots = points.filter((_, index) => index % stride === 0 || index === points.length - 1).map(point => `<circle class="chart-dot" cx="${x(point).toFixed(2)}" cy="${y(point).toFixed(2)}" r="3"><title>${dateLabel(new Date(point.time).toISOString())}: ${number(point.value, meta.digits)} ${meta.unit}</title></circle>`).join('');
    return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">${grid}<path class="chart-area" d="${area}"/><path class="chart-line" d="${path}"/>${dots}${labels}</svg>`;
  }

  function renderSensor() {
    const meta = VARIABLE_META[state.variable];
    $('sensor-chart-title').textContent = meta.name;
    $('sensor-chart-subtitle').textContent = configured
      ? `Evolução das leituras armazenadas · ${meta.unit}`
      : `Leituras desde que esta página foi aberta · ${meta.unit}`;
    $('sensor-chart').setAttribute('aria-label', `Série de ${meta.name.toLowerCase()} do sensor BME280`);
    const localStart = configured ? null : new Date(sensorWindow().p_start_at).getTime();
    const rows = configured ? state.sensor : state.sensor.filter(row =>
      new Date(row.period_start).getTime() >= localStart);
    $('sensor-chart').innerHTML = state.sensorError && !rows.length
      ? empty(state.sensorError) : lineSvg(rows, state.variable);
    const count = rows.reduce((sum, row) => sum + Number(row.sample_count || 0), 0);
    $('sample-count').textContent = configured
      ? `${number(count)} leituras no período`
      : `${number(count)} leituras nesta sessão · sem armazenamento ainda`;
  }

  function downloadHistory() {
    if (!state.monthly.length) return;
    const csv = ['mes,chuva_mm,observacoes', ...state.monthly.map(row => `${row.period_start},${Number(row.rain_mm).toFixed(2)},${row.observation_count || ''}`)].join('\n');
    const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'pluviometria-mensal.csv';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function initialize() {
    $('filters').addEventListener('submit', event => { event.preventDefault(); refreshHistory(); });
    $('sensor-range').addEventListener('change', () => configured ? refreshSensor() : renderSensor());
    $('refresh-button').addEventListener('click', async () => {
      if (configured) {
        $('mode-badge').textContent = 'ATUALIZANDO';
        await Promise.all([refreshHistory(), refreshSensor()]);
        $('mode-badge').textContent = state.historyError || state.sensorError ? 'FALHA DE CONSULTA' : 'SUPABASE CONECTADO';
      } else await Promise.all([refreshHistory(), refreshSensor()]);
    });
    $('download-button').addEventListener('click', downloadHistory);
    document.querySelectorAll('[data-sensor-variable]').forEach(button => button.addEventListener('click', () => {
      state.variable = button.dataset.sensorVariable;
      document.querySelectorAll('[data-sensor-variable]').forEach(item => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
      });
      renderSensor();
    }));

    if (configured) {
      $('mode-badge').textContent = 'SUPABASE CONFIGURADO';
      $('start-filter').value = '2010-01-01';
      $('end-filter').value = dateString(new Date());
      $('start-filter').max = dateString(new Date());
      $('end-filter').max = dateString(new Date());
      await Promise.all([refreshHistory(), refreshSensor()]);
      $('mode-badge').textContent = state.historyError || state.sensorError ? 'FALHA DE CONSULTA' : 'SUPABASE CONECTADO';
      window.setInterval(async () => {
        try { state.latest = await latestSensor(); renderCurrent(); }
        catch (error) { console.error('Atualização da estação:', error); }
      }, 60_000);
    } else {
      if (window.location.protocol === 'file:') {
        showNotice('Abra esta página pelo servidor local em http://localhost:3000/web/ para carregar o histórico e o sensor.');
        renderCurrent();
        renderSensor();
        return;
      }
      try { await initDemo(); }
      catch (error) {
        console.error(error);
        showNotice('Não foi possível abrir a prévia histórica local.');
        $('mode-badge').textContent = 'SEM DADOS';
        renderCurrent();
        renderSensor();
      }
      window.setInterval(refreshSensor, 10_000);
    }
  }

  document.addEventListener('DOMContentLoaded', initialize);
})();
