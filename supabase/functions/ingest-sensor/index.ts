import { createClient } from "npm:@supabase/supabase-js@2";

type Payload = Record<string, unknown>;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const newKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  let key: string | undefined;
  if (newKeys) {
    try {
      key = JSON.parse(newKeys).default;
    } catch {
      // Configuration failure is reported below without exposing key contents.
    }
  }
  key ??= Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? undefined;
  if (!url || !key) throw new Error("Supabase server credentials are missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function finiteNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
}

function parseObservation(payload: Payload): { value?: Record<string, unknown>; error?: string } {
  const stationCode = payload.station_code;
  if (typeof stationCode !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(stationCode)) {
    return { error: "station_code inválido" };
  }

  const temperature = finiteNumber(payload.temperature_c, -50, 85);
  const humidity = finiteNumber(payload.humidity_pct, 0, 100);
  const pressure = finiteNumber(payload.pressure_hpa, 300, 1100);
  if (temperature === null || humidity === null || pressure === null) {
    return { error: "temperature_c, humidity_pct ou pressure_hpa inválido" };
  }

  let altitude: number | null = null;
  if (payload.altitude_m !== undefined && payload.altitude_m !== null) {
    altitude = finiteNumber(payload.altitude_m, -500, 10000);
    if (altitude === null) return { error: "altitude_m inválido" };
  }

  let observedAt = new Date();
  if (payload.observed_at !== undefined) {
    if (
      typeof payload.observed_at !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(payload.observed_at)
    ) return { error: "observed_at precisa ser ISO 8601 com fuso horário" };
    observedAt = new Date(payload.observed_at);
    if (!Number.isFinite(observedAt.getTime()) || observedAt.getTime() > Date.now() + 300_000) {
      return { error: "observed_at inválido ou no futuro" };
    }
  }

  let eventId = crypto.randomUUID();
  if (payload.event_id !== undefined) {
    if (typeof payload.event_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.event_id)) {
      return { error: "event_id inválido" };
    }
    eventId = payload.event_id;
  }

  return {
    value: {
      event_id: eventId,
      station_code: stationCode,
      observed_at: observedAt.toISOString(),
      temperature_c: temperature,
      humidity_pct: humidity,
      pressure_hpa: pressure,
      altitude_m: altitude,
    },
  };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json(405, { error: "Use POST" });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json(415, { error: "Envie JSON" });
  }

  const token = request.headers.get("x-device-token") ?? "";
  if (token.length < 32 || token.length > 256) return json(401, { error: "Token inválido" });

  let payload: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 4096) return json(413, { error: "Payload muito grande" });
    payload = JSON.parse(raw);
  } catch {
    return json(400, { error: "JSON inválido" });
  }
  if (payload === null || Array.isArray(payload) || typeof payload !== "object") {
    return json(400, { error: "Objeto JSON esperado" });
  }

  const parsed = parseObservation(payload as Payload);
  if (!parsed.value) return json(400, { error: parsed.error });

  try {
    const supabase = adminClient();
    const { data: authorized, error: authError } = await supabase.rpc("device_token_valid", {
      p_station_code: parsed.value.station_code,
      p_token_hash: await sha256(token),
    });
    if (authError) {
      console.error("Device authorization failed", authError.message);
      return json(503, { error: "Autorização indisponível" });
    }
    if (!authorized) return json(401, { error: "Dispositivo não autorizado" });

    const { error: insertError } = await supabase.from("sensor_readings").upsert(parsed.value, {
      onConflict: "event_id",
      ignoreDuplicates: true,
    });
    if (insertError) {
      console.error("Sensor insert failed", insertError.message);
      return json(503, { error: "Não foi possível salvar a leitura" });
    }
    return json(202, { accepted: true, event_id: parsed.value.event_id });
  } catch (error) {
    console.error("Sensor ingest failed", error instanceof Error ? error.message : "unknown");
    return json(503, { error: "Serviço indisponível" });
  }
});
