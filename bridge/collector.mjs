import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_SENSOR_URL = 'http://192.168.15.39/sensor';
const DEFAULT_DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '.data');

function numberInRange(value, name, min, max, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  const parsed = typeof value === 'number' ? value :
    typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`Leitura inválida para ${name}`);
  }
  return parsed;
}

export function normalizeSensorData(raw, stationCode, now = new Date()) {
  if (!raw || typeof raw !== 'object') throw new Error('Resposta do sensor inválida');
  return {
    event_id: randomUUID(),
    station_code: stationCode,
    observed_at: now.toISOString(),
    temperature_c: numberInRange(raw.temperature, 'temperatura', -40, 85),
    humidity_pct: numberInRange(raw.humidity, 'umidade', 0, 100),
    pressure_hpa: numberInRange(raw.pressure, 'pressão', 300, 1100),
    altitude_m: numberInRange(raw.altitude, 'altitude', -500, 10000, true),
  };
}

export function collectorConfig(env = process.env) {
  const supabaseUrl = env.SUPABASE_URL?.trim().replace(/\/$/, '');
  const deviceToken = env.DEVICE_TOKEN?.trim();
  const stationCode = env.STATION_CODE?.trim() || 'esp32-001';
  const sensorUrl = env.SENSOR_URL?.trim() || DEFAULT_SENSOR_URL;
  const intervalMs = Number(env.SENSOR_POLL_MS || 60000);
  if (!supabaseUrl || !/^https:\/\//.test(supabaseUrl)) {
    throw new Error('SUPABASE_URL deve ser uma URL HTTPS');
  }
  if (!deviceToken || deviceToken.length < 32 || deviceToken.length > 256) {
    throw new Error('DEVICE_TOKEN deve ter entre 32 e 256 caracteres');
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(stationCode)) {
    throw new Error('STATION_CODE inválido');
  }
  if (!/^https?:\/\//.test(sensorUrl)) throw new Error('SENSOR_URL inválida');
  if (!Number.isInteger(intervalMs) || intervalMs < 5000) {
    throw new Error('SENSOR_POLL_MS deve ser pelo menos 5000');
  }
  return {
    supabaseUrl,
    deviceToken,
    stationCode,
    sensorUrl,
    intervalMs,
    queueFile: join(env.COLLECTOR_DATA_DIR || DEFAULT_DATA_DIR, 'pending.json'),
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} em ${new URL(url).pathname}`);
  return response.json();
}

async function loadQueue(file) {
  try {
    const records = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(records)) throw new Error('Fila local inválida');
    return records;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function saveQueue(file, records) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(records), { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, file);
}

async function sendReading(config, reading) {
  const response = await fetch(`${config.supabaseUrl}/functions/v1/ingest-sensor`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-device-token': config.deviceToken,
    },
    body: JSON.stringify(reading),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Envio ao Supabase falhou (HTTP ${response.status})`);
}

export async function runOnce(config, { dryRun = false, log = console } = {}) {
  const queue = dryRun ? [] : await loadQueue(config.queueFile);
  let delivered = 0;
  // A fila local preserva as leituras quando a internet fica indisponível.
  async function flush() {
    while (queue.length) {
      try {
        await sendReading(config, queue[0]);
      } catch (error) {
        log.error(`${error.message}; ${queue.length} leitura(s) pendente(s)`);
        return false;
      }
      queue.shift();
      delivered++;
      await saveQueue(config.queueFile, queue);
    }
    return true;
  }

  if (!dryRun && queue.length) await flush();
  const raw = await fetchJson(config.sensorUrl);
  const reading = normalizeSensorData(raw, config.stationCode);
  if (dryRun) {
    log.log(JSON.stringify(reading, null, 2));
    return { collected: 1, delivered: 0, pending: 0 };
  }
  queue.push(reading);
  await saveQueue(config.queueFile, queue);
  await flush();
  log.log(`Leitura ${reading.observed_at}: ${reading.temperature_c} °C, ${reading.humidity_pct}% UR, ${reading.pressure_hpa} hPa. Enviadas: ${delivered}. Pendentes: ${queue.length}.`);
  return { collected: 1, delivered, pending: queue.length };
}

async function main() {
  const config = collectorConfig();
  const once = process.argv.includes('--once');
  const dryRun = process.argv.includes('--dry-run');
  async function cycle() {
    try {
      const result = await runOnce(config, { dryRun });
      if (once && result.pending) process.exitCode = 1;
    } catch (error) {
      console.error(error.message);
      if (once) process.exitCode = 1;
    }
    if (!once) setTimeout(cycle, config.intervalMs);
  }
  await cycle();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
