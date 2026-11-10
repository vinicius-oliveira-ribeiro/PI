import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoData, loadArchive, parseCsvLine, parseMonthlyFile } from '../tools/import-precipitation.mjs';

test('lê CSV com nomes entre aspas e respeita datas de ano bissexto', () => {
  const csv = [
    'Local,1.0,2.0,29.0,TOTAL',
    '"CV - Casa, Verde",0.30000000000000004,,12.5,12.8',
    'PRECIPITAÇÃO MÉDIA - ZN,0.3,,12.5,12.8',
  ].join('\n');
  const parsed = parseMonthlyFile(csv, '2024-02-PLUVIOMETRIA-CGESP.csv');
  assert.equal(parsed.observations.length, 2);
  assert.deepEqual(parsed.observations.map(row => row.observed_on), ['2024-02-01', '2024-02-29']);
  assert.deepEqual(parsed.observations.map(row => row.precipitation_mm), [0.3, 12.5]);
  assert.equal(parsed.observations[0].station_name, 'Casa, Verde');
  assert.equal(parsed.observations[0].zone, 'Norte');
  assert.equal(parsed.missingDayColumns, 26);
});

test('ignora colunas fora do mês e valores inválidos sem inventar chuva', () => {
  const csv = [
    ',1.0,28.0,29.0,30.0,31.0,TOTAL',
    'EM - Ermelino Matarazzo,0.0,-3,2,5,8,12',
    'PRECIPITAÇÃO MÉDIA - ZL,0,0,0,0,0,0',
  ].join('\n');
  const parsed = parseMonthlyFile(csv, '2023-02-PLUVIOMETRIA-CGESP.csv');
  assert.deepEqual(parsed.observations.map(row => row.observed_on), ['2023-02-01']);
  assert.equal(parsed.invalidValues, 4);
});

test('agrega médias diárias a partir das estações disponíveis', () => {
  const archive = {
    filenames: ['2024-01-PLUVIOMETRIA-CGESP.csv'],
    missingDayColumns: 0,
    observations: [
      { observed_on: '2024-01-01', zone: 'Norte', precipitation_mm: 10 },
      { observed_on: '2024-01-01', zone: 'Norte', precipitation_mm: 20 },
      { observed_on: '2024-01-01', zone: 'Sul', precipitation_mm: 6 },
    ],
  };
  const demo = createDemoData(archive);
  assert.deepEqual(demo.precipitation, [
    { date: '2024-01-01', zone: 'Norte', rain_mm: 15, station_count: 2 },
    { date: '2024-01-01', zone: 'Sul', rain_mm: 6, station_count: 1 },
  ]);
});

test('parseCsvLine conserva vírgulas e aspas escapadas', () => {
  assert.deepEqual(parseCsvLine('"Estação ""A"", Norte",1.0'), ['Estação "A", Norte', '1.0']);
});

test('arquivo completo conserva 190 boletins e um registro por estação/dia', async () => {
  const archive = await loadArchive();
  assert.ok(archive.filenames.length >= 190);
  assert.ok(archive.observations.length >= 189377);
  assert.ok(archive.missingDayColumns <= 1);
  const zones = new Set(archive.observations.map(row => row.zone));
  assert.deepEqual([...zones].sort(), ['Centro', 'Leste', 'Norte', 'Oeste', 'Sul']);
  assert.ok(archive.observations.some(row => row.observed_on === '2010-01-01'));
  assert.ok(archive.observations.some(row => row.observed_on === '2025-10-31'));
});
