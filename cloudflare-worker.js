// ============================================================
// AHORRAPP PRO — Cloudflare Worker (proxy Anthropic API)
// ============================================================
// Despliegue: workers.cloudflare.com
// Variable requerida: ANTHROPIC_API_KEY (encriptada en el dashboard)
// ============================================================

const ALLOWED_ORIGIN = '*'; // Cambia a 'https://mi-app-finanzas-iota.vercel.app' para mayor seguridad

export default {
  async fetch(request, env) {

    // ── CORS preflight ──────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(ALLOWED_ORIGIN),
      });
    }

    // ── Solo POST ───────────────────────────────────────────
    if (request.method !== 'POST') {
      return jsonError('Método no permitido', 405);
    }

    // ── Leer body ───────────────────────────────────────────
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonError('Body JSON inválido', 400);
    }

    const { system, messages, max_tokens = 1000 } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return jsonError('messages es requerido y debe ser un array', 400);
    }

    // ── Llamada a Anthropic ─────────────────────────────────
    const anthropicPayload = {
      model: 'claude-sonnet-4-20250514',
      max_tokens,
      messages,
    };
    if (system) anthropicPayload.system = system;

    let anthropicResp;
    try {
      anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':         'application/json',
          'x-api-key':            env.ANTHROPIC_API_KEY,
          'anthropic-version':    '2023-06-01',
        },
        body: JSON.stringify(anthropicPayload),
      });
    } catch (e) {
      return jsonError('No se pudo conectar con Anthropic: ' + e.message, 502);
    }

    // ── Pasar respuesta al cliente ──────────────────────────
    const data = await anthropicResp.json();

    if (!anthropicResp.ok) {
      return new Response(JSON.stringify({ error: data.error?.message || 'Error de Anthropic' }), {
        status: anthropicResp.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(ALLOWED_ORIGIN) },
      });
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(ALLOWED_ORIGIN) },
    });
  },
};

// ── Helpers ─────────────────────────────────────────────────
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonError(msg, status = 500) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(ALLOWED_ORIGIN) },
  });
}
