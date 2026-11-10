# Banco de dados e recebimento do ESP32

Este diretório contém a migração PostgreSQL e a função `ingest-sensor` do Supabase.
O painel da Vercel usa somente a chave **publishable** (ou `anon`) para leitura;
o token do dispositivo e a chave **secret** ficam fora do navegador.

## Preparação no Supabase

1. Crie um projeto Supabase e aplique `migrations/20261109000100_weather_data.sql`
   no SQL Editor (ou pelo fluxo de migrations da CLI).
2. Publique a função `ingest-sensor` com `supabase functions deploy ingest-sensor`.
   O `config.toml` desliga a validação JWT da plataforma **apenas nessa função**;
   a função exige `x-device-token` e confere seu hash no banco.
3. Gere um segredo aleatório e seu hash SHA-256 no computador com Node.js:

   ```powershell
   node -e "const c=require('node:crypto');const t=c.randomBytes(32).toString('hex');console.log('DEVICE_TOKEN='+t);console.log('TOKEN_HASH='+c.createHash('sha256').update(t).digest('hex'))"
   ```

4. Guarde `DEVICE_TOKEN` somente na configuração local do coletor. No SQL Editor,
   registre **apenas** o `TOKEN_HASH` para o mesmo `STATION_CODE` usado pelo coletor:

   ```sql
   insert into private.device_tokens (station_code, token_hash)
   values ('esp32-001', 'COLE_AQUI_O_TOKEN_HASH')
   on conflict (station_code) do update
   set token_hash = excluded.token_hash, active = true;
   ```

   O token bruto nunca deve ir ao Git, ao painel nem à tabela SQL.

## Contrato de envio

`POST https://<projeto>.supabase.co/functions/v1/ingest-sensor`

Cabeçalhos: `Content-Type: application/json` e `x-device-token: <DEVICE_TOKEN>`.

```json
{
  "event_id": "a32a20a1-78f6-4699-a0b4-a720d68e384a",
  "station_code": "esp32-001",
  "observed_at": "2026-11-09T15:00:00Z",
  "temperature_c": 25.4,
  "humidity_pct": 72.1,
  "pressure_hpa": 1009.8,
  "altitude_m": 760
}
```

`event_id`, `observed_at` e `altitude_m` são opcionais. Para reenviar após falha
de rede sem criar duplicatas, o coletor deve conservar o **mesmo `event_id`**
em cada tentativa. A função devolve HTTP 202 quando aceita a leitura.

## Leitura para o painel

- `sensor_latest`: última leitura de cada estação.
- `dashboard_sensor_series(p_start_at, p_end_at, p_bucket, p_station_code)`:
  temperatura, umidade e pressão médias por `hour`, `day` ou `month`.
  `p_end_at` é exclusivo; `p_station_code` pode ser omitido.
- `dashboard_precipitation_series(p_start_date, p_end_date, p_zone, p_bucket)`:
  chuva por `day`, `month` ou `year`; `p_end_date` é inclusivo e `p_zone = null`
  inclui todas as zonas. Em cada dia, calcula a média das estações disponíveis;
  no mês/ano, soma essas médias diárias.
- `precipitation_daily`: registros históricos originais por estação e data.

As tabelas e funções de leitura têm acesso anônimo para o painel público.
A escrita é reservada ao coletor autenticado e à importação feita com chave
de servidor. Não coloque essa chave nas variáveis públicas da Vercel.
