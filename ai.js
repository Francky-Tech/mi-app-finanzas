// ============================================================
// AHORRAPP PRO — Vercel Serverless Function (api/ai.js)
// Proxy multi-IA: soporta Claude (Anthropic) y ChatGPT (OpenAI)
// Variables de entorno requeridas en Vercel:
//   ANTHROPIC_API_KEY  → tu key de Anthropic
//   OPENAI_API_KEY     → tu key de OpenAI
// ============================================================

export default async function handler(req, res) {

  // ── CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { system, messages, max_tokens = 1000, provider = 'claude' } = req.body || {};

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages es requerido' });
  }

  try {

    // ── CLAUDE (Anthropic) ──────────────────────────────────
    if (provider === 'claude') {
      const payload = { model: 'claude-sonnet-4-20250514', max_tokens, messages };
      if (system) payload.system = system;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'Error de Anthropic' });

      return res.status(200).json({
        provider: 'claude',
        content: data.content,
      });
    }

    // ── CHATGPT (OpenAI) ────────────────────────────────────
    if (provider === 'openai') {
      const openaiMessages = system
        ? [{ role: 'system', content: system }, ...messages]
        : messages;

      const payload = { model: 'gpt-4o', max_tokens, messages: openaiMessages };

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'Error de OpenAI' });

      // Normalizar al mismo formato que Claude para que app.js no cambie
      return res.status(200).json({
        provider: 'openai',
        content: [{ type: 'text', text: data.choices?.[0]?.message?.content || '' }],
      });
    }

    return res.status(400).json({ error: `Proveedor desconocido: ${provider}` });

  } catch (e) {
    return res.status(502).json({ error: 'Error de conexión: ' + e.message });
  }
}
