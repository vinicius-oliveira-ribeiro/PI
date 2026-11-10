import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSensorData, runOnce } from '../bridge/collector.mjs';

test('normaliza a resposta atual do ESP32 e rejeita medidas impossíveis', () => {
  const reading = normalizeSensorData({
    temperature: '23.5', humidity: 78, pressure: 1006.3, altitude: '755',
  }, 'esp32-001', new Date('2025-10-18T12:00:00Z'));
  assert.equal(reading.temperature_c, 23.5);
  assert.equal(reading.altitude_m, 755);
  assert.equal(reading.observed_at, '2025-10-18T12:00:00.000Z');
  assert.match(reading.event_id, /^[0-9a-f-]{36}$/);
  assert.throws(() => normalizeSensorData({
    temperature: 23, humidity: 140, pressure: 1000,
  }, 'esp32-001'), /umidade/);
});

test('guarda leituras sem internet e reenvia o mesmo evento após reconexão', async () => {
  const testRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'bridge', '.data');
  await mkdir(testRoot, { recursive: true });
  const dir = await mkdtemp(join(testRoot, 'test-'));
  const originalFetch = global.fetch;
  const sent = [];
  let online = false;
  global.fetch = async (url, options) => {
    if (String(url).endsWith('/sensor')) {
      return Response.json({ temperature: 22, humidity: 70, pressure: 1012 });
    }
    sent.push(JSON.parse(options.body));
    return online ? Response.json({ ok: true }) : new Response('offline', { status: 503 });
  };
  const config = {
    supabaseUrl: 'https://example.supabase.co',
    deviceToken: 'test-token', stationCode: 'esp32-001',
    sensorUrl: 'http://127.0.0.1/sensor', queueFile: join(dir, 'pending.json'),
  };
  const log = { log() {}, error() {} };
  try {
    const first = await runOnce(config, { log });
    assert.equal(first.pending, 1);
    const queued = JSON.parse(await readFile(config.queueFile, 'utf8'));
    assert.equal(queued.length, 1);
    online = true;
    const second = await runOnce(config, { log });
    assert.equal(second.pending, 0);
    assert.equal(second.delivered, 2);
    assert.equal(sent[0].event_id, sent[1].event_id);
    assert.notEqual(sent[1].event_id, sent[2].event_id);
  } finally {
    global.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});
