#!/usr/bin/env node
/**
 * Normaliza os boletins mensais da CGESP e, opcionalmente, importa no Supabase.
 * Sem dependências externas: node tools/import-precipitation.mjs --help
 */
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ZONES = { ZN: 'Norte', ZL: 'Leste', ZC: 'Centro', ZO: 'Oeste', ZS: 'Sul' };
const DEFAULT_INPUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'input');

function withoutAccents(value) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

/** CSV parser for the quoted commas and escaped quotes allowed by CSV. */
export function parseCsvLine(line) {
  const columns = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      columns.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error('Aspas CSV não fechadas');
  columns.push(cell);
  return columns;
}

function parseDay(cell) {
  const match = /^([1-9]|[12]\d|3[01])(?:\.0+)?$/.exec(cell.trim());
  return match ? Number(match[1]) : null;
}

function parseRain(cell) {
  const text = cell.trim();
  if (!text) return null;
  const number = Number(text.replace(',', '.'));
  if (!Number.isFinite(number) || number < 0) return null;
  // O destino é numeric(10,2); remove artefatos como 0.30000000000000004.
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function stationIdentity(label) {
  const clean = label.trim().replace(/\s+/g, ' ');
  const coded = /^(\p{L}{2,3})\s*-\s*(.+)$/u.exec(clean);
  if (coded) {
    return { station_code: withoutAccents(coded[1]).toUpperCase(), station_name: coded[2].trim() };
  }
  const code = withoutAccents(clean).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  return { station_code: code, station_name: clean };
}

export function parseMonthlyFile(csvText, filename) {
  const filenameMatch = /^(\d{4})-(\d{2})-PLUVIOMETRIA-CGESP\.csv$/i.exec(filename);
  if (!filenameMatch) throw new Error(`Nome de arquivo inesperado: ${filename}`);
  const year = Number(filenameMatch[1]);
  const month = Number(filenameMatch[2]);
  if (month < 1 || month > 12) throw new Error(`Mês inválido em ${filename}`);

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const rows = csvText.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean).map(parseCsvLine);
  const headerIndex = rows.findIndex(row => {
    const first = withoutAccents((row[0] ?? '').trim()).toUpperCase();
    return (!first || first === 'LOCAL') && parseDay(row[1] ?? '') === 1;
  });
  if (headerIndex < 0) throw new Error(`Colunas de dias não encontradas em ${filename}`);

  const header = rows[headerIndex];
  const dayColumns = [];
  for (let col = 1; col < header.length; col += 1) {
    const day = parseDay(header[col]);
    if (day !== null) dayColumns.push({ col, day });
  }
  if (!dayColumns.length || dayColumns[0]?.day !== 1) {
    throw new Error(`Colunas de dias não reconhecidas em ${filename}`);
  }
  const presentDays = new Set(dayColumns.map(entry => entry.day));
  const missingDayColumns = Array.from({ length: daysInMonth }, (_, index) => index + 1)
    .filter(day => !presentDays.has(day)).length;

  const observations = [];
  const seen = new Set();
  let pending = [];
  let invalidValues = 0;
  for (const row of rows.slice(headerIndex + 1)) {
    const label = (row[0] ?? '').trim();
    if (!label) continue;
    const normalized = withoutAccents(label).toUpperCase();
    const zoneCode = /PRECIPITACAO\s+MEDIA\s*-\s*(ZN|ZL|ZC|ZO|ZS)\b/.exec(normalized)?.[1];
    if (zoneCode) {
      for (const observation of pending) {
        observation.zone = ZONES[zoneCode];
        const key = `${observation.station_code}:${observation.observed_on}`;
        if (seen.has(key)) throw new Error(`Estação/dia duplicado em ${filename}: ${key}`);
        seen.add(key);
        observations.push(observation);
      }
      pending = [];
      continue;
    }
    if (normalized.startsWith('PRECIPITACAO MEDIA') || normalized.startsWith('TOTAL')) continue;
    if (!dayColumns.some(({ col }) => (row[col] ?? '').trim())) continue;
    const station = stationIdentity(label);
    for (const { col, day } of dayColumns) {
      const raw = (row[col] ?? '').trim();
      if (day > daysInMonth) {
        if (raw) invalidValues += 1;
        continue;
      }
      const precipitation_mm = parseRain(raw);
      if (precipitation_mm === null) {
        if (raw) invalidValues += 1;
        continue;
      }
      pending.push({
        ...station,
        zone: '',
        observed_on: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        precipitation_mm,
        source_file: filename,
      });
    }
  }
  if (pending.length) throw new Error(`Há estações sem indicação de zona em ${filename}`);
  if (!observations.length) throw new Error(`Nenhuma medição encontrada em ${filename}`);
  return { observations, invalidValues, missingDayColumns };
}

