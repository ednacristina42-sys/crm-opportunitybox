// ══════════════════════════════════════════════════════════════════════════
// crm-toconline — agente seguro de leitura da API oficial TOConline
//
// Arquitetura:   CRM (browser) ──x-api-key──► esta função ──OAuth2──► TOConline
// Sem Make. Sem Zapier. Sem credenciais no browser. Sem tokens no browser.
//
// ── CONFORMIDADE COM A DOCUMENTAÇÃO OFICIAL (api-docs.toconline.pt) ────────
// "Autenticação Detalhada" / "Autenticação Simplificada":
//   • O pedido de token é POST a  OAUTH_URL/token
//   • As credenciais vão no cabeçalho  Authorization: Basic base64(client_id:secret)
//     — NÃO no corpo. (A versão anterior enviava-as no corpo: corrigido.)
//   • O corpo vai URL-encoded.
//   • A resposta traz access_token, refresh_token e expires_in.
//   • OAUTH_URL e API_URL são fornecidos por conta, junto com as credenciais.
//     Por isso NÃO são adivinhados aqui — ver TOC_OAUTH_URL / TOC_API_BASE.
//
// Fluxo: a doc descreve authorization_code (GET OAUTH_URL/auth → POST /token).
// Esse primeiro passo exige uma autorização humana no TOConline, impossível de
// fazer sem interação. Por isso esta função suporta os dois modos que podem
// correr sem interação, e diz qual funcionou:
//   • TOC_REFRESH_TOKEN definido  → grant_type=refresh_token   (recomendado)
//   • caso contrário              → grant_type=client_credentials
//
// ── SECRETS OBRIGATÓRIOS ──────────────────────────────────────────────────
//   TOC_CLIENT_ID       "Identificador" / OAUTH_CLIENT_ID
//   TOC_CLIENT_SECRET   "Segredo" / OAUTH_CLIENT_SECRET
//   TOC_GATEWAY_KEY     chave que o CRM envia em x-api-key (própria desta
//                       função — NÃO reutilizar CRM_EMPLOYEES_API_KEY)
//
// ── SECRETS OPCIONAIS ─────────────────────────────────────────────────────
//   TOC_API_BASE        API_URL da conta.   Default: https://api30.toconline.pt
//   TOC_OAUTH_URL       OAUTH_URL da conta. Default: derivado de TOC_API_BASE
//   TOC_REFRESH_TOKEN   refresh_token obtido na autorização inicial
//
// Nenhum valor de segredo é registado em log nem devolvido ao cliente.
// Nenhum access_token ou refresh_token sai desta função.
// ══════════════════════════════════════════════════════════════════════════

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const DEFAULT_API_BASE = "https://api30.toconline.pt";
const PAGE_SIZE = 100;
const MAX_PAGES = 50; // travão: 5000 registos por recurso

// A doc oficial usa API_URL + caminho; conforme a conta, o prefixo "/api" pode
// ou não fazer parte do API_URL. Tentamos os candidatos por ordem e ficamos
// pelo primeiro que responda — o diag reporta qual resolveu.
const RECURSOS: Record<string, { paths: string[]; query?: string }> = {
  customers:    { paths: ["/api/customers", "/customers"] },
  invoices:     { paths: ["/api/v1/commercial_sales_documents", "/commercial_sales_documents"], query: "filter[document_type]=FT" },
  credit_notes: { paths: ["/api/v1/commercial_sales_documents", "/commercial_sales_documents"], query: "filter[document_type]=NC" },
  receipts:     { paths: ["/api/v1/commercial_sales_receipts", "/commercial_sales_receipts"] },
};
const ALIAS: Record<string, string> = { clients: "customers" };

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

// Cache do access_token, só em memória da instância. Nunca persistido.
let tokenCache: { token: string; expiresAt: number; grant: string } | null = null;
// Caminho já resolvido por recurso, para não repetir tentativas.
const pathCache: Record<string, string> = {};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

