// ══════════════════════════════════════════════════════════════════════════
// crm-toconline — agente seguro de leitura da API oficial TOConline
//
// Arquitetura:   CRM (browser) ──x-api-key──► esta função ──OAuth2──► TOConline
// Sem Make. Sem Zapier. Sem credenciais no browser. Sem tokens no browser.
//
// Substitui a versão que vivia no projeto do app Lovable
// ("equipaopportunitybox"), a qual tinha client_id/client_secret escritos em
// texto simples no código-fonte e reutilizava a chave de gateway da função de
// funcionários. Ambos os problemas estão corrigidos aqui.
//
// ── SECRETS OBRIGATÓRIOS (Supabase → Edge Functions → Secrets) ─────────────
//   TOC_CLIENT_ID       client_id OAuth2 do TOConline
//   TOC_CLIENT_SECRET   client_secret OAuth2 do TOConline
//   TOC_GATEWAY_KEY     chave que o CRM envia em x-api-key (própria desta
//                       função — NÃO reutilizar CRM_EMPLOYEES_API_KEY)
//
// ── SECRETS OPCIONAIS ─────────────────────────────────────────────────────
//   TOC_API_BASE        base da API. Default: https://api30.toconline.pt
//                       O TOConline atribui um host numerado por conta; o
//                       default vem do que o CRM já usa, mas NÃO está
//                       confirmado para esta conta — validar com resource=diag
//                       antes de assumir.
//   TOC_TOKEN_URL       endpoint do token. Default: derivado de TOC_API_BASE
//                       (api30 → app30) + /oauth/token
//
// Nenhum valor de segredo é registado em log nem devolvido ao cliente.
// ══════════════════════════════════════════════════════════════════════════

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const DEFAULT_API_BASE = "https://api30.toconline.pt";
const PAGE_SIZE = 100;
const MAX_PAGES = 50; // travão de segurança: 5000 registos por recurso

// Caminhos comprovados no CRM (tocoFetch/tocoSincronizarFaturas, index.html).
const PATHS = {
  invoices: "/api/v1/commercial_sales_documents?filter[document_type]=FT",
  customers: "/api/customers",
};

// ── Cache do access_token, apenas em memória da instância ──────────────────
// Nunca persistido, nunca devolvido ao cliente. Renovado 60s antes de expirar.
let tokenCache: { token: string; expiresAt: number } | null = null;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/** Comparação de tempo constante — não revela o prefixo correto da chave. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function tokenUrlFrom(apiBase: string): string {
  const explicit = Deno.env.get("TOC_TOKEN_URL");
  if (explicit) return explicit;
  // api30.toconline.pt → app30.toconline.pt (o host do OAuth espelha o da API)
  return apiBase.replace(/\/+$/, "").replace("//api", "//app") + "/oauth/token";
}

/** Obtém (ou reutiliza) o access_token. Devolve só o token, nunca o corpo bruto. */
async function getAccessToken(apiBase: string): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now) return tokenCache.token;

  const clientId = Deno.env.get("TOC_CLIENT_ID");
  const clientSecret = Deno.env.get("TOC_CLIENT_SECRET");
  // Sem fallback hardcoded, por desenho: falha explicitamente.
  if (!clientId || !clientSecret) {
    throw new HttpError(500, "Secrets em falta: TOC_CLIENT_ID e/ou TOC_CLIENT_SECRET não estão definidos.");
  }

  const res = await fetch(tokenUrlFrom(apiBase), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });

  if (!res.ok) {
    // Nunca ecoar o corpo: pode repetir credenciais enviadas.
    throw new HttpError(502, `TOConline recusou o pedido de token (HTTP ${res.status}).`);
  }

  let parsed: { access_token?: string; expires_in?: number };
  try {
    parsed = await res.json();
  } catch {
    throw new HttpError(502, "Resposta do token não é JSON válido.");
  }
  if (!parsed.access_token) throw new HttpError(502, "Resposta do token sem access_token.");

  const ttl = typeof parsed.expires_in === "number" ? parsed.expires_in : 3600;
  tokenCache = { token: parsed.access_token, expiresAt: now + Math.max(ttl - 60, 30) * 1000 };
  return tokenCache.token;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** GET autenticado à API TOConline. */
