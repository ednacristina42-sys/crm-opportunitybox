// ════════════════════════════════════════════════════════════════════
// Função Netlify: Vetorização Automática com IA (Vectorizer.AI)
// OpportunityBox Business OS
//
// Proxy seguro entre o CRM (browser) e a API do Vectorizer.AI:
//   - a chave da API nunca fica exposta no HTML público
//   - evita restrições de CORS do browser
//
// Configuração (Netlify → Site settings → Environment variables):
//   VECTORIZER_API_KEY  = "API_ID:API_SECRET"  (obrigatória, obtida em
//                          https://vectorizer.ai/account)
//   VECTORIZER_ENDPOINT = URL alternativo da API (opcional; por omissão
//                          https://vectorizer.ai/api/v1/vectorize)
//
// Pedido (POST, JSON):
//   { image: "<data URL ou base64>", filename, mode, format }
//     mode:   production | preview | test | test_preview
//     format: svg | dxf | eps | pdf | png
//
// Resposta (JSON):
//   { ok, filename, contentType, base64, creditsCharged }
// ════════════════════════════════════════════════════════════════════

const ENDPOINT = process.env.VECTORIZER_ENDPOINT || 'https://vectorizer.ai/api/v1/vectorize';
const FORMATOS = new Set(['svg', 'dxf', 'eps', 'pdf', 'png']);
const MODOS = new Set(['production', 'preview', 'test', 'test_preview']);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Vectorizer-Key',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não suportado — usa POST.' }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Corpo do pedido inválido — esperado JSON.' }, 400);
  }

  // Chave: variável de ambiente (recomendado) ou header enviado pelo CRM
  const key = (req.headers.get('x-vectorizer-key') || process.env.VECTORIZER_API_KEY || '').trim();
  if (!key || !key.includes(':')) {
    return json({
      error: 'Chave da API Vectorizer.AI não configurada. Define VECTORIZER_API_KEY ' +
             '(formato "API_ID:API_SECRET") nas variáveis de ambiente do Netlify, ' +
             'ou introduz a chave no campo 🔑 do painel de Vetorização IA.',
    }, 401);
  }

  // Aceita data URL ("data:image/png;base64,...") ou base64 puro
  let base64 = String(body.image || '');
  let mime = body.mimeType || 'image/png';
  const dataUrl = base64.match(/^data:([^;]+);base64,(.*)$/s);
  if (dataUrl) { mime = dataUrl[1]; base64 = dataUrl[2]; }
  if (!base64) return json({ error: 'Campo "image" em falta (base64 ou data URL da imagem).' }, 400);

  const formato = FORMATOS.has(body.format) ? body.format : 'svg';
  const modo = MODOS.has(body.mode) ? body.mode : 'production';
  const nomeOriginal = String(body.filename || 'imagem.png');
  const nomeSaida = nomeOriginal.replace(/\.[a-z0-9]+$/i, '') + '.' + formato;

  const form = new FormData();
  form.append('image', new Blob([Buffer.from(base64, 'base64')], { type: mime }), nomeOriginal);
  form.append('mode', modo);
  form.append('output.file_format', formato);

  let r;
  try {
    r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(key).toString('base64') },
      body: form,
    });
  } catch (e) {
    return json({ error: 'Falha de rede ao contactar o Vectorizer.AI.', detail: String(e) }, 502);
  }

  if (!r.ok) {
    const detail = (await r.text().catch(() => '')).slice(0, 600);
    return json({
      error: 'O Vectorizer.AI devolveu o erro ' + r.status +
             (r.status === 401 ? ' (chave inválida — verifica API_ID:API_SECRET)' : ''),
      detail,
    }, r.status === 401 ? 401 : 502);
  }

  const buf = Buffer.from(await r.arrayBuffer());
  return json({
    ok: true,
    filename: nomeSaida,
    contentType: r.headers.get('content-type') ||
      (formato === 'svg' ? 'image/svg+xml' : 'application/octet-stream'),
    base64: buf.toString('base64'),
    creditsCharged: r.headers.get('x-credits-charged') || null,
    creditsCalculated: r.headers.get('x-credits-calculated') || null,
  });
};