/** Comparação de tempo constante — não revela o prefixo correto da chave. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const semBarra = (s: string) => s.replace(/\/+$/, "");

function oauthUrl(apiBase: string): string {
  const explicito = Deno.env.get("TOC_OAUTH_URL");
  if (explicito) return semBarra(explicito);
  // api30.toconline.pt → app30.toconline.pt (o host do OAuth espelha o da API)
  return semBarra(apiBase).replace("//api", "//app");
}

/** Obtém (ou reutiliza) o access_token, conforme a doc oficial. */
async function getAccessToken(apiBase: string): Promise<string> {
  const agora = Date.now();
  if (tokenCache && tokenCache.expiresAt > agora) return tokenCache.token;

  const clientId = Deno.env.get("TOC_CLIENT_ID");
  const clientSecret = Deno.env.get("TOC_CLIENT_SECRET");
  // Sem fallback hardcoded, por desenho: falha explicitamente.
  if (!clientId || !clientSecret) {
    throw new HttpError(500, "Secrets em falta: TOC_CLIENT_ID e/ou TOC_CLIENT_SECRET não estão definidos.");
  }

  const refresh = Deno.env.get("TOC_REFRESH_TOKEN");
  const corpo = refresh
    ? new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh })
    : new URLSearchParams({ grant_type: "client_credentials" });
  const grant = refresh ? "refresh_token" : "client_credentials";

  // Doc oficial: Authorization: Basic base64(client_id ":" secret)
  const basic = btoa(`${clientId}:${clientSecret}`);

  const res = await fetch(`${oauthUrl(apiBase)}/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: corpo.toString(),
  });

  if (!res.ok) {
    // Nunca ecoar o corpo: pode repetir credenciais enviadas.
    throw new HttpError(502, `TOConline recusou o pedido de token (HTTP ${res.status}, grant_type=${grant}).`);
  }

  let parsed: { access_token?: string; expires_in?: number };
  try { parsed = await res.json(); } catch { throw new HttpError(502, "Resposta do token não é JSON válido."); }
  if (!parsed.access_token) throw new HttpError(502, "Resposta do token sem access_token.");

  const ttl = typeof parsed.expires_in === "number" ? parsed.expires_in : 3600;
  tokenCache = { token: parsed.access_token, expiresAt: agora + Math.max(ttl - 60, 30) * 1000, grant };
  return tokenCache.token;
}

async function tocGet(apiBase: string, path: string, token: string): Promise<Response> {
  return await fetch(semBarra(apiBase) + path, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
}

/** Descobre qual dos caminhos candidatos responde nesta conta. */
async function resolverPath(apiBase: string, recurso: string, token: string): Promise<string> {
  if (pathCache[recurso]) return pathCache[recurso];
  const cfg = RECURSOS[recurso];
  let ultimo = 0;
  for (const p of cfg.paths) {
    const r = await tocGet(apiBase, p + (cfg.query ? "?" + cfg.query : ""), token);
    if (r.ok) { pathCache[recurso] = p; return p; }
    ultimo = r.status;
    if (r.status === 401 || r.status === 403) break; // não é o caminho, é a autorização
  }
  throw new HttpError(ultimo === 401 || ultimo === 403 ? 502 : 404,
    `Nenhum endpoint de '${recurso}' respondeu em ${apiBase} (último HTTP ${ultimo}). Verificar TOC_API_BASE.`);
}

function extrairLista(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    for (const k of ["data", "items", "Items", "customers", "Customers", "results"]) {
      if (Array.isArray(p[k])) return p[k] as unknown[];
    }
  }
  return [];
}

async function buscarTudo(apiBase: string, recurso: string, token: string): Promise<unknown[]> {
  const cfg = RECURSOS[recurso];
  const path = await resolverPath(apiBase, recurso, token);
  const todos: unknown[] = [];
  for (let pagina = 1; pagina <= MAX_PAGES; pagina++) {
    const qs = [cfg.query, `page[size]=${PAGE_SIZE}`, `page[number]=${pagina}`].filter(Boolean).join("&");
    const res = await tocGet(apiBase, `${path}?${qs}`, token);
    if (!res.ok) {
      if (pagina === 1) throw new HttpError(502, `TOConline devolveu HTTP ${res.status} em ${path}`);
      break;
    }
    let payload: unknown;
    try { payload = await res.json(); } catch { break; }
    const lote = extrairLista(payload);
    if (!lote.length) break;
    todos.push(...lote);
    if (lote.length < PAGE_SIZE) break;
  }
  return todos;
}

/** Diagnóstico: só metadados e códigos de estado. Nunca dados, nunca tokens. */
async function diagnostico(apiBase: string) {
  const out: Record<string, unknown> = {
    api_base: apiBase,
    oauth_url: oauthUrl(apiBase) + "/token",
    grant_type: Deno.env.get("TOC_REFRESH_TOKEN") ? "refresh_token" : "client_credentials",
    secrets: {
      TOC_CLIENT_ID: Deno.env.get("TOC_CLIENT_ID") ? "definido" : "EM FALTA",
      TOC_CLIENT_SECRET: Deno.env.get("TOC_CLIENT_SECRET") ? "definido" : "EM FALTA",
      TOC_GATEWAY_KEY: Deno.env.get("TOC_GATEWAY_KEY") ? "definido" : "EM FALTA",
      TOC_API_BASE: Deno.env.get("TOC_API_BASE") ? "definido" : "a usar default",
      TOC_OAUTH_URL: Deno.env.get("TOC_OAUTH_URL") ? "definido" : "a usar default",
      TOC_REFRESH_TOKEN: Deno.env.get("TOC_REFRESH_TOKEN") ? "definido" : "não definido",
    },
  };
  let token: string;
  try {
    token = await getAccessToken(apiBase);
    out.oauth = "ok";
  } catch (e) {
    out.oauth = e instanceof HttpError ? e.message : "falhou";
    return out;
  }
  const endpoints: Record<string, string> = {};
  for (const recurso of Object.keys(RECURSOS)) {
    const cfg = RECURSOS[recurso];
    const linhas: string[] = [];
    for (const p of cfg.paths) {
      try {
        const r = await tocGet(apiBase, p + (cfg.query ? "?" + cfg.query : ""), token);
        linhas.push(`${p} → HTTP ${r.status}`);
        if (r.ok) break;
      } catch { linhas.push(`${p} → erro de rede`); }
    }
    endpoints[recurso] = linhas.join(" | ");
  }
  out.endpoints = endpoints;
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "GET") return json({ error: "Apenas GET é suportado." }, 405);

  const url = new URL(req.url);

  // ── Gateway: chave própria desta função ─────────────────────────────────
  // Aceita no cabeçalho x-api-key (preferido) ou em ?key= — este último por
  // conveniência de diagnóstico a partir de um link, ao custo de a chave
  // aparecer nos logs do gateway. Não é uma credencial TOConline.
  const esperada = Deno.env.get("TOC_GATEWAY_KEY");
  if (!esperada) return json({ error: "Secret em falta: TOC_GATEWAY_KEY não está definido." }, 500);
  const fornecida = req.headers.get("x-api-key") ?? url.searchParams.get("key") ?? "";
  if (!safeEqual(fornecida, esperada)) return json({ error: "Não autorizado." }, 401);

  const apiBase = semBarra(Deno.env.get("TOC_API_BASE") || DEFAULT_API_BASE);
  const pedido = url.searchParams.get("resource") ?? "";
  const recurso = ALIAS[pedido] ?? pedido;

  try {
    if (pedido === "diag") return json(await diagnostico(apiBase), 200);

    // Confirma o OAuth sem NUNCA devolver o token.
    if (pedido === "token") {
      await getAccessToken(apiBase);
      return json({
        ok: true,
        grant_type: tokenCache?.grant,
        expira_em_s: Math.round(((tokenCache?.expiresAt ?? 0) - Date.now()) / 1000),
      }, 200);
    }

    if (RECURSOS[recurso]) {
      const token = await getAccessToken(apiBase);
      const data = await buscarTudo(apiBase, recurso, token);
      return json({ resource: pedido, resolved: recurso, path: pathCache[recurso], count: data.length, data }, 200);
    }

    return json({ error: "resource inválido. Use: customers | clients | invoices | credit_notes | receipts | token | diag" }, 400);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    return json({ error: "Erro interno ao contactar o TOConline." }, 500);
  }
});