async function tocGet(apiBase: string, path: string, token: string): Promise<Response> {
  return await fetch(apiBase.replace(/\/+$/, "") + path, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
}

function extractList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    for (const k of ["data", "items", "Items", "customers", "Customers", "results"]) {
      if (Array.isArray(p[k])) return p[k] as unknown[];
    }
  }
  return [];
}

/** Percorre todas as páginas de um recurso e devolve o array completo. */
async function fetchAllPages(apiBase: string, basePath: string, token: string): Promise<unknown[]> {
  const all: unknown[] = [];
  const sep = basePath.includes("?") ? "&" : "?";
  for (let page = 1; page <= MAX_PAGES; page++) {
    const path = `${basePath}${sep}page[size]=${PAGE_SIZE}&page[number]=${page}`;
    const res = await tocGet(apiBase, path, token);
    if (!res.ok) {
      if (page === 1) throw new HttpError(res.status === 404 ? 404 : 502, `TOConline devolveu HTTP ${res.status} em ${basePath}`);
      break; // páginas seguintes falharem não invalida o já obtido
    }
    let payload: unknown;
    try { payload = await res.json(); } catch { break; }
    const lote = extractList(payload);
    if (!lote.length) break;
    all.push(...lote);
    if (lote.length < PAGE_SIZE) break;
  }
  return all;
}

/** Diagnóstico: só códigos de estado, nunca dados nem tokens. */
async function diagnostico(apiBase: string) {
  const out: Record<string, unknown> = { api_base: apiBase, token_url: tokenUrlFrom(apiBase) };
  let token: string;
  try {
    token = await getAccessToken(apiBase);
    out.oauth = "ok";
  } catch (e) {
    out.oauth = e instanceof HttpError ? e.message : "falhou";
    return out;
  }
  const testes: Record<string, string> = {};
  for (const [nome, path] of Object.entries(PATHS)) {
    try {
      const r = await tocGet(apiBase, path, token);
      testes[path] = `HTTP ${r.status}`;
    } catch {
      testes[path] = "erro de rede";
    }
  }
  out.endpoints = testes;
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "GET") return json({ error: "Apenas GET é suportado." }, 405);

  // ── Gateway: chave própria desta função ─────────────────────────────────
  const expected = Deno.env.get("TOC_GATEWAY_KEY");
  if (!expected) return json({ error: "Secret em falta: TOC_GATEWAY_KEY não está definido." }, 500);
  const provided = req.headers.get("x-api-key") ?? "";
  if (!safeEqual(provided, expected)) return json({ error: "Não autorizado." }, 401);

  const url = new URL(req.url);
  const apiBase = Deno.env.get("TOC_API_BASE") || DEFAULT_API_BASE;
  const resource = url.searchParams.get("resource") ?? "";

  try {
    // Diagnóstico — valida credenciais e host sem devolver dados nem token.
    if (resource === "diag") return json(await diagnostico(apiBase), 200);

    // Confirma que o OAuth funciona. NUNCA devolve o token (ao contrário da
    // versão antiga, que devolvia o JSON completo ao browser).
    if (resource === "token") {
      await getAccessToken(apiBase);
      return json({ ok: true, expira_em_s: Math.round(((tokenCache?.expiresAt ?? 0) - Date.now()) / 1000) }, 200);
    }

    if (resource === "invoices" || resource === "customers" || resource === "clients") {
      const path = resource === "invoices" ? PATHS.invoices : PATHS.customers; // clients ≡ customers
      const token = await getAccessToken(apiBase);
      const data = await fetchAllPages(apiBase, path, token);
      return json({ resource, count: data.length, data }, 200);
    }

    return json({ error: "resource inválido. Use: invoices | customers | clients | token | diag" }, 400);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    return json({ error: "Erro interno ao contactar o TOConline." }, 500);
  }
});