export async function loadArchive(inputDirectory = DEFAULT_INPUT) {
  const filenames = (await readdir(inputDirectory))
    .filter(name => /^\d{4}-\d{2}-PLUVIOMETRIA-CGESP\.csv$/i.test(name))
    .sort();
  if (!filenames.length) throw new Error(`Nenhum boletim encontrado em ${inputDirectory}`);
  const observations = [];
  let invalidValues = 0;
  let missingDayColumns = 0;
  for (const filename of filenames) {
    const parsed = parseMonthlyFile(await readFile(join(inputDirectory, filename), 'utf8'), filename);
    observations.push(...parsed.observations);
    invalidValues += parsed.invalidValues;
    missingDayColumns += parsed.missingDayColumns;
  }
  const keys = new Set();
  for (const row of observations) {
    const key = `${row.station_code}:${row.observed_on}`;
    if (keys.has(key)) throw new Error(`Estação/dia duplicado no arquivo histórico: ${key}`);
    keys.add(key);
  }
  return { filenames, observations, invalidValues, missingDayColumns };
}

export function createDemoData(archive) {
  const days = new Map();
  for (const row of archive.observations) {
    const key = `${row.observed_on}:${row.zone}`;
    const current = days.get(key) ?? { date: row.observed_on, zone: row.zone, sum: 0, station_count: 0 };
    current.sum += row.precipitation_mm;
    current.station_count += 1;
    days.set(key, current);
  }
  const precipitation = [...days.values()]
    .sort((a, b) => a.date.localeCompare(b.date) || a.zone.localeCompare(b.zone, 'pt-BR'))
    .map(({ date, zone, sum, station_count }) => ({
      date,
      zone,
      rain_mm: Math.round((sum / station_count + Number.EPSILON) * 100) / 100,
      station_count,
    }));
  const dates = precipitation.map(row => row.date);
  return {
    metadata: {
      start_date: dates[0],
      end_date: dates.at(-1),
      source_files: archive.filenames.length,
      observations: archive.observations.length,
      missing_day_columns: archive.missingDayColumns,
      source: 'Boletins mensais de pluviometria CGESP incluídos em input/',
    },
    precipitation,
  };
}

function sleep(ms) { return new Promise(resolvePromise => setTimeout(resolvePromise, ms)); }

async function uploadBatch(url, key, batch) {
  const apiUrl = `${url.replace(/\/$/, '')}/rest/v1/precipitation_daily?on_conflict=station_code%2Cobserved_on`;
  const headers = {
    apikey: key,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  };
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(batch) });
    if (response.ok) return;
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      await sleep(500 * 2 ** attempt);
      continue;
    }
    // Avoid printing headers or request bodies, which contain credentials and data.
    throw new Error(`Falha no Supabase: HTTP ${response.status}. Confira a migração, a URL e a chave de serviço.`);
  }
}

export async function uploadArchive(archive, { url, key, batchSize = 500 }) {
  if (!url || !key) throw new Error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.');
  let sent = 0;
  for (let offset = 0; offset < archive.observations.length; offset += batchSize) {
    const batch = archive.observations.slice(offset, offset + batchSize);
    await uploadBatch(url, key, batch);
    sent += batch.length;
    if (sent % 10000 < batchSize || sent === archive.observations.length) {
      process.stdout.write(`Importados ${sent}/${archive.observations.length} registros\n`);
    }
  }
}

function parseArguments(argv) {
  const options = { input: DEFAULT_INPUT, demoOut: null, upload: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--input') options.input = resolve(argv[++i] ?? '');
    else if (argv[i] === '--demo-out') options.demoOut = resolve(argv[++i] ?? '');
    else if (argv[i] === '--upload') options.upload = true;
    else if (argv[i] === '--help' || argv[i] === '-h') options.help = true;
    else throw new Error(`Opção desconhecida: ${argv[i]}`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('Uso: node tools/import-precipitation.mjs [--input input/] [--demo-out web/demo-data.json] [--upload]\n');
    process.stdout.write('O padrão apenas confere os CSVs. --upload exige SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.\n');
    return;
  }
  const archive = await loadArchive(options.input);
  const demo = createDemoData(archive);
  process.stdout.write(`${archive.filenames.length} arquivos; ${archive.observations.length} medições; ${demo.metadata.start_date} a ${demo.metadata.end_date}; ${archive.invalidValues} valores inválidos ignorados; ${archive.missingDayColumns} colunas de dia ausentes nos arquivos de origem.\n`);
  if (options.demoOut) {
    await mkdir(dirname(options.demoOut), { recursive: true });
    await writeFile(options.demoOut, `${JSON.stringify(demo)}\n`, 'utf8');
    process.stdout.write(`Prévia gerada: ${options.demoOut}\n`);
  }
  if (options.upload) {
    await uploadArchive(archive, {
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
