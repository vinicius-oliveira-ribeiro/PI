-- Historical CGESP precipitation and readings from the BME280 station.
-- Run this migration before importing CSV data or deploying ingest-sensor.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.precipitation_daily (
    station_code text not null check (length(station_code) between 1 and 80),
    station_name text not null check (length(station_name) between 1 and 160),
    zone text not null check (zone in ('Norte', 'Sul', 'Leste', 'Oeste', 'Centro')),
    observed_on date not null,
    precipitation_mm numeric(10, 2) not null check (precipitation_mm >= 0),
    source_file text not null,
    primary key (station_code, observed_on)
);

create index if not exists precipitation_daily_zone_date_idx
    on public.precipitation_daily (zone, observed_on);
create index if not exists precipitation_daily_date_idx
    on public.precipitation_daily (observed_on);

create table if not exists public.sensor_readings (
    id bigint generated always as identity primary key,
    event_id uuid not null unique,
    station_code text not null check (station_code ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
    observed_at timestamptz not null,
    temperature_c numeric(6, 2) not null check (temperature_c between -50 and 85),
    humidity_pct numeric(5, 2) not null check (humidity_pct between 0 and 100),
    pressure_hpa numeric(7, 2) not null check (pressure_hpa between 300 and 1100),
    altitude_m numeric(8, 2),
    received_at timestamptz not null default now()
);

create index if not exists sensor_readings_station_time_idx
    on public.sensor_readings (station_code, observed_at desc);
create index if not exists sensor_readings_time_idx
    on public.sensor_readings (observed_at desc);

-- Device secrets stay outside the API-exposed public schema. Store only SHA-256 hashes.
create table if not exists private.device_tokens (
    station_code text primary key check (station_code ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
    token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
    active boolean not null default true,
    created_at timestamptz not null default now()
);

alter table public.precipitation_daily enable row level security;
alter table public.sensor_readings enable row level security;
alter table private.device_tokens enable row level security;

-- The public dashboard can read weather observations. Only the trusted importer
-- and the Edge Function, both using a server-side secret key, can write them.
revoke all on public.precipitation_daily from anon, authenticated;
revoke all on public.sensor_readings from anon, authenticated;
grant select on public.precipitation_daily to anon, authenticated;
grant select on public.sensor_readings to anon, authenticated;
grant select, insert, update on public.precipitation_daily to service_role;
grant select, insert on public.sensor_readings to service_role;

create policy precipitation_public_read on public.precipitation_daily
    for select to anon, authenticated using (true);
create policy sensor_public_read on public.sensor_readings
    for select to anon, authenticated using (true);

revoke all on private.device_tokens from public, anon, authenticated;

-- Only the trusted Edge Function's secret-key client can check token hashes.
create or replace function public.device_token_valid(
    p_station_code text,
    p_token_hash text
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from private.device_tokens as d
        where d.station_code = p_station_code
          and d.token_hash = p_token_hash
          and d.active
    );
$$;
revoke all on function public.device_token_valid(text, text) from public, anon, authenticated;
grant execute on function public.device_token_valid(text, text) to service_role;

-- Latest reading for each station, subject to the underlying table's RLS policy.
create or replace view public.sensor_latest
with (security_invoker = true)
as
select distinct on (station_code)
    station_code, observed_at, temperature_c, humidity_pct,
    pressure_hpa, altitude_m, received_at
from public.sensor_readings
order by station_code, observed_at desc, id desc;
revoke all on public.sensor_latest from public, anon, authenticated;
grant select on public.sensor_latest to anon, authenticated;

-- Daily precipitation is averaged across reporting stations, then summed into
-- months/years. This avoids counting every station as extra rainfall.
create or replace function public.dashboard_precipitation_series(
    p_start_date date,
    p_end_date date,
    p_zone text,
    p_bucket text
) returns table (
    period_start date,
    rain_mm numeric,
    station_count bigint,
    observation_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
    if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
        raise exception 'Invalid precipitation date range';
    end if;
    if p_bucket not in ('day', 'month', 'year') or p_bucket is null then
        raise exception 'Invalid precipitation bucket';
    end if;
    return query
    with filtered as materialized (
        select p.station_code, p.observed_on, p.precipitation_mm,
               date_trunc(p_bucket, p.observed_on::timestamp)::date as bucket_start
        from public.precipitation_daily as p
        where p.observed_on between p_start_date and p_end_date
          and (p_zone is null or p.zone = p_zone)
    ), per_day as (
        select f.bucket_start, f.observed_on, avg(f.precipitation_mm) as daily_mean
        from filtered as f
        group by f.bucket_start, f.observed_on
    ), rainfall as (
        select d.bucket_start, round(sum(d.daily_mean), 2) as total_mm
        from per_day as d
        group by d.bucket_start
    ), coverage as (
        select f.bucket_start,
               count(distinct f.station_code) as stations,
               count(*) as observations
        from filtered as f
        group by f.bucket_start
    )
    select r.bucket_start, r.total_mm, c.stations, c.observations
    from rainfall as r
    join coverage as c using (bucket_start)
    order by r.bucket_start;
end;
$$;
revoke all on function public.dashboard_precipitation_series(date, date, text, text) from public;
grant execute on function public.dashboard_precipitation_series(date, date, text, text)
    to anon, authenticated;

create or replace function public.dashboard_sensor_series(
    p_start_at timestamptz,
    p_end_at timestamptz,
    p_bucket text,
    p_station_code text default null
) returns table (
    period_start timestamptz,
    temperature_c numeric,
    humidity_pct numeric,
    pressure_hpa numeric,
    sample_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
    if p_start_at is null or p_end_at is null or p_start_at >= p_end_at then
        raise exception 'Invalid sensor time range';
    end if;
    if p_bucket not in ('hour', 'day', 'month') or p_bucket is null then
        raise exception 'Invalid sensor bucket';
    end if;
    return query
    select date_trunc(p_bucket, s.observed_at at time zone 'UTC') at time zone 'UTC',
           round(avg(s.temperature_c), 2),
           round(avg(s.humidity_pct), 2),
           round(avg(s.pressure_hpa), 2),
           count(*)
    from public.sensor_readings as s
    where s.observed_at >= p_start_at
      and s.observed_at < p_end_at
      and (p_station_code is null or s.station_code = p_station_code)
    group by 1
    order by 1;
end;
$$;
revoke all on function public.dashboard_sensor_series(timestamptz, timestamptz, text, text) from public;
grant execute on function public.dashboard_sensor_series(timestamptz, timestamptz, text, text)
    to anon, authenticated;
