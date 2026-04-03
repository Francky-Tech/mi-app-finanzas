// api/ai.js — Vercel Serverless Function
// Proxy seguro entre el browser y la API de Anthropic
// La API key NUNCA llega al cliente

export default async function handler(req, res) {
  // CORS — solo tu dominio en producción
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key no configurada en Vercel' });
  }

  try {
    const { messages, system, max_tokens = 1000 } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages requerido' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':         'application/json',
        'x-api-key':            apiKey,
        'anthropic-version':    '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens,
        system,
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic error:', response.status, err);
      return res.status(response.status).json({ error: 'Error de Anthropic', detail: err });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ error: 'Error interno', message: error.message });
  }
}
