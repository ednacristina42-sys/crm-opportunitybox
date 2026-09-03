// ══════════════════════════════════════════════════════════════════════════
// crm-toconline — agente seguro de leitura da API oficial TOConline
//
// Arquitetura:   CRM (browser) ──x-api-key──► esta função ──OAuth2──► TOConline
// Sem Make. Sem credenciais no browser. Sem access_token no browser.
//
// ── OAUTH: authorization_code + refresh_token (doc oficial) ───────────────
// api-docs.toconline.pt, "Autenticação Detalhada":
//   1) GET  OAUTH_URL/auth?response_type=code&client_id=…&redirect_uri=…&scope=commercial
//   2) POST OAUTH_URL/token  com  Authorization: Basic base64(client_id:secret)
//      e corpo URL-encoded → devolve access_token + refresh_token + expires_in
//   3) Renovação: POST OAUTH_URL/token com grant_type=refresh_token
//
// NÃO existe caminho client_credentials nesta função — foi removido por não
// constar da documentação oficial.
//
// A autorização inicial (passo 1) exige um clique humano no TOConline. Como
// nem o assistente nem o CRM conseguem alcançar o TOConline, é a PRÓPRIA
// função que conduz o fluxo:
//   ?resource=auth      → redirige o browser para o ecrã de autorização
//   (retorno)           → recebe o code, troca por tokens, mostra o
//                         refresh_token UMA vez para ser gravado como secret,
//                         e corre logo o diagnóstico com o token acabado de obter
//
// ── SECRETS OBRIGATÓRIOS ──────────────────────────────────────────────────
//   TOC_CLIENT_ID       "Identificador" / OAUTH_CLIENT_ID
//   TOC_CLIENT_SECRET   "Segredo" / OAUTH_CLIENT_SECRET
//   TOC_GATEWAY_KEY     chave que o CRM envia em x-api-key (SÓ no cabeçalho)
//
// ── SECRETS OPCIONAIS ─────────────────────────────────────────────────────
//   TOC_REFRESH_TOKEN   obtido no fluxo acima; sem ele não há leitura de dados
//   TOC_API_BASE        API_URL da conta.   Default: https://api30.toconline.pt
//   TOC_OAUTH_URL       OAUTH_URL da conta. Default: derivado de TOC_API_BASE
//   TOC_REDIRECT_URI    Default: https://<SUPABASE_URL>/functions/v1/crm-toconline
//
// Nenhum segredo é registado em log. O access_token nunca sai da função.
// O refresh_token só aparece na página de callback, uma vez, para quem
// acabou de autorizar — é a única forma de o levar até aos secrets.
// ══════════════════════════════════════════════════════════════════════════

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const DEFAULT_API_BASE = "https://api30.toconline.pt";
const SCOPE = "commercial";
const PAGE_SIZE = 100;
const MAX_PAGES = 50;
const STATE_TTL_MS = 15 * 60 * 1000;

// Nesta conta (api2) o caminho valido das faturas e /commercial_sales_documents:
// /api/v1/commercial_sales_documents devolve HTTP 400 para document_type=FT.
// A ordem abaixo mantem-se porque resolverPath ja cai no segundo caminho, e
// noutras contas o /api/v1 e o que responde. Os endpoints diretos abaixo
// (resource=invoices/credit_notes/receipts) e o snapshot do callback OAuth
// continuam limitados por MAX_PAGES (recolha rapida/leve, comportamento
// inalterado). A recolha integral do historico, sem esse teto, e feita à
// parte por resource=finance_audit (ver buscarDocumentosCompletos).
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

let tokenCache: { token: string; expiresAt: number } | null = null;
const pathCache: Record<string, string> = {};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const html = (body: string, status = 200) =>
  new Response(`<!doctype html><meta charset="utf-8"><title>crm-toconline</title>` +
    `<style>body{font:15px/1.6 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#222}` +
    `code,pre{background:#f4f4f5;border-radius:6px;padding:2px 6px;font-family:ui-monospace,monospace;word-break:break-all}` +
    `pre{padding:14px;white-space:pre-wrap}.ok{color:#137333}.err{color:#c5221f}h1{font-size:20px}</style>${body}`,
    { status, headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    } });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const semBarra = (s: string) => s.replace(/\/+$/, "");

function precisaSecret(nome: string): string {
  const v = Deno.env.get(nome);
  if (!v) throw new HttpError(500, `Secret em falta: ${nome} nao esta definido.`);
  return v;
}

function apiBase(): string { return semBarra(Deno.env.get("TOC_API_BASE") || DEFAULT_API_BASE); }
function oauthUrl(): string {
  const e = Deno.env.get("TOC_OAUTH_URL");
  return e ? semBarra(e) : semBarra(apiBase()).replace("//api", "//app");
}
// O callback e a URL publica e completa desta funcao, SEM query string:
//   https://<ref>.supabase.co/functions/v1/crm-toconline
//
// Duas regras que custaram caro e ficam aqui registadas:
//  1. Nao pode ser derivada de req.url. O runtime das Edge Functions apresenta
//     o pedido interno como http://<ref>.supabase.co/crm-toconline — perde o
//     https e perde o /functions/v1.
//  2. Nao pode levar query string. A documentacao do TOConline descreve o
//     OAUTH_REDIRECT_URL como um endereco fixo, registado no formulario das
//     credenciais, e todos os exemplos sao URLs sem query. Enviar
//     ?resource=callback dava invalid_request, e no unico retorno que chegou
//     a sair o parametro vinha descartado — o servidor reconstroi o endereco.
//     O callback passa a ser reconhecido pelo code/error + state (ver router).
const NOME_FUNCAO = "crm-toconline";
const CALLBACK_FALLBACK =
  `https://ddzlbmnmsdyodouqxbjx.supabase.co/functions/v1/${NOME_FUNCAO}`;

function redirectUri(): string {
  const e = Deno.env.get("TOC_REDIRECT_URI");
  if (e) return e.trim();
  const base = Deno.env.get("SUPABASE_URL");
  if (base) return `${semBarra(base)}/functions/v1/${NOME_FUNCAO}`;
  return CALLBACK_FALLBACK;
}

// ── state assinado (HMAC com a gateway key): sem estado no servidor ────────
async function assinarState(): Promise<string> {
  const chave = precisaSecret("TOC_GATEWAY_KEY");
  const ts = String(Date.now());
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(chave),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(ts));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${ts}.${hex}`;
}
async function validarState(state: string): Promise<boolean> {
  const [ts, sig] = (state || "").split(".");
  if (!ts || !sig) return false;
  if (Date.now() - Number(ts) > STATE_TTL_MS) return false;
  const chave = precisaSecret("TOC_GATEWAY_KEY");
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(chave),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const esperado = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(ts));
  const hex = [...new Uint8Array(esperado)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return safeEqual(sig, hex);
}

// ── Persistencia na base (service_role; RLS nao se aplica) ────────────────
// As chaves usadas aqui (toc-oauth, toc-snapshot) NAO constam da politica de
// anon (limitada a ob-leads / ob-clients / ob-crm-atividades / ob-crm-historico),
// por isso nao ficam legiveis pelo browser.
const CHAVE_OAUTH = "toc-oauth";
const CHAVE_SNAPSHOT = "toc-snapshot";
const CHAVE_SYNC = "toc-sync-estado";
const CHAVE_CLIENTES = "ob-clients";
// Fase C — auditoria financeira, SOMENTE LEITURA. CHAVE_FINANCE_AUDIT e uma
// chave nova, propria desta auditoria: nunca e lida por Financeiro, Ranking,
// Historico de Faturacao nem Dashboard CFO. CHAVE_TES_RECEBER e so lida aqui
// (para comparar), nunca escrita.
const CHAVE_FINANCE_AUDIT = "toc-finance-audit";
const CHAVE_TES_RECEBER = "ob-tes-receber";

function sbCfg(): { url: string; key: string } | null {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return url && key ? { url: semBarra(url), key } : null;
}

async function guardarNaBase(chave: string, dados: unknown): Promise<boolean> {
  const cfg = sbCfg();
  if (!cfg) return false;
  try {
    const r = await fetch(`${cfg.url}/rest/v1/ob_crm_dados?on_conflict=chave`, {
      method: "POST",
      headers: {
        "apikey": cfg.key,
        "Authorization": `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
      },
      body: JSON.stringify({ chave, dados, updated_at: new Date().toISOString() }),
    });
    return r.ok;
  } catch { return false; }
}

async function lerDaBase(chave: string): Promise<unknown | null> {
  const cfg = sbCfg();
  if (!cfg) return null;
  try {
    const r = await fetch(`${cfg.url}/rest/v1/ob_crm_dados?chave=eq.${encodeURIComponent(chave)}&select=dados`, {
      headers: { "apikey": cfg.key, "Authorization": `Bearer ${cfg.key}` },
    });
    if (!r.ok) return null;
    const linhas = await r.json();
    return linhas?.[0]?.dados ?? null;
  } catch { return null; }
}

// ══ AUTENTICACAO DO CHAMADOR ══════════════════════════════════════════════
// Duas vias, e a diferenca entre elas importa:
//
//  A) JWT do utilizador (o CRM no browser). O token vem do Supabase Auth da
//     sessao iniciada. NAO basta verifica-lo: a anon key do projecto e ela
//     propria um JWT valido e passaria numa verificacao ingenua (e por isso
//     que verify_jwt=true, sozinho, nao protege nada). Por isso resolve-se o
//     token em /auth/v1/user — que devolve utilizador so para tokens de
//     sessao real — e exige-se perfil ACTIVO em ob_profiles com funcao
//     reconhecida. A anon key nao tem utilizador e e recusada.
//
//  B) x-api-key (so servidor-para-servidor: o agendamento horario). Nunca
//     mais viaja no browser — o index.html deixou de a conhecer.
//
// Nada disto altera Auth ou RLS: e leitura de ob_profiles com service_role,
// exactamente as mesmas regras que o proprio CRM ja aplica no login.
const FUNCOES_VALIDAS = ["admin", "manager", "comercial", "financeiro"];

async function utilizadorDoToken(token: string): Promise<{ id: string; email: string } | null> {
  const cfg = sbCfg();
  if (!cfg) return null;
  try {
    const r = await fetch(`${cfg.url}/auth/v1/user`, {
      headers: { "apikey": cfg.key, "Authorization": `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id ? { id: u.id, email: u.email ?? "" } : null;
  } catch { return null; }
}

async function perfilActivo(userId: string): Promise<{ role: string } | null> {
  const cfg = sbCfg();
  if (!cfg) return null;
  try {
    const r = await fetch(
      `${cfg.url}/rest/v1/ob_profiles?id=eq.${encodeURIComponent(userId)}&select=id,role,active`,
      { headers: { "apikey": cfg.key, "Authorization": `Bearer ${cfg.key}` } });
    if (!r.ok) return null;
    const linhas = await r.json();
    const p = linhas?.[0];
    if (!p || p.active !== true || FUNCOES_VALIDAS.indexOf(p.role) === -1) return null;
    return { role: p.role };
  } catch { return null; }
}

type Chamador = { via: "jwt"; userId: string; role: string } | { via: "chave" };

async function autenticar(req: Request): Promise<Chamador> {
  const auth = req.headers.get("authorization") ?? "";
  if (/^Bearer\s+/i.test(auth)) {
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    const u = await utilizadorDoToken(token);
    if (!u) throw new HttpError(401, "Sessao invalida ou expirada. Volte a entrar no CRM.");
    const p = await perfilActivo(u.id);
    if (!p) throw new HttpError(403, "A sua conta nao tem perfil activo no CRM.");
    return { via: "jwt", userId: u.id, role: p.role };
  }
  const esperada = precisaSecret("TOC_GATEWAY_KEY");
  if (safeEqual(req.headers.get("x-api-key") ?? "", esperada)) return { via: "chave" };
  throw new HttpError(401, "Nao autorizado.");
}

function basicAuth(): string {
  return "Basic " + btoa(`${precisaSecret("TOC_CLIENT_ID")}:${precisaSecret("TOC_CLIENT_SECRET")}`);
}

/** POST OAUTH_URL/token, conforme a doc oficial. Devolve o JSON de tokens. */
async function pedirToken(corpo: URLSearchParams, grant: string) {
  const res = await fetch(`${oauthUrl()}/token`, {
    method: "POST",
    headers: {
      "Authorization": basicAuth(),
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: corpo.toString(),
  });
  if (!res.ok) {
    // Nunca ecoar o corpo: pode repetir credenciais enviadas.
    throw new HttpError(502, `TOConline recusou o pedido de token (HTTP ${res.status}, grant_type=${grant}).`);
  }
  try { return await res.json() as Record<string, unknown>; }
  catch { throw new HttpError(502, "Resposta do token nao e JSON valido."); }
}

/** access_token para leitura — só por refresh_token. */
async function getAccessToken(): Promise<string> {
  const agora = Date.now();
  if (tokenCache && tokenCache.expiresAt > agora) return tokenCache.token;

  // O TOConline pode rodar o refresh_token a cada utilizacao. Se so
  // dependessemos do secret, a integracao partia-se na primeira renovacao.
  // Por isso: le primeiro o valor persistido na base, com fallback ao secret,
  // e regrava sempre que a resposta trouxer um refresh_token novo.
  const guardado = await lerDaBase(CHAVE_OAUTH) as { refresh_token?: string } | null;
  const refresh = guardado?.refresh_token || Deno.env.get("TOC_REFRESH_TOKEN");
  if (!refresh) {
    throw new HttpError(428, "Autorizacao inicial por fazer: TOC_REFRESH_TOKEN nao esta definido. Abrir ?resource=auth para autorizar no TOConline.");
  }
  const t = await pedirToken(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }), "refresh_token");
  const at = t.access_token as string | undefined;
  if (!at) throw new HttpError(502, "Resposta do token sem access_token.");
  const novoRefresh = t.refresh_token as string | undefined;
  if (novoRefresh && novoRefresh !== refresh) {
    await guardarNaBase(CHAVE_OAUTH, { refresh_token: novoRefresh, atualizado_em: new Date().toISOString() });
  }
  const ttl = typeof t.expires_in === "number" ? t.expires_in : 3600;
  tokenCache = { token: at, expiresAt: agora + Math.max(ttl - 60, 30) * 1000 };
  return at;
}

const tocGet = (path: string, token: string) =>
  fetch(apiBase() + path, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });

async function resolverPath(recurso: string, token: string): Promise<string> {
  if (pathCache[recurso]) return pathCache[recurso];
  const cfg = RECURSOS[recurso];
  let ultimo = 0;
  for (const p of cfg.paths) {
    const r = await tocGet(p + (cfg.query ? "?" + cfg.query : ""), token);
    if (r.ok) { pathCache[recurso] = p; return p; }
    ultimo = r.status;
    if (r.status === 401 || r.status === 403) break;
  }
  throw new HttpError(ultimo === 401 || ultimo === 403 ? 502 : 404,
    `Nenhum endpoint de '${recurso}' respondeu em ${apiBase()} (ultimo HTTP ${ultimo}). Verificar TOC_API_BASE.`);
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

async function buscarTudo(recurso: string, token: string): Promise<unknown[]> {
  const cfg = RECURSOS[recurso];
  const path = await resolverPath(recurso, token);
  const todos: unknown[] = [];
  for (let pagina = 1; pagina <= MAX_PAGES; pagina++) {
    const qs = [cfg.query, `page[size]=${PAGE_SIZE}`, `page[number]=${pagina}`].filter(Boolean).join("&");
    const res = await tocGet(`${path}?${qs}`, token);
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

// ── Clientes com relationships (JSON:API `include`) ───────────────────────
// O /api/customers devolve morada, email principal e condicoes de pagamento
// apenas como referencias (`relationships` -> so o id). Os dados so vem se se
// pedir `include`, e o TOConline devolve-os na seccao `included`.
//
// A sintaxe exacta nao esta documentada, por isso tentam-se varias por ordem
// e fica registado qual respondeu — a resposta real e que decide, nao um
// palpite. Se nenhuma funcionar, recolhe-se sem include, como antes: e sempre
// preferivel um snapshot mais pobre do que nenhum snapshot.
const INCLUDES = [
  "main_address,main_email_address,defaults",
  "main_address,main_email_address",
  "addresses,email_addresses,defaults",
  "main_address",
  "",
];

async function buscarClientes(token: string) {
  const path = await resolverPath("customers", token);
  const tentativas: string[] = [];
  let escolhido = "";
  for (const inc of INCLUDES) {
    const qs = (inc ? `include=${encodeURIComponent(inc)}&` : "") + "page[size]=1&page[number]=1";
    const r = await tocGet(`${path}?${qs}`, token);
    tentativas.push(`${inc || "(sem include)"} -> HTTP ${r.status}`);
    if (r.ok) { escolhido = inc; break; }
  }

  const data: unknown[] = [];
  const included: unknown[] = [];
  const vistos = new Set<string>();
  for (let pagina = 1; pagina <= MAX_PAGES; pagina++) {
    const qs = (escolhido ? `include=${encodeURIComponent(escolhido)}&` : "") +
      `page[size]=${PAGE_SIZE}&page[number]=${pagina}`;
    const res = await tocGet(`${path}?${qs}`, token);
    if (!res.ok) {
      if (pagina === 1) throw new HttpError(502, `TOConline devolveu HTTP ${res.status} em ${path}`);
      break;
    }
    let payload: Record<string, unknown>;
    try { payload = await res.json(); } catch { break; }
    const lote = extrairLista(payload);
    if (!lote.length) break;
    data.push(...lote);
    // O `included` repete-se entre paginas; guarda-se cada recurso uma so vez.
    for (const r of (Array.isArray(payload.included) ? payload.included : [])) {
      const o = r as Record<string, unknown>;
      const k = `${o.type}:${o.id}`;
      if (!vistos.has(k)) { vistos.add(k); included.push(o); }
    }
    if (lote.length < PAGE_SIZE) break;
  }
  return { data, included, include: escolhido, tentativas, path };
}

// ── Documentos comerciais (faturas/notas/recibos), paginacao completa ──────
// Usada SO pela auditoria financeira (resource=finance_audit). Os endpoints
// diretos (resource=invoices/credit_notes/receipts) e o snapshot do callback
// continuam a usar buscarTudo()/MAX_PAGES, tal como antes — nada aqui muda o
// comportamento existente.
//
// Duas seguranças em vez de um numero fixo de paginas:
//  1. Para de paginar quando uma pagina vem mais curta que PAGE_SIZE (fim
//     real dos dados) — igual ao buscarTudo().
//  2. Um orcamento de tempo por recurso (prazoMs): se for excedido, para e
//     marca parcial=true em vez de continuar as cegas ou rebentar no limite
//     de execucao da function. TETO_PAGINAS e so uma rede de seguranca
//     contra loop infinito (nao e um limite de negocio).
//
// Eficiencia (02/09, corrida real com 6086 faturas deu WORKER_RESOURCE_LIMIT):
// cada documento bruto do TOConline traz ~80 campos, muitos deles pesados
// (document_hash_sum em base64, series de campos nulos, etc.) — reter os
// 6086 objectos brutos ate ao fim da paginacao para so entao achatar era o
// pico de memoria. Agora achata-se pagina a pagina (achatarDocumento, ja
// definida mais abaixo — function declaration, hoisted) e so o resultado
// magro (~12 campos) fica em memoria; o payload bruto de cada pagina sai de
// scope e fica livre para recolha assim que a iteracao termina.
const DOC_INCLUDES = ["user", "issuer", "current_company_users", ""];

async function buscarDocumentosCompletos(
  recurso: "invoices" | "credit_notes" | "receipts",
  token: string,
  prazoMs: number,
): Promise<{ data: DocAchatado[]; included: Record<string, unknown>[]; include: string; paginas: number; parcial: boolean; tentativas: string[] }> {
  const cfg = RECURSOS[recurso];
  const path = await resolverPath(recurso, token);
  const tentativas: string[] = [];
  let escolhido = "";
  // Recibos: sem tentativa de include (relacao com o emissor interessa-nos
  // em faturas/notas; se os recibos tambem a tiverem, fica para depois).
  const candidatos = recurso === "receipts" ? [""] : DOC_INCLUDES;
  for (const inc of candidatos) {
    const qs = [cfg.query, inc ? `include=${encodeURIComponent(inc)}` : "", "page[size]=1", "page[number]=1"]
      .filter(Boolean).join("&");
    const r = await tocGet(`${path}?${qs}`, token);
    tentativas.push(`${inc || "(sem include)"} -> HTTP ${r.status}`);
    if (r.ok) { escolhido = inc; break; }
  }

  const data: DocAchatado[] = [];
  const included: Record<string, unknown>[] = [];
  const vistos = new Set<string>();
  const inicio = Date.now();
  let pagina = 1;
  let parcial = false;
  const TETO_PAGINAS = 3000;
  for (; pagina <= TETO_PAGINAS; pagina++) {
    if (Date.now() - inicio > prazoMs) { parcial = true; break; }
    const qs = [cfg.query, escolhido ? `include=${encodeURIComponent(escolhido)}` : "", `page[size]=${PAGE_SIZE}`, `page[number]=${pagina}`]
      .filter(Boolean).join("&");
    const res = await tocGet(`${path}?${qs}`, token);
    if (!res.ok) {
      if (pagina === 1) throw new HttpError(502, `TOConline devolveu HTTP ${res.status} em ${path}`);
      break;
    }
    let payload: Record<string, unknown>;
    try { payload = await res.json(); } catch { break; }
    const lote = extrairLista(payload);
    if (!lote.length) break;
    for (const doc of lote as Record<string, unknown>[]) data.push(achatarDocumento(doc));
    for (const r of (Array.isArray(payload.included) ? payload.included : [])) {
      const o = r as Record<string, unknown>;
      const k = `${o.type}:${o.id}`;
      if (!vistos.has(k)) { vistos.add(k); included.push(o); }
    }
    if (lote.length < PAGE_SIZE) break;
    // `payload`/`lote` saem de scope aqui — nada retem os campos brutos.
  }
  return { data, included, include: escolhido, paginas: pagina, parcial, tentativas };
}

/** Diagnóstico: só metadados e códigos de estado. Nunca dados, nunca tokens. */
async function diagnostico(tokenJaObtido?: string) {
  const out: Record<string, unknown> = {
    api_base: apiBase(),
    oauth_url: oauthUrl() + "/token",
    grant_type: "refresh_token",
    scope: SCOPE,
    secrets: {
      TOC_CLIENT_ID: Deno.env.get("TOC_CLIENT_ID") ? "definido" : "EM FALTA",
      TOC_CLIENT_SECRET: Deno.env.get("TOC_CLIENT_SECRET") ? "definido" : "EM FALTA",
      TOC_GATEWAY_KEY: Deno.env.get("TOC_GATEWAY_KEY") ? "definido" : "EM FALTA",
      TOC_REFRESH_TOKEN: Deno.env.get("TOC_REFRESH_TOKEN") ? "definido" : "nao definido",
      TOC_API_BASE: Deno.env.get("TOC_API_BASE") ? "definido" : "a usar default",
      TOC_OAUTH_URL: Deno.env.get("TOC_OAUTH_URL") ? "definido" : "a usar default",
    },
  };
  let token: string;
  try {
    token = tokenJaObtido ?? await getAccessToken();
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
        const r = await tocGet(p + (cfg.query ? "?" + cfg.query : ""), token);
        linhas.push(`${p} -> HTTP ${r.status}`);
        if (r.ok) break;
      } catch { linhas.push(`${p} -> erro de rede`); }
    }
    endpoints[recurso] = linhas.join(" | ");
  }
  out.endpoints = endpoints;
  return out;
}

// ══ SINCRONIZACAO TOCONLINE -> CLIENTES ═══════════════════════════════════
// Regras, todas deliberadas e todas testadas no dry-run de 02/09:
//  · Prioridade de correspondencia: tocId -> NIF exacto -> nome + confirmacao
//    forte (telefone ou email coincidente). Nunca so pelo nome.
//  · 999999990 ("Consumidor Final") NAO e identidade: excluido dos dois lados.
//    Sem isto, quatro registos do TOConline colavam-se ao mesmo cliente.
//  · Correcao de 02/09: o excluido-dos-dois-lados era so o ramo de match por
//    NIF — o registo ainda seguia para o match por nome e acabava contado em
//    "novos" ou "ambiguos". Agora fica de fora logo no topo do ciclo: nunca
//    conta como novo elegivel, nunca e criado, nunca entra em match/fusao
//    por nenhum criterio. Fica so na sua propria lista "bloqueados", para
//    auditoria.
//  · So se escreve em campo VAZIO. Campo ja preenchido e diferente = conflito,
//    contado e mostrado, nunca sobrescrito.
//  · Emails @opportunitybox.pt sao do comercial, nao do cliente: bloqueados.
//  · Prazo so nos seis valores da lista; qualquer outro fica pendente.
//  · Nunca cria clientes. Nunca apaga clientes. Nunca toca em comercialResp,
//    receita, projectos ou historico.
// Idempotente por construcao: a segunda passagem nao encontra campos vazios
// para preencher, logo devolve 0 actualizados.

const PRAZOS: Record<string, string> = {
  "0": "Imediato", "15": "15 dias", "30": "30 dias",
  "45": "45 dias", "60": "60 dias", "90": "90 dias",
};
const NIF_GENERICO = "999999990";
const VAZIOS = ["", "none", "null", "n/a", "na", "#n/a", "-"];

const val = (x: unknown): string => {
  const t = String(x ?? "").trim();
  return VAZIOS.indexOf(t.toLowerCase()) >= 0 ? "" : t;
};
const vazio = (x: unknown) => val(x) === "";
const digitos = (x: unknown) => val(x).replace(/\D/g, "");
const nifNorm = (x: unknown) => { const d = digitos(x); return d.length === 9 ? d : ""; };
const telNorm = (x: unknown) => {
  let d = digitos(x);
  if (d.startsWith("00351")) d = d.slice(5);
  if (d.length === 12 && d.startsWith("351")) d = d.slice(3);
  return d.length >= 9 ? d : "";
};
const semAcento = (x: unknown) =>
  val(x).toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const chaveTexto = (x: unknown) => semAcento(x).replace(/[^A-Z0-9]/g, "");
const nomeNorm = (x: unknown) => semAcento(x)
  .replace(/[^A-Z0-9 ]/g, " ")
  .replace(/\b(LDA|LIMITADA|UNIPESSOAL|SGPS|SA|EIRELI|MEI|ME|CRL|ACE|EM|SU)\b/g, " ")
  .replace(/\s+/g, " ").trim();
const cpNorm = (x: unknown) => {
  const d = digitos(x);
  return d.length === 7 ? `${d.slice(0, 4)}-${d.slice(4)}` : val(x);
};

type Cli = Record<string, unknown>;

async function sincronizarClientes(seco: boolean, via: string) {
  const inicio = Date.now();
  const token = await getAccessToken();
  const rec = await buscarClientes(token);

  const idx: Record<string, Record<string, unknown>> = {};
  for (const r of rec.included as Record<string, unknown>[]) idx[`${r.type}:${r.id}`] = r;
  const rel = (c: Record<string, unknown>, nome: string, campo: string) => {
    const d = ((c.relationships as Record<string, Record<string, Record<string, unknown>>>)?.[nome]?.data);
    if (!d?.id) return "";
    const r = idx[`${d.type}:${d.id}`];
    return val((r?.attributes as Record<string, unknown>)?.[campo]);
  };

  // Lado TOConline, achatado
  const toc = (rec.data as Record<string, unknown>[]).map((c) => {
    const a = (c.attributes ?? {}) as Record<string, unknown>;
    return {
      id: String(c.id), nome: val(a.business_name), nif: nifNorm(a.tax_registration_number),
      tel: val(a.phone_number), tlm: val(a.mobile_number), contacto: val(a.contact_name),
      email: rel(c, "main_email_address", "email"),
      morada: rel(c, "main_address", "address_detail"),
      cp: rel(c, "main_address", "postcode"), loc: rel(c, "main_address", "city"),
      due: rel(c, "defaults", "due_days"),
    };
  });

  const clientes = (await lerDaBase(CHAVE_CLIENTES)) as Cli[] | null;
  if (!Array.isArray(clientes)) throw new HttpError(500, "Nao foi possivel ler ob-clients.");

  const conta = <T>(xs: T[], k: (x: T) => string) => {
    const m: Record<string, number> = {};
    for (const x of xs) { const v = k(x); if (v) m[v] = (m[v] ?? 0) + 1; }
    return m;
  };
  const nifToc = conta(toc, (t) => t.nif);
  const nifCrm = conta(clientes, (c) => nifNorm(c.nif));
  const nomeToc = conta(toc, (t) => nomeNorm(t.nome));
  const porTocId: Record<string, Cli[]> = {};
  const porNif: Record<string, Cli[]> = {};
  const porNome: Record<string, Cli[]> = {};
  for (const c of clientes) {
    if (val(c.tocId)) (porTocId[val(c.tocId)] ??= []).push(c);
    const n = nifNorm(c.nif); if (n) (porNif[n] ??= []).push(c);
    const nm = nomeNorm(c.n); if (nm) (porNome[nm] ??= []).push(c);
  }

  let encontrados = 0, atualizados = 0, campos = 0;
  const conflitos: unknown[] = [], ambiguos: unknown[] = [], semMatch: unknown[] = [];
  const bloqueados: unknown[] = [];
  const exemplos: unknown[] = [];
  const casados = new Set<string>();

  for (const t of toc) {
    // NIF 999999990 ("Consumidor Final") e um placeholder generico do TOConline,
    // nao uma identidade de cliente — varios registos diferentes usam-no. Fica
    // de fora de tudo: nao conta como "novo" elegivel, nunca e criado, nunca
    // entra em match/fusao (nem por NIF nem por nome). So aparece na sua propria
    // lista de bloqueados, para auditoria.
    if (t.nif === NIF_GENERICO || nomeNorm(t.nome) === "CONSUMIDOR FINAL") {
      bloqueados.push({ toc_id: t.id, nome: t.nome, motivo: "NIF genérico (999999990) / Consumidor Final — placeholder, não é identidade de cliente" });
      continue;
    }
    let alvo: Cli | null = null, criterio = "", jaExplicado = false;
    const cands = (xs?: Cli[]) => (xs && xs.length === 1 ? xs[0] : null);

    if (porTocId[t.id]) { alvo = cands(porTocId[t.id]); criterio = "tocId"; }
    if (!alvo && t.nif && t.nif !== NIF_GENERICO && nifToc[t.nif] === 1 && nifCrm[t.nif] === 1) {
      alvo = cands(porNif[t.nif]); criterio = "NIF";
    }
    if (!alvo) {
      const nm = nomeNorm(t.nome);
      const c = nm && nomeToc[nm] === 1 ? cands(porNome[nm]) : null;
      if (c) {
        const nifC = nifNorm(c.nif);
        const telsT = [telNorm(t.tel), telNorm(t.tlm)].filter(Boolean);
        const confirma = telsT.indexOf(telNorm(c.tel)) >= 0 ||
          (!!chaveTexto(c.email) && chaveTexto(c.email) === chaveTexto(t.email));
        if (nifC && t.nif && nifC !== t.nif) {
          ambiguos.push({ toc_id: t.id, nome: t.nome, motivo: "nome igual, NIF diferente" }); jaExplicado = true;
        } else if (confirma) { alvo = c; criterio = "nome+confirmacao"; }
        else { ambiguos.push({ toc_id: t.id, nome: t.nome, motivo: "so o nome coincide, sem confirmacao" }); jaExplicado = true; }
      } else if (nm && (porNome[nm]?.length ?? 0) > 1) {
        ambiguos.push({ toc_id: t.id, nome: t.nome, motivo: "nome corresponde a varios clientes" }); jaExplicado = true;
      }
    }
    // "Novos" e "ambiguos" tem de ser conjuntos disjuntos: um registo retido
    // por duvida NAO e um cliente novo, e conta-lo nas duas colunas fazia o
    // painel prometer mais clientes novos do que existem.
    if (!alvo) {
      if (!jaExplicado) semMatch.push({ toc_id: t.id, nome: t.nome, nif: t.nif });
      continue;
    }
    if (casados.has(String(alvo.id))) {
      ambiguos.push({ toc_id: t.id, nome: t.nome, motivo: "cliente ja casado com outro registo TOConline" });
      continue;
    }
    casados.add(String(alvo.id)); encontrados++;

    const antes: Record<string, string> = {}, depois: Record<string, string> = {};
    const preencher = (campo: string, novo: string, atualBruto: unknown) => {
      if (!novo) return;
      const atual = val(atualBruto);
      if (!atual) { antes[campo] = ""; depois[campo] = novo; }
      else if (chaveTexto(novo) !== chaveTexto(atual)) {
        conflitos.push({ cliente: alvo!.id, nome: alvo!.n, campo, crm: atual, toc: novo });
      }
    };
    if (vazio(alvo.tocId)) { antes.tocId = ""; depois.tocId = t.id; }
    preencher("tel", val(t.tel) || val(t.tlm), alvo.tel);
    if (t.email && !/opportunitybox/i.test(t.email)) preencher("email", t.email, alvo.email);
    preencher("cont", t.contacto, alvo.cont);
    preencher("cp", cpNorm(t.cp), cpNorm(alvo.cp));
    preencher("localidade", t.loc, alvo.localidade);
    const pz = PRAZOS[digitos(t.due)] ?? (val(t.due) ? "" : "");
    if (pz) preencher("prazo", pz, alvo.prazo);

    const chaves = Object.keys(depois);
    if (chaves.length) {
      atualizados++; campos += chaves.length;
      if (!seco) for (const k of chaves) alvo[k] = depois[k];
      if (exemplos.length < 20) exemplos.push({ cliente: alvo.id, nome: alvo.n, antes, depois, criterio });
    }
  }

  let gravou = false;
  if (!seco && atualizados > 0) gravou = await guardarNaBase(CHAVE_CLIENTES, clientes);

  const estado = {
    ts: new Date().toISOString(), status: seco ? "simulado" : (atualizados === 0 ? "sem alteracoes" : (gravou ? "ok" : "falha ao gravar")),
    via, duracao_ms: Date.now() - inicio, include: rec.include,
    clientes_toconline: toc.length, clientes_crm: clientes.length,
    encontrados, atualizados, campos_preenchidos: campos,
    novos: semMatch.length, conflitos: conflitos.length, ambiguos: ambiguos.length,
    bloqueados: bloqueados.length,
    lista_novos: semMatch.slice(0, 200), lista_conflitos: conflitos.slice(0, 200),
    lista_ambiguos: ambiguos.slice(0, 200), lista_bloqueados: bloqueados.slice(0, 200), exemplos,
  };
  if (!seco) await guardarNaBase(CHAVE_SYNC, estado);
  return estado;
}

// ══ FASE C — AUDITORIA FINANCEIRA (SOMENTE LEITURA, resource=finance_audit) ═
// Objetivo: dry-run com dados reais do TOConline, para decidir depois como
// alimentar Financeiro/CFO/Historico/Ranking. Nao escreve em ob-tes-receber,
// ob_orcamentos, ob-clients, nem em nada usado por essas paginas — so lê
// ob-tes-receber (para comparar) e persiste o proprio relatorio numa chave
// nova (CHAVE_FINANCE_AUDIT). Nao cria, nao emite, nao anula, nao cancela
// nada no TOConline: e so GET.
//
// "user" em relationships de uma fatura/nota e o utilizador da CONTA
// TOConline que emitiu o documento — NAO se assume que seja o comercial de
// campo. So se marca `vendedor_confirmado` quando o nome/email devolvido
// pelo `included` bate, apos normalizacao, com um dos 4 nomes conhecidos.
// Caso contrario fica exatamente como pedido: "VENDEDOR NÃO CONFIRMADO — NÃO
// USAR NO RANKING".
const VENDEDOR_NAO_CONFIRMADO = "VENDEDOR NÃO CONFIRMADO — NÃO USAR NO RANKING";
const NOMES_COMERCIAIS_CONHECIDOS = ["Paulo Faria", "Rui Mota", "Humberto Estrelinha", "André Nolasco"];

function achatarDocumento(c: Record<string, unknown>) {
  const a = (c.attributes ?? {}) as Record<string, unknown>;
  const rel = (c.relationships ?? {}) as Record<string, { data?: { id?: string; type?: string } }>;
  const userRel = rel.user?.data;
  const num = (x: unknown) => (typeof x === "number" ? x : parseFloat(String(x ?? "")) || 0);
  return {
    id: String(c.id), document_no: val(a.document_no), document_type: val(a.document_type),
    date: val(a.date), due_date: val(a.due_date),
    net_total: num(a.net_total), gross_total: num(a.gross_total), tax_payable: num(a.tax_payable),
    pending_total: num(a.pending_total),
    receipts_ids: Array.isArray(a.receipts_ids) ? a.receipts_ids as unknown[] : [],
    customer_business_name: val(a.customer_business_name),
    customer_tax_registration_number: val(a.customer_tax_registration_number),
    voided_reason: val(a.voided_reason), status_bruto: a.status ?? null,
    user_id: userRel?.id ? String(userRel.id) : "", user_type: userRel?.type ? String(userRel.type) : "",
  };
}
type DocAchatado = ReturnType<typeof achatarDocumento>;

async function auditoriaFinanceira(parte: string): Promise<Record<string, unknown>> {
  const inicio = Date.now();
  const token = await getAccessToken();
  const ORCAMENTO_TOTAL_MS = 100000; // rede de seguranca global (<< limite de execucao da function)
  const PRAZO_POR_RECURSO_MS = 40000;

  const todasPartes: ("invoices" | "credit_notes" | "receipts")[] = ["invoices", "credit_notes", "receipts"];
  const partes = todasPartes.includes(parte as "invoices") ? [parte as "invoices"] : todasPartes;

  const brutos: Record<string, DocAchatado[]> = { invoices: [], credit_notes: [], receipts: [] };
  const includedTodos: Record<string, unknown>[] = [];
  const paginasPorRecurso: Record<string, number> = {};
  const parcialPorRecurso: Record<string, boolean> = {};
  const tentativasPorRecurso: Record<string, string[]> = {};

  for (const r of partes) {
    const restante = ORCAMENTO_TOTAL_MS - (Date.now() - inicio);
    if (restante < 5000) { parcialPorRecurso[r] = true; tentativasPorRecurso[r] = ["ignorado: orcamento de tempo global esgotado"]; continue; }
    const { data, included, paginas, parcial, tentativas } = await buscarDocumentosCompletos(r, token, Math.min(PRAZO_POR_RECURSO_MS, restante));
    brutos[r] = data; // ja vem achatado pagina a pagina (ver buscarDocumentosCompletos)
    includedTodos.push(...included);
    paginasPorRecurso[r] = paginas;
    parcialPorRecurso[r] = parcial;
    tentativasPorRecurso[r] = tentativas;
  }
  const paginacaoCompleta = partes.every((r) => !parcialPorRecurso[r]);

  // ── Utilizadores TOConline associados a documentos (faturas + notas) ─────
  const usersMapa: Record<string, { id: string; type: string; atributos: Record<string, unknown>; freq: number }> = {};
  for (const grupo of ["invoices", "credit_notes"] as const) {
    for (const d of brutos[grupo]) {
      if (!d.user_id) continue;
      const k = `${d.user_type}:${d.user_id}`;
      if (!usersMapa[k]) {
        const inc = includedTodos.find((x) => (x as Record<string, unknown>).type === d.user_type && String((x as Record<string, unknown>).id) === d.user_id);
        usersMapa[k] = { id: d.user_id, type: d.user_type, atributos: ((inc as Record<string, unknown>)?.attributes as Record<string, unknown>) ?? {}, freq: 0 };
      }
      usersMapa[k].freq++;
    }
  }
  const usersLista = Object.values(usersMapa).map((u) => {
    const at = u.atributos as Record<string, unknown>;
    const nomeBruto = val(at.name) || val(at.full_name) || val(at.email) || "";
    const match = NOMES_COMERCIAIS_CONHECIDOS.find((n) => nomeNorm(n) === nomeNorm(nomeBruto));
    return { ...u, nome_bruto: nomeBruto || "(sem atributos legíveis no included)", correspondencia: match ?? VENDEDOR_NAO_CONFIRMADO };
  }).sort((a, b) => b.freq - a.freq);
  const vendedorPorUserId: Record<string, string> = {};
  for (const u of usersLista) vendedorPorUserId[u.id] = u.correspondencia === VENDEDOR_NAO_CONFIRMADO ? "" : u.correspondencia;

  // ── Totais e classificacao de estado (heuristica, documentada — nao vem do TOConline) ─
  const hojeISO = new Date().toISOString().slice(0, 10);
  const somar = (grupo: DocAchatado[]) => {
    const ac = { net: 0, iva: 0, gross: 0, liquidadas: 0, emAberto: 0, vencidas: 0, parciais: 0, anuladas: 0, recebido: 0, aReceber: 0, vencidoValor: 0 };
    for (const d of grupo) {
      if (d.voided_reason) { ac.anuladas++; continue; }
      ac.net += d.net_total; ac.iva += d.tax_payable; ac.gross += d.gross_total;
      ac.recebido += (d.gross_total - d.pending_total); ac.aReceber += d.pending_total;
      if (d.pending_total <= 0.005) ac.liquidadas++;
      else if (d.pending_total >= d.gross_total - 0.005) {
        if (d.due_date && d.due_date < hojeISO) { ac.vencidas++; ac.vencidoValor += d.pending_total; } else ac.emAberto++;
      } else {
        ac.parciais++;
        if (d.due_date && d.due_date < hojeISO) ac.vencidoValor += d.pending_total;
      }
    }
    return ac;
  };
  const totaisFaturas = somar(brutos.invoices);
  const totaisNotas = somar(brutos.credit_notes);

  const datas = [...brutos.invoices, ...brutos.credit_notes].map((d) => d.date).filter(Boolean).sort();
  const periodoCoberto = { desde: datas[0] ?? null, ate: datas[datas.length - 1] ?? null };

  const duplicadosToconline = (grupo: DocAchatado[]) => grupo.length - new Set(grupo.map((d) => d.id)).size;

  // ── Match heuristico com ob-tes-receber (SO LEITURA — nunca escreve la) ──
  // ob-tes-receber grava datas como texto "DD/MM/AAAA" (import da Sheet); o
  // TOConline devolve "date" em ISO "AAAA-MM-DD". Comparar as duas strings
  // directamente (alfabeticamente) dava sempre falso e descartava as 474
  // linhas como "fora do periodo" mesmo quando estavam dentro — por isso a
  // normalizacao para ISO antes de qualquer comparacao de data.
  const dataParaISO = (x: unknown): string => {
    const t = val(x);
    if (!t) return "";
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
    return "";
  };
  const tes = (await lerDaBase(CHAVE_TES_RECEBER)) as Record<string, unknown>[] | null;
  const tesRows = Array.isArray(tes) ? tes : [];
  const dentroDoPeriodo = (dataISO: string) => !periodoCoberto.desde || !dataISO || (dataISO >= periodoCoberto.desde && dataISO <= periodoCoberto.ate!);
  const candidatosMatch = [...brutos.invoices, ...brutos.credit_notes];
  const semMatch: unknown[] = [], divergenciasValor: unknown[] = [], divergenciasStatus: unknown[] = [];
  let comMatch = 0;
  for (const linha of tesRows) {
    const dataLinha = val((linha as Record<string, unknown>).dataEmissao) || val((linha as Record<string, unknown>).data);
    if (!dentroDoPeriodo(dataParaISO(dataLinha))) continue; // fora do periodo que a auditoria conseguiu cobrir — nao e "sem match", e "nao auditado"
    const nomeLinha = nomeNorm((linha as Record<string, unknown>).cliente);
    const valorLinha = num((linha as Record<string, unknown>).total ?? (linha as Record<string, unknown>).valorRecebido);
    const cands = candidatosMatch.filter((d) => nomeNorm(d.customer_business_name) === nomeLinha);
    if (!cands.length) { semMatch.push({ id: (linha as Record<string, unknown>).id, cliente: (linha as Record<string, unknown>).cliente, data: dataLinha, total: valorLinha }); continue; }
    const porValor = cands.find((d) => Math.abs(d.gross_total - valorLinha) < 0.5);
    if (!porValor) {
      divergenciasValor.push({ id: (linha as Record<string, unknown>).id, cliente: (linha as Record<string, unknown>).cliente, crm_total: valorLinha, toconline_candidatos: cands.map((d) => d.gross_total) });
      continue;
    }
    comMatch++;
    const estadoLinha = val((linha as Record<string, unknown>).estado);
    const liquidadoToc = porValor.pending_total <= 0.005 && !porValor.voided_reason;
    const estadoBate = (estadoLinha === "Recebido" && liquidadoToc) || (estadoLinha !== "Recebido" && !liquidadoToc);
    if (!estadoBate) divergenciasStatus.push({ id: (linha as Record<string, unknown>).id, cliente: (linha as Record<string, unknown>).cliente, crm_estado: estadoLinha, toconline_pending_total: porValor.pending_total, toconline_document_no: porValor.document_no });
  }
  function num(x: unknown): number { return typeof x === "number" ? x : parseFloat(String(x ?? "")) || 0; }

  const relatorio = {
    ts: new Date().toISOString(), parte: partes.join(","), duracao_ms: Date.now() - inicio,
    paginacao_completa: paginacaoCompleta, paginas_por_recurso: paginasPorRecurso, parcial_por_recurso: parcialPorRecurso,
    contagens: { invoices: brutos.invoices.length, credit_notes: brutos.credit_notes.length, receipts: brutos.receipts.length },
    periodo_coberto: periodoCoberto,
    totais_faturas: totaisFaturas, totais_notas_credito: totaisNotas,
    duplicados_toconline: { invoices: duplicadosToconline(brutos.invoices), credit_notes: duplicadosToconline(brutos.credit_notes), receipts: duplicadosToconline(brutos.receipts) },
    users_toconline: usersLista,
    vendedores_confirmados: usersLista.filter((u) => u.correspondencia !== VENDEDOR_NAO_CONFIRMADO).length,
    documentos_sem_vendedor_confirmado: [...brutos.invoices, ...brutos.credit_notes].filter((d) => !d.user_id || !vendedorPorUserId[d.user_id]).length,
    match_tes_receber: { total_tes_no_periodo: comMatch + semMatch.length + divergenciasValor.length, com_match: comMatch, sem_match: semMatch.length, divergencias_valor: divergenciasValor.length, divergencias_status: divergenciasStatus.length },
    amostra_sem_match: semMatch.slice(0, 50), amostra_divergencias_valor: divergenciasValor.slice(0, 50), amostra_divergencias_status: divergenciasStatus.slice(0, 50),
    amostra_documentos: { invoices: brutos.invoices.slice(0, 50), credit_notes: brutos.credit_notes.slice(0, 50), receipts: brutos.receipts.slice(0, 50) },
    tentativas_include: tentativasPorRecurso,
    nota: "SOMENTE LEITURA: nenhum dado foi escrito em ob-tes-receber, ob_orcamentos ou ob-clients. 'status_bruto' e o codigo numerico do TOConline, ainda nao documentado — a classificacao liquidada/em_aberto/vencida/parcial e heuristica, baseada em pending_total e due_date.",
  };
  // Cada corrida grava na sua propria chave (nunca pisa uma corrida anterior
  // de outra "parte"); a corrida "tudo" tambem grava na chave simples, para
  // ser a leitura por omissao.
  await guardarNaBase(`${CHAVE_FINANCE_AUDIT}-${partes.join("-")}`, relatorio);
  if (partes.length === todasPartes.length) await guardarNaBase(CHAVE_FINANCE_AUDIT, relatorio);
  return relatorio;
}

// ══ FASE C — FATURAS EM LOTES, COM CHECKPOINT (SOMENTE LEITURA) ════════════
// auditoriaFinanceira("invoices") busca as 6086 faturas de uma vez so numa
// chamada — e isso rebentou com HTTP 546 WORKER_RESOURCE_LIMIT (03/09). Este
// modo processa um numero limitado de paginas do TOConline por chamada HTTP
// e persiste um checkpoint (CHAVE_INVOICES_CKPT) com SO os acumuladores
// (totais, periodo, utilizadores, TES ja resolvidos, amostra de ate 50
// documentos) — nunca a colecao completa de faturas. A chamada seguinte
// (mesmo resource=finance_audit&parte=invoices) le o checkpoint e continua
// de "next_page" em diante. So GET ao TOConline, so leitura de
// ob-tes-receber; escreve so no checkpoint e, na ultima pagina, no relatorio
// final toc-finance-audit-invoices (a mesma chave de sempre). Nao consulta
// credit_notes nem receipts nesta corrida — usar os relatorios ja existentes
// para essas partes. Nunca toca em Financeiro/Ranking/Historico/CFO/
// ob-tes-receber/ob_orcamentos.
const CHAVE_INVOICES_CKPT = "toc-finance-audit-invoices-checkpoint";
const PAGINAS_POR_LOTE_DEFAULT = 15;

type TotaisAc = { net: number; iva: number; gross: number; liquidadas: number; emAberto: number; vencidas: number; parciais: number; anuladas: number; recebido: number; aReceber: number; vencidoValor: number };
const totaisVazios = (): TotaisAc => ({ net: 0, iva: 0, gross: 0, liquidadas: 0, emAberto: 0, vencidas: 0, parciais: 0, anuladas: 0, recebido: 0, aReceber: 0, vencidoValor: 0 });
function somarUm(ac: TotaisAc, d: DocAchatado, hojeISO: string) {
  if (d.voided_reason) { ac.anuladas++; return; }
  ac.net += d.net_total; ac.iva += d.tax_payable; ac.gross += d.gross_total;
  ac.recebido += (d.gross_total - d.pending_total); ac.aReceber += d.pending_total;
  if (d.pending_total <= 0.005) ac.liquidadas++;
  else if (d.pending_total >= d.gross_total - 0.005) {
    if (d.due_date && d.due_date < hojeISO) { ac.vencidas++; ac.vencidoValor += d.pending_total; } else ac.emAberto++;
  } else {
    ac.parciais++;
    if (d.due_date && d.due_date < hojeISO) ac.vencidoValor += d.pending_total;
  }
}

interface CheckpointFaturas {
  next_page: number;
  paginas_processadas: number;
  ids_vistos: string[];
  contagem: number;
  totais: TotaisAc;
  periodo: { desde: string | null; ate: string | null };
  include_escolhido: string;
  tentativas_include: string[];
  users_mapa: Record<string, { type: string; atributos: Record<string, unknown>; freq: number }>;
  tes_resolvido: Record<string, { tipo: "match" | "divergencia_valor" | "divergencia_status"; detalhe: Record<string, unknown> }>;
  amostra_documentos: DocAchatado[];
  iniciado_em: string;
}

async function auditoriaFaturasLote(paginasPorChamada: number, reiniciar: boolean): Promise<Record<string, unknown>> {
  const inicioChamada = Date.now();
  const token = await getAccessToken();
  const hojeISO = new Date().toISOString().slice(0, 10);
  const numGenerico = (x: unknown): number => (typeof x === "number" ? x : parseFloat(String(x ?? "")) || 0);

  let ckpt = reiniciar ? null : (await lerDaBase(CHAVE_INVOICES_CKPT)) as CheckpointFaturas | null;

  const path = await resolverPath("invoices", token);
  const cfg = RECURSOS["invoices"];

  let escolhido = ckpt?.include_escolhido ?? "";
  const tentativasInclude = ckpt?.tentativas_include ?? [];
  if (!ckpt) {
    for (const inc of DOC_INCLUDES) {
      const qs = [cfg.query, inc ? `include=${encodeURIComponent(inc)}` : "", "page[size]=1", "page[number]=1"].filter(Boolean).join("&");
      const r = await tocGet(`${path}?${qs}`, token);
      tentativasInclude.push(`${inc || "(sem include)"} -> HTTP ${r.status}`);
      if (r.ok) { escolhido = inc; break; }
    }
  }

  if (!ckpt) {
    ckpt = {
      next_page: 1, paginas_processadas: 0, ids_vistos: [], contagem: 0,
      totais: totaisVazios(), periodo: { desde: null, ate: null },
      include_escolhido: escolhido, tentativas_include: tentativasInclude,
      users_mapa: {}, tes_resolvido: {}, amostra_documentos: [],
      iniciado_em: new Date().toISOString(),
    };
  }

  const idsVistos = new Set(ckpt.ids_vistos);
  const usersMapa = ckpt.users_mapa;
  const tesResolvido = ckpt.tes_resolvido;
  const amostra = ckpt.amostra_documentos;
  const totais = ckpt.totais;
  let desde = ckpt.periodo.desde, ate = ckpt.periodo.ate;
  let duplicadosNesteLote = 0;

  const tes = (await lerDaBase(CHAVE_TES_RECEBER)) as Record<string, unknown>[] | null;
  const tesRows = Array.isArray(tes) ? tes : [];

  let paginasNesteLote = 0;
  let terminou = false;
  let paginaAtual = ckpt.next_page;

  for (; paginasNesteLote < paginasPorChamada; paginasNesteLote++) {
    const qs = [cfg.query, escolhido ? `include=${encodeURIComponent(escolhido)}` : "", `page[size]=${PAGE_SIZE}`, `page[number]=${paginaAtual}`]
      .filter(Boolean).join("&");
    const res = await tocGet(`${path}?${qs}`, token);
    if (!res.ok) {
      if (paginaAtual === 1 && ckpt.paginas_processadas === 0) throw new HttpError(502, `TOConline devolveu HTTP ${res.status} em ${path}`);
      terminou = true; break;
    }
    let payload: Record<string, unknown>;
    try { payload = await res.json(); } catch { terminou = true; break; }
    const lote = extrairLista(payload);
    if (!lote.length) { terminou = true; break; }

    const incluidosPagina: Record<string, unknown>[] = Array.isArray(payload.included)
      ? (payload.included as Record<string, unknown>[]) : [];

    const docsLote: DocAchatado[] = [];
    for (const docBruto of lote as Record<string, unknown>[]) {
      const d = achatarDocumento(docBruto);
      docsLote.push(d);
      if (idsVistos.has(d.id)) duplicadosNesteLote++; else idsVistos.add(d.id);
      somarUm(totais, d, hojeISO);
      if (d.date) {
        if (!desde || d.date < desde) desde = d.date;
        if (!ate || d.date > ate) ate = d.date;
      }
      if (d.user_id) {
        const k = `${d.user_type}:${d.user_id}`;
        if (!usersMapa[k]) {
          const inc = incluidosPagina.find((x) => x.type === d.user_type && String(x.id) === d.user_id);
          usersMapa[k] = { type: d.user_type, atributos: ((inc as Record<string, unknown>)?.attributes as Record<string, unknown>) ?? {}, freq: 0 };
        }
        usersMapa[k].freq++;
      }
      if (amostra.length < 50) amostra.push(d);
    }

    // Resolve TES ainda pendentes contra este lote (nome + valor, so faturas).
    // Um TES por resolver que nao aparece neste lote fica pendente para o
    // proximo — so e dado como "sem match" na ultima pagina.
    const porNomeLote: Record<string, DocAchatado[]> = {};
    for (const d of docsLote) {
      const nm = nomeNorm(d.customer_business_name);
      if (nm) (porNomeLote[nm] ??= []).push(d);
    }
    for (const linha of tesRows) {
      const idTes = String((linha as Record<string, unknown>).id ?? "");
      if (!idTes || tesResolvido[idTes]) continue;
      const nomeLinha = nomeNorm((linha as Record<string, unknown>).cliente);
      const cands = porNomeLote[nomeLinha];
      if (!cands || !cands.length) continue;
      const valorLinha = numGenerico((linha as Record<string, unknown>).total ?? (linha as Record<string, unknown>).valorRecebido);
      const porValor = cands.find((d) => Math.abs(d.gross_total - valorLinha) < 0.5);
      if (!porValor) {
        tesResolvido[idTes] = { tipo: "divergencia_valor", detalhe: { cliente: (linha as Record<string, unknown>).cliente as unknown as Record<string, unknown>, crm_total: valorLinha, toconline_candidatos: cands.map((d) => d.gross_total) } as unknown as Record<string, unknown> };
        continue;
      }
      const estadoLinha = val((linha as Record<string, unknown>).estado);
      const liquidadoToc = porValor.pending_total <= 0.005 && !porValor.voided_reason;
      const estadoBate = (estadoLinha === "Recebido" && liquidadoToc) || (estadoLinha !== "Recebido" && !liquidadoToc);
      tesResolvido[idTes] = estadoBate
        ? { tipo: "match", detalhe: { cliente: (linha as Record<string, unknown>).cliente, toconline_document_no: porValor.document_no } as unknown as Record<string, unknown> }
        : { tipo: "divergencia_status", detalhe: { cliente: (linha as Record<string, unknown>).cliente, crm_estado: estadoLinha, toconline_pending_total: porValor.pending_total, toconline_document_no: porValor.document_no } as unknown as Record<string, unknown> };
    }

    ckpt.paginas_processadas++;
    paginaAtual++;
    if (lote.length < PAGE_SIZE) { terminou = true; break; }
    if (Date.now() - inicioChamada > 90000) break; // orcamento de tempo por chamada, rede de seguranca
  }

  ckpt.next_page = paginaAtual;
  ckpt.contagem = idsVistos.size;
  ckpt.ids_vistos = [...idsVistos];
  ckpt.periodo = { desde, ate };
  ckpt.include_escolhido = escolhido;
  ckpt.tentativas_include = tentativasInclude;

  await guardarNaBase(CHAVE_INVOICES_CKPT, ckpt);

  if (!terminou) {
    return {
      concluido: false, paginacao_completa: false,
      next_page: ckpt.next_page, paginas_processadas: ckpt.paginas_processadas,
      contagem: ckpt.contagem, duplicados_neste_lote: duplicadosNesteLote,
      nota: "Lote gravado no checkpoint (toc-finance-audit-invoices-checkpoint). Chame de novo resource=finance_audit&parte=invoices para continuar.",
    };
  }

  // Ultima pagina: fecha os TES que nunca apareceram em nenhum lote como
  // "sem match" e consolida o relatorio final na mesma chave de sempre.
  let semMatch = 0, comMatch = 0, divValor = 0, divStatus = 0;
  const amostraSemMatch: unknown[] = [], amostraDivValor: unknown[] = [], amostraDivStatus: unknown[] = [];
  for (const linha of tesRows) {
    const idTes = String((linha as Record<string, unknown>).id ?? "");
    const r = idTes ? tesResolvido[idTes] : undefined;
    if (!r) {
      semMatch++;
      if (amostraSemMatch.length < 50) amostraSemMatch.push({ id: idTes, cliente: (linha as Record<string, unknown>).cliente });
      continue;
    }
    if (r.tipo === "match") comMatch++;
    else if (r.tipo === "divergencia_valor") { divValor++; if (amostraDivValor.length < 50) amostraDivValor.push({ id: idTes, ...r.detalhe }); }
    else if (r.tipo === "divergencia_status") { divStatus++; if (amostraDivStatus.length < 50) amostraDivStatus.push({ id: idTes, ...r.detalhe }); }
  }

  const usersLista = Object.entries(usersMapa).map(([k, u]) => {
    const at = u.atributos;
    const nomeBruto = val(at.name) || val(at.full_name) || val(at.email) || "";
    const match = NOMES_COMERCIAIS_CONHECIDOS.find((n) => nomeNorm(n) === nomeNorm(nomeBruto));
    return { id: k.split(":")[1] ?? k, type: u.type, freq: u.freq, nome_bruto: nomeBruto || "(sem atributos legíveis no included)", correspondencia: match ?? VENDEDOR_NAO_CONFIRMADO };
  }).sort((a, b) => b.freq - a.freq);
  const freqConfirmados = usersLista.filter((u) => u.correspondencia !== VENDEDOR_NAO_CONFIRMADO).reduce((s, u) => s + u.freq, 0);

  const relatorio = {
    ts: new Date().toISOString(), parte: "invoices", modo: "lotes",
    duracao_total_ms: Date.now() - Date.parse(ckpt.iniciado_em),
    paginacao_completa: true, paginas_processadas: ckpt.paginas_processadas,
    contagens: { invoices: ckpt.contagem, credit_notes: 0, receipts: 0 },
    periodo_coberto: ckpt.periodo,
    totais_faturas: totais, totais_notas_credito: totaisVazios(),
    duplicados_toconline: { invoices: idsVistos.size < ckpt.contagem ? ckpt.contagem - idsVistos.size : 0, credit_notes: 0, receipts: 0 },
    users_toconline: usersLista,
    vendedores_confirmados: usersLista.filter((u) => u.correspondencia !== VENDEDOR_NAO_CONFIRMADO).length,
    documentos_sem_vendedor_confirmado: ckpt.contagem - freqConfirmados,
    match_tes_receber: { total_tes_no_periodo: tesRows.length, com_match: comMatch, sem_match: semMatch, divergencias_valor: divValor, divergencias_status: divStatus },
    amostra_sem_match: amostraSemMatch, amostra_divergencias_valor: amostraDivValor, amostra_divergencias_status: amostraDivStatus,
    amostra_documentos: { invoices: amostra, credit_notes: [], receipts: [] },
    tentativas_include: { invoices: ckpt.tentativas_include },
    nota: "SOMENTE LEITURA, modo lotes com checkpoint (resource=finance_audit&parte=invoices&paginas=N). credit_notes e receipts nao foram consultados nesta corrida — ver toc-finance-audit-credit_notes / toc-finance-audit-receipts para essas partes.",
  };
  await guardarNaBase(`${CHAVE_FINANCE_AUDIT}-invoices`, relatorio);
  return {
    concluido: true, paginacao_completa: true, paginas_processadas: ckpt.paginas_processadas,
    contagem: ckpt.contagem, periodo_coberto: ckpt.periodo, match_tes_receber: relatorio.match_tes_receber,
    duplicados_toconline_invoices: relatorio.duplicados_toconline.invoices,
    vendedores_confirmados: relatorio.vendedores_confirmados,
    documentos_sem_vendedor_confirmado: relatorio.documentos_sem_vendedor_confirmado,
  };
}

// ══ FASE C — RECONCILIACAO AGREGADA POR CLIENTE (SOMENTE LEITURA) ══════════
// Objetivo (autorizado depois do diagnostico das 292 divergencias de valor):
// reconciliar TOConline vs ob-tes-receber por SOMA por cliente, nao por
// linha — o diagnostico mostrou que 86% das linhas do ob-tes-receber
// pertencem a clientes com mais de uma linha (projectos/tranches), enquanto
// o TOConline fatura por documento; comparar linha-a-linha por valor estava
// destinado a falhar na maioria dos casos. FT e NC sao tratados e somados
// SEPARADAMENTE dos dois lados, nunca comparados um com o outro. Placeholders
// (Cliente Final / NIF 999999990) sao excluidos por completo, dos dois
// lados, antes de somar. So GET ao TOConline, so leitura de ob-tes-receber;
// escreve so no checkpoint proprio e no relatorio final (toc-finance-
// reconcile), nunca em ob-tes-receber/ob_orcamentos/Financeiro/Ranking/
// Historico/CFO. Vendedor TOConline continua NAO CONFIRMADO — nao usado
// aqui, nao usado no Ranking.
const CHAVE_RECONCILE = "toc-finance-reconcile";
const CHAVE_RECONCILE_CKPT = "toc-finance-reconcile-checkpoint";

interface ClienteTocAc {
  nome_exemplo: string;
  toc_ft_bruto: number; toc_ft_count: number; toc_ft_pendente: number; toc_ft_anuladas: number;
  toc_nc_bruto: number; toc_nc_count: number; toc_nc_anuladas: number;
}
interface CheckpointReconcile {
  next_page_invoices: number;
  paginas_processadas_invoices: number;
  credit_notes_concluido: boolean;
  include_escolhido_invoices: string;
  clientes: Record<string, ClienteTocAc>;
  placeholders_excluidos_toc: number;
  iniciado_em: string;
}

// Mesma regra da Fase B (NIF_GENERICO / "Consumidor Final"), alargada ao
// padrao "Cliente Final" encontrado no ob-tes-receber (pedido explicito).
const ehPlaceholder = (nome: unknown, nif?: unknown): boolean => {
  const n = nomeNorm(nome);
  if (n.includes("CLIENTE FINAL") || n === "CONSUMIDOR FINAL") return true;
  if (nif !== undefined && nif !== "" && nifNorm(nif) === NIF_GENERICO) return true;
  return false;
};

function acumularDocReconcile(clientes: Record<string, ClienteTocAc>, d: DocAchatado, tipo: "ft" | "nc"): boolean {
  if (ehPlaceholder(d.customer_business_name, d.customer_tax_registration_number)) return true;
  const nm = nomeNorm(d.customer_business_name) || "(SEM NOME)";
  if (!clientes[nm]) {
    clientes[nm] = { nome_exemplo: d.customer_business_name || nm, toc_ft_bruto: 0, toc_ft_count: 0, toc_ft_pendente: 0, toc_ft_anuladas: 0, toc_nc_bruto: 0, toc_nc_count: 0, toc_nc_anuladas: 0 };
  }
  const c = clientes[nm];
  if (tipo === "ft") {
    if (d.voided_reason) c.toc_ft_anuladas++;
    else { c.toc_ft_bruto += d.gross_total; c.toc_ft_count++; c.toc_ft_pendente += d.pending_total; }
  } else {
    if (d.voided_reason) c.toc_nc_anuladas++;
    else { c.toc_nc_bruto += Math.abs(d.gross_total); c.toc_nc_count++; }
  }
  return false;
}

async function auditoriaReconciliacaoAgregada(paginasPorChamada: number, reiniciar: boolean): Promise<Record<string, unknown>> {
  const inicioChamada = Date.now();
  const token = await getAccessToken();
  const numGenerico = (x: unknown): number => (typeof x === "number" ? x : parseFloat(String(x ?? "")) || 0);

  let ckpt = reiniciar ? null : (await lerDaBase(CHAVE_RECONCILE_CKPT)) as CheckpointReconcile | null;
  if (!ckpt) {
    ckpt = {
      next_page_invoices: 1, paginas_processadas_invoices: 0, credit_notes_concluido: false,
      include_escolhido_invoices: "", clientes: {}, placeholders_excluidos_toc: 0,
      iniciado_em: new Date().toISOString(),
    };
  }
  const clientes = ckpt.clientes;

  // Notas de credito: so ~260 documentos / poucas paginas — cabem inteiras
  // numa chamada, sem checkpoint proprio. Reutiliza buscarDocumentosCompletos
  // (mesma funcao ja usada e testada em toc-finance-audit-credit_notes).
  if (!ckpt.credit_notes_concluido) {
    const { data: ncDocs } = await buscarDocumentosCompletos("credit_notes", token, 40000);
    for (const d of ncDocs) if (acumularDocReconcile(clientes, d, "nc")) ckpt.placeholders_excluidos_toc++;
    ckpt.credit_notes_concluido = true;
  }

  // Faturas: em lotes, mesma rede de seguranca da auditoriaFaturasLote
  // (6086 faturas de uma vez ja rebentou com WORKER_RESOURCE_LIMIT).
  const path = await resolverPath("invoices", token);
  const cfg = RECURSOS["invoices"];
  let escolhido = ckpt.include_escolhido_invoices;
  if (!escolhido && ckpt.paginas_processadas_invoices === 0) {
    for (const inc of DOC_INCLUDES) {
      const qs = [cfg.query, inc ? `include=${encodeURIComponent(inc)}` : "", "page[size]=1", "page[number]=1"].filter(Boolean).join("&");
      const r = await tocGet(`${path}?${qs}`, token);
      if (r.ok) { escolhido = inc; break; }
    }
  }

  let paginasNesteLote = 0, terminouInvoices = false, paginaAtual = ckpt.next_page_invoices;
  for (; paginasNesteLote < paginasPorChamada; paginasNesteLote++) {
    const qs = [cfg.query, escolhido ? `include=${encodeURIComponent(escolhido)}` : "", `page[size]=${PAGE_SIZE}`, `page[number]=${paginaAtual}`]
      .filter(Boolean).join("&");
    const res = await tocGet(`${path}?${qs}`, token);
    if (!res.ok) {
      if (paginaAtual === 1 && ckpt.paginas_processadas_invoices === 0) throw new HttpError(502, `TOConline devolveu HTTP ${res.status} em ${path}`);
      terminouInvoices = true; break;
    }
    let payload: Record<string, unknown>;
    try { payload = await res.json(); } catch { terminouInvoices = true; break; }
    const lote = extrairLista(payload);
    if (!lote.length) { terminouInvoices = true; break; }
    for (const docBruto of lote as Record<string, unknown>[]) {
      const d = achatarDocumento(docBruto);
      if (acumularDocReconcile(clientes, d, "ft")) ckpt.placeholders_excluidos_toc++;
    }
    ckpt.paginas_processadas_invoices++;
    paginaAtual++;
    if (lote.length < PAGE_SIZE) { terminouInvoices = true; break; }
    if (Date.now() - inicioChamada > 90000) break; // orcamento de tempo por chamada
  }

  ckpt.next_page_invoices = paginaAtual;
  ckpt.include_escolhido_invoices = escolhido;
  await guardarNaBase(CHAVE_RECONCILE_CKPT, ckpt);

  if (!terminouInvoices) {
    return {
      concluido: false,
      next_page_invoices: ckpt.next_page_invoices, paginas_processadas_invoices: ckpt.paginas_processadas_invoices,
      clientes_toconline_ate_agora: Object.keys(clientes).length,
      nota: "Lote gravado (toc-finance-reconcile-checkpoint). Chame de novo resource=finance_reconcile para continuar.",
    };
  }

  // Lado CRM: ob-tes-receber completo, agregado por cliente, FT/NC separado.
  const tes = (await lerDaBase(CHAVE_TES_RECEBER)) as Record<string, unknown>[] | null;
  const tesRows = Array.isArray(tes) ? tes : [];
  let placeholdersExcluidosCrm = 0;
  const crmMap: Record<string, { nome_exemplo: string; ft_total: number; ft_count: number; ft_recebido: number; ft_naorecebido: number; nc_total: number; nc_count: number }> = {};
  for (const linhaRaw of tesRows) {
    const linha = linhaRaw as Record<string, unknown>;
    const clienteNome = linha.cliente;
    if (ehPlaceholder(clienteNome, linha.nif)) { placeholdersExcluidosCrm++; continue; }
    const nm = nomeNorm(clienteNome) || "(SEM NOME)";
    if (!crmMap[nm]) crmMap[nm] = { nome_exemplo: val(clienteNome) || nm, ft_total: 0, ft_count: 0, ft_recebido: 0, ft_naorecebido: 0, nc_total: 0, nc_count: 0 };
    const c = crmMap[nm];
    const valor = numGenerico(linha.total ?? linha.valorRecebido);
    const tipo = val(linha.tipo);
    const estado = val(linha.estado);
    if (tipo === "NC") { c.nc_total += Math.abs(valor); c.nc_count++; }
    else { c.ft_total += valor; c.ft_count++; if (estado === "Recebido") c.ft_recebido++; else c.ft_naorecebido++; }
  }

  // Fusao por nome normalizado + categorizacao.
  const todosNomes = new Set([...Object.keys(clientes), ...Object.keys(crmMap)]);
  type LinhaReconcile = {
    cliente: string; toc_ft_bruto: number; toc_nc_bruto: number; toc_saldo_liquido: number; toc_ft_pendente: number;
    crm_ft_total: number; crm_nc_total: number; crm_saldo_liquido: number;
    diferenca: number; diferenca_abs: number;
    crm_estado_agregado: string; toc_liquidado: boolean;
    parcial: boolean; crm_recebido_toc_pendente: boolean; crm_naorecebido_toc_liquidado: boolean;
  };
  const linhas: LinhaReconcile[] = [];
  for (const nm of todosNomes) {
    const t = clientes[nm], c = crmMap[nm];
    const toc_ft_bruto = t?.toc_ft_bruto ?? 0, toc_nc_bruto = t?.toc_nc_bruto ?? 0, toc_ft_pendente = t?.toc_ft_pendente ?? 0;
    const crm_ft_total = c?.ft_total ?? 0, crm_nc_total = c?.nc_total ?? 0;
    const toc_saldo_liquido = toc_ft_bruto - toc_nc_bruto, crm_saldo_liquido = crm_ft_total - crm_nc_total;
    const diferenca = toc_saldo_liquido - crm_saldo_liquido;
    const crm_estado_agregado = !c || c.ft_count === 0 ? "sem_dados_crm"
      : c.ft_recebido > 0 && c.ft_naorecebido === 0 ? "Recebido"
      : c.ft_naorecebido > 0 && c.ft_recebido === 0 ? "Não Recebido" : "Misto";
    const toc_liquidado = toc_ft_pendente <= 0.5;
    linhas.push({
      cliente: t?.nome_exemplo || c?.nome_exemplo || nm,
      toc_ft_bruto, toc_nc_bruto, toc_saldo_liquido, toc_ft_pendente,
      crm_ft_total, crm_nc_total, crm_saldo_liquido,
      diferenca, diferenca_abs: Math.abs(diferenca),
      crm_estado_agregado, toc_liquidado,
      parcial: crm_estado_agregado === "Misto" || (toc_ft_pendente > 0.5 && toc_ft_pendente < toc_ft_bruto - 0.5),
      crm_recebido_toc_pendente: crm_estado_agregado === "Recebido" && !toc_liquidado && (t?.toc_ft_count ?? 0) > 0,
      crm_naorecebido_toc_liquidado: crm_estado_agregado === "Não Recebido" && toc_liquidado && (t?.toc_ft_count ?? 0) > 0,
    });
  }

  const reconciliados = linhas.filter((l) => l.diferenca_abs <= 0.5);
  const divergentes = linhas.filter((l) => l.diferenca_abs > 0.5);
  const parciais = linhas.filter((l) => l.parcial);
  const casosRecebidoPendente = linhas.filter((l) => l.crm_recebido_toc_pendente);
  const casosNaoRecebidoLiquidado = linhas.filter((l) => l.crm_naorecebido_toc_liquidado);
  const diferencaTotalSinalizada = linhas.reduce((s, l) => s + l.diferenca, 0);
  const diferencaTotalAbsoluta = linhas.reduce((s, l) => s + l.diferenca_abs, 0);
  const maiores20 = [...linhas].sort((a, b) => b.diferenca_abs - a.diferenca_abs).slice(0, 20);

  const clientesComNcCrm = Object.entries(crmMap).filter(([, c]) => c.nc_count > 0);
  const nc27ComNcToc = clientesComNcCrm.filter(([nm]) => (clientes[nm]?.toc_nc_count ?? 0) > 0).length;

  const relatorio = {
    ts: new Date().toISOString(), modo: "reconciliacao_agregada_por_cliente",
    duracao_total_ms: Date.now() - Date.parse(ckpt.iniciado_em),
    paginas_processadas_invoices: ckpt.paginas_processadas_invoices,
    clientes_analisados: linhas.length,
    clientes_reconciliados_diferenca_ate_050: reconciliados.length,
    clientes_divergencia_real_acima_050: divergentes.length,
    placeholders_excluidos: { toconline: ckpt.placeholders_excluidos_toc, crm: placeholdersExcluidosCrm },
    impacto_27_nc: {
      linhas_nc_no_crm: 27, clientes_com_nc_no_crm: clientesComNcCrm.length,
      desses_com_nc_tambem_no_toconline: nc27ComNcToc,
      total_nc_crm: clientesComNcCrm.reduce((s, [, c]) => s + c.nc_total, 0),
      total_nc_toconline: Object.values(clientes).reduce((s, c) => s + c.toc_nc_bruto, 0),
    },
    casos_pagamento_parcial: parciais.length,
    casos_crm_recebido_toc_pendente: casosRecebidoPendente.length,
    casos_crm_naorecebido_toc_liquidado: casosNaoRecebidoLiquidado.length,
    diferenca_total_euros_sinalizada: diferencaTotalSinalizada,
    diferenca_total_euros_absoluta: diferencaTotalAbsoluta,
    amostra_maiores_20_desvios: maiores20,
    amostra_pagamento_parcial: parciais.slice(0, 30),
    amostra_crm_recebido_toc_pendente: casosRecebidoPendente.slice(0, 30),
    amostra_crm_naorecebido_toc_liquidado: casosNaoRecebidoLiquidado.slice(0, 30),
    nota: "SOMENTE LEITURA. Reconciliacao por soma agregada por cliente (nao exige 1:1 linha-documento). Placeholders (Cliente Final / NIF 999999990) excluidos de ambos os lados antes de somar. FT e NC tratados e somados separadamente dos dois lados, nunca comparados um com o outro. Vendedor TOConline continua NAO CONFIRMADO — nao usado aqui nem no Ranking. Nao escreveu em ob-tes-receber, ob_orcamentos, Financeiro, Ranking, Historico ou CFO.",
  };
  await guardarNaBase(CHAVE_RECONCILE, relatorio);
  return {
    concluido: true,
    clientes_analisados: relatorio.clientes_analisados,
    clientes_reconciliados_diferenca_ate_050: relatorio.clientes_reconciliados_diferenca_ate_050,
    clientes_divergencia_real_acima_050: relatorio.clientes_divergencia_real_acima_050,
    diferenca_total_euros_sinalizada: relatorio.diferenca_total_euros_sinalizada,
    diferenca_total_euros_absoluta: relatorio.diferenca_total_euros_absoluta,
  };
}

// ══ SYNC_DOCS — paginação completa por lotes, SEM CHECKPOINT (SOMENTE LEITURA) ══
// A Central de Sincronização Financeira do CRM (preview) chamava directamente
// resource=invoices/credit_notes/receipts, que usa buscarTudo()/MAX_PAGES=50
// (teto histórico de 5.000 documentos, pensado para o snapshot leve do
// callback OAuth) — insuficiente com 6.086 faturas reais. Este recurso novo
// devolve paginação completa, um lote de páginas TOConline por chamada, tal
// como auditoriaFaturasLote()/auditoriaReconciliacaoAgregada(), mas SEM
// persistir nenhum checkpoint em ob_crm_dados: cada chamada é independente,
// devolve pagina_seguinte, e é o CHAMADOR (o browser) que decide repetir a
// chamada até paginacao_completa:true, acumulando o resultado do seu lado.
// Isto evita criar mais uma chave de checkpoint na base só para um proxy
// paginado — o volume por chamada já fica pequeno (achatarDocumento por
// página, igual a buscarDocumentosCompletos(), nunca a colecção bruta
// inteira em memória).
// Compatibilidade: resource=invoices/credit_notes/receipts (buscarTudo(),
// MAX_PAGES) e o snapshot do callback OAuth continuam exactamente como
// estavam — nada aqui os altera. Só GET ao TOConline; nunca cria, altera ou
// cancela documentos; nunca escreve em ob-tes-receber, ob_orcamentos,
// ob-clients, Financeiro, Ranking, Histórico ou CFO.
async function sincDocsLote(
  recurso: "invoices" | "credit_notes" | "receipts",
  paginaInicio: number,
  paginasPorChamada: number,
): Promise<Record<string, unknown>> {
  const inicioChamada = Date.now();
  const token = await getAccessToken();
  const path = await resolverPath(recurso, token);
  const cfg = RECURSOS[recurso];

  const candidatos = recurso === "receipts" ? [""] : DOC_INCLUDES;
  const tentativas: string[] = [];
  let escolhido = "";
  for (const inc of candidatos) {
    const qs = [cfg.query, inc ? `include=${encodeURIComponent(inc)}` : "", "page[size]=1", "page[number]=1"]
      .filter(Boolean).join("&");
    const r = await tocGet(`${path}?${qs}`, token);
    tentativas.push(`${inc || "(sem include)"} -> HTTP ${r.status}`);
    if (r.ok) { escolhido = inc; break; }
  }

  const data: DocAchatado[] = [];
  let pagina = paginaInicio;
  let paginasProcessadas = 0;
  let terminou = false; // fim real da paginação (página curta ou vazia) — nunca escreve nada, só leitura
  let parcial = false;  // parou por orçamento de tempo desta chamada, sem chegar ao fim

  for (; paginasProcessadas < paginasPorChamada; paginasProcessadas++) {
    if (Date.now() - inicioChamada > 90000) { parcial = true; break; }
    const qs = [cfg.query, escolhido ? `include=${encodeURIComponent(escolhido)}` : "", `page[size]=${PAGE_SIZE}`, `page[number]=${pagina}`]
      .filter(Boolean).join("&");
    const res = await tocGet(`${path}?${qs}`, token);
    if (!res.ok) {
      if (pagina === paginaInicio && paginasProcessadas === 0) throw new HttpError(502, `TOConline devolveu HTTP ${res.status} em ${path}`);
      terminou = true; break;
    }
    let payload: Record<string, unknown>;
    try { payload = await res.json(); } catch { terminou = true; break; }
    const lote = extrairLista(payload);
    if (!lote.length) { terminou = true; break; }
    for (const doc of lote as Record<string, unknown>[]) data.push(achatarDocumento(doc));
    pagina++;
    if (lote.length < PAGE_SIZE) { terminou = true; break; }
    // `payload`/`lote` saem de scope aqui — nada retém os campos brutos.
  }

  return {
    tipo: recurso, pagina_inicio: paginaInicio, pagina_seguinte: pagina,
    paginas_processadas: paginasProcessadas, contagem: data.length,
    paginacao_completa: terminou, parcial,
    include_escolhido: escolhido, tentativas_include: tentativas,
    data,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "GET") return json({ error: "Apenas GET e suportado." }, 405);

  const url = new URL(req.url);
  const pedido = url.searchParams.get("resource") ?? "";

  // ── Router: os dois pontos de entrada do OAuth sao publicos ──────────────
  // Nem o /auth nem o /callback podem exigir x-api-key: o primeiro e aberto
  // pela pessoa no browser, o segundo e chamado pelo TOConline. O /callback
  // esta protegido pelo state assinado (HMAC + TTL), nao pela gateway key.
  //
  // O `resource` NAO chega no retorno: o redirect_uri registado no TOConline
  // e uma URL fixa sem query string, por isso o callback e reconhecido pela
  // presenca de code/error — e SO quando nao vem `resource` nenhum, para que
  // ninguem possa anexar ?code=&state= a um recurso de dados e escapar a
  // gateway key. `resource=callback` continua a funcionar, por compatibilidade.
  //
  // Nao se exige `state` aqui: um retorno sem state tem de chegar ao ramo do
  // callback para ser recusado com "State invalido" — mensagem que se percebe
  // — em vez de um 401 mudo. A troca do code so acontece depois do HMAC.
  const retornoOAuth = url.searchParams.has("code") || url.searchParams.has("error");
  const rota = pedido === "auth"
    ? "auth"
    : (pedido === "callback" || (pedido === "" && retornoOAuth))
      ? "callback"
      : pedido;

  try {
    // ── 1) Início da autorização: redirige para o TOConline ────────────────
    // Sem gateway key: é um ponto de entrada de browser e não expõe nada —
    // quem abre isto tem ainda de se autenticar no TOConline.
    if (rota === "auth") {
      // Este ramo NUNCA devolve HTML: ou 302, ou JSON de erro. Uma pagina
      // intermediaria aqui quebra o fluxo OAuth (foi o que aconteceu na v3,
      // em que um erro caia no ramo de HTML do catch).
      let destino: string;
      try {
        // Ordem e nomes exactamente como a documentacao oficial os lista:
        //   <OAUTH_URL>/auth?client_id=…&redirect_uri=…&response_type=code&scope=commercial
        // O `state` nao consta da documentacao mas e padrao OAuth2 (RFC 6749
        // §4.1.1, recomendado) e e o que protege o callback contra CSRF, ja
        // que este nao tem gateway key. Vai em ultimo, para nao se intrometer
        // entre os parametros documentados.
        const p = new URLSearchParams({
          client_id: precisaSecret("TOC_CLIENT_ID"),
          redirect_uri: redirectUri(),
          response_type: "code",
          scope: SCOPE,
          state: await assinarState(),
        });
        destino = `${oauthUrl()}/auth?${p}`;
      } catch (e) {
        const st = e instanceof HttpError ? e.status : 500;
        const msg = e instanceof HttpError ? e.message : "Falha ao construir a autorizacao.";
        return json({ error: msg, resource: "auth" }, st);
      }
      // ?dry=1 mostra o destino sem redirigir. Nao revela nada de novo: o
      // client_id ja viaja na propria URL de autorizacao, por desenho OAuth.
      if (url.searchParams.get("dry") === "1") {
        return json({ authorize_url: destino, oauth_host: new URL(destino).host, redirect_uri: redirectUri() }, 200);
      }
      return new Response(null, {
        status: 302,
        headers: { "Location": destino, "Cache-Control": "no-store" },
      });
    }

    // ── 2) Callback: troca o code por tokens e valida logo os endpoints ────
    if (rota === "callback") {
      const erro = url.searchParams.get("error");
      if (erro) return html(`<h1 class="err">Autorizacao recusada</h1><p>O TOConline devolveu: <code>${esc(erro)}</code></p>`, 400);
      const code = url.searchParams.get("code");
      if (!code) return html(`<h1 class="err">Falta o parametro <code>code</code></h1>`, 400);
      if (!await validarState(url.searchParams.get("state") ?? "")) {
        return html(`<h1 class="err">State invalido ou expirado</h1><p>Reabrir <code>?resource=auth</code> e repetir dentro de 15 minutos.</p>`, 400);
      }
      // A documentacao descreve o POST /token do authorization_code com
      // grant_type, o codigo e o scope. O redirect_uri vai tambem, como a
      // RFC exige quando esteve presente no pedido de autorizacao.
      const t = await pedirToken(new URLSearchParams({
        grant_type: "authorization_code",
        code,
        scope: SCOPE,
        redirect_uri: redirectUri(),
      }), "authorization_code");

      const refresh = t.refresh_token as string | undefined;
      const access = t.access_token as string | undefined;
      if (!refresh) return html(`<h1 class="err">O TOConline nao devolveu refresh_token</h1><p>Verificar se a aplicacao tem o scope <code>${SCOPE}</code> activo.</p>`, 502);

      // Persiste o refresh_token na base (chave fora do alcance de anon), para
      // sobreviver a rotacao e dispensar nova colagem manual no secret.
      const guardouToken = await guardarNaBase(CHAVE_OAUTH,
        { refresh_token: refresh, atualizado_em: new Date().toISOString() });

      // Valida ja os endpoints com o access_token acabado de obter.
      const diag = await diagnostico(access!);

      // Recolhe o cadastro e deposita-o na base, para o assistente poder fazer
      // o dry-run sem precisar de invocar a funcao (o egresso do ambiente dele
      // esta bloqueado para supabase.co e toconline.pt).
      const snapshot: Record<string, unknown> = { obtido_em: new Date().toISOString(), diag };
      let resumo = "";
      try {
        const c = await buscarClientes(access!);
        snapshot.customers = c.data;
        snapshot.customers_count = c.data.length;
        snapshot.customers_included = c.included;
        snapshot.customers_included_count = c.included.length;
        snapshot.customers_include = c.include;
        snapshot.customers_include_tentativas = c.tentativas;
        resumo += `<li>clientes: <b>${c.data.length}</b> (via <code>${esc(c.path)}</code>` +
          (c.include ? `, include <code>${esc(c.include)}</code>` : `, sem include`) +
          `)</li><li>recursos relacionados: <b>${c.included.length}</b></li>`;
      } catch (e) {
        snapshot.customers_erro = e instanceof HttpError ? e.message : "falhou";
        resumo += `<li class="err">clientes: ${esc(String(snapshot.customers_erro))}</li>`;
      }
      try {
        const faturas = await buscarTudo("invoices", access!);
        snapshot.invoices_count = faturas.length;
        snapshot.invoices_amostra = faturas.slice(0, 3);
        resumo += `<li>faturas: <b>${faturas.length}</b> (via <code>${esc(pathCache["invoices"] ?? "?")}</code>)</li>`;
      } catch (e) {
        snapshot.invoices_erro = e instanceof HttpError ? e.message : "falhou";
        resumo += `<li class="err">faturas: ${esc(String(snapshot.invoices_erro))}</li>`;
      }
      const guardouSnapshot = await guardarNaBase(CHAVE_SNAPSHOT, snapshot);

      return html(
        `<h1 class="ok">Autorizacao concluida</h1>` +
        `<ul>${resumo}</ul>` +
        (guardouSnapshot
          ? `<p class="ok">Dados depositados na base (<code>${CHAVE_SNAPSHOT}</code>). Pode fechar esta pagina — o assistente le-os a partir daqui, sem mais nada da sua parte.</p>`
          : `<p class="err">Nao foi possivel gravar na base. Envie o bloco abaixo ao assistente.</p><pre>${esc(JSON.stringify(diag, null, 2))}</pre>`) +
        (guardouToken
          ? `<p style="color:#666">O refresh_token foi guardado automaticamente e sobrevive a rotacao. Nao e preciso copiar nada.</p>`
          : `<p><b>Gravar no Supabase -> Secrets como <code>TOC_REFRESH_TOKEN</code>:</b></p><pre>${esc(refresh)}</pre>`) +
        `<p style="color:#666">O access_token nao e mostrado nem persistido.</p>`);
    }

    // ── 3) Tudo o resto exige chamador autenticado ─────────────────────────
    // JWT de utilizador do CRM (browser) ou x-api-key (servidor-para-servidor).
    // Nunca por query string, em qualquer das vias.
    const quem = await autenticar(req);

    if (pedido === "estado") return json(await lerDaBase(CHAVE_SYNC) ?? { nunca: true }, 200);

    if (pedido === "sync") {
      const seco = url.searchParams.get("dry") === "1";
      return json(await sincronizarClientes(seco, quem.via), 200);
    }

    if (pedido === "diag") return json(await diagnostico(), 200);

    // Fase C — auditoria financeira, somente leitura (ver bloco acima).
    // ?parte=invoices|credit_notes|receipts corre so essa parte (util se o
    // orcamento de tempo de uma corrida "tudo" nao chegar para as tres).
    // parte=invoices e um caso especial: usa o modo em lotes com checkpoint
    // (auditoriaFaturasLote) em vez de buscar as 6086 faturas de uma vez —
    // essa corrida "tudo numa chamada" rebentou com WORKER_RESOURCE_LIMIT.
    // ?paginas=N (default 15) controla quantas paginas do TOConline uma
    // chamada processa; ?reiniciar=1 ignora o checkpoint e comeca do zero.
    if (pedido === "finance_audit") {
      const parteParam = url.searchParams.get("parte") ?? "tudo";
      if (parteParam === "invoices") {
        const paginasParam = Number(url.searchParams.get("paginas"));
        const paginas = Number.isFinite(paginasParam) && paginasParam > 0
          ? Math.min(50, Math.floor(paginasParam)) : PAGINAS_POR_LOTE_DEFAULT;
        const reiniciar = url.searchParams.get("reiniciar") === "1";
        return json(await auditoriaFaturasLote(paginas, reiniciar), 200);
      }
      return json(await auditoriaFinanceira(parteParam), 200);
    }
    if (pedido === "finance_audit_estado") {
      return json(await lerDaBase(CHAVE_FINANCE_AUDIT) ?? { nunca: true }, 200);
    }

    // Reconciliacao agregada por cliente (ver bloco acima). Mesmo esquema de
    // lotes/checkpoint de finance_audit&parte=invoices: ?paginas=N (default
    // 15), ?reiniciar=1 para comecar do zero.
    if (pedido === "finance_reconcile") {
      const paginasParam = Number(url.searchParams.get("paginas"));
      const paginas = Number.isFinite(paginasParam) && paginasParam > 0
        ? Math.min(50, Math.floor(paginasParam)) : PAGINAS_POR_LOTE_DEFAULT;
      const reiniciar = url.searchParams.get("reiniciar") === "1";
      return json(await auditoriaReconciliacaoAgregada(paginas, reiniciar), 200);
    }
    if (pedido === "finance_reconcile_estado") {
      return json(await lerDaBase(CHAVE_RECONCILE) ?? { nunca: true }, 200);
    }

    // Paginação completa por lotes, sem checkpoint (ver bloco acima). Usado
    // pela Central de Sincronização Financeira do CRM em vez do
    // resource=invoices/credit_notes/receipts (esses continuam capados em
    // MAX_PAGES=50/5.000 documentos, inalterados, para compatibilidade).
    // ?tipo=invoices|credit_notes|receipts (obrigatório), ?pagina=N (default
    // 1, primeira página desta chamada), ?paginas=N (default 15, quantas
    // páginas TOConline processar nesta chamada).
    if (pedido === "sync_docs") {
      const tipoParam = url.searchParams.get("tipo") ?? "";
      if (tipoParam !== "invoices" && tipoParam !== "credit_notes" && tipoParam !== "receipts") {
        return json({ error: "tipo invalido. Use: invoices | credit_notes | receipts" }, 400);
      }
      const paginaParam = Number(url.searchParams.get("pagina"));
      const paginaInicio = Number.isFinite(paginaParam) && paginaParam > 0 ? Math.floor(paginaParam) : 1;
      const paginasParam = Number(url.searchParams.get("paginas"));
      const paginas = Number.isFinite(paginasParam) && paginasParam > 0
        ? Math.min(50, Math.floor(paginasParam)) : PAGINAS_POR_LOTE_DEFAULT;
      return json(await sincDocsLote(tipoParam, paginaInicio, paginas), 200);
    }

    if (pedido === "token") {
      await getAccessToken();
      return json({ ok: true, grant_type: "refresh_token",
        expira_em_s: Math.round(((tokenCache?.expiresAt ?? 0) - Date.now()) / 1000) }, 200);
    }

    const recurso = ALIAS[pedido] ?? pedido;
    if (RECURSOS[recurso]) {
      const token = await getAccessToken();
      const data = await buscarTudo(recurso, token);
      return json({ resource: pedido, resolved: recurso, path: pathCache[recurso], count: data.length, data }, 200);
    }

    return json({ error: "resource invalido. Use: sync | estado | customers | clients | invoices | credit_notes | receipts | token | diag | auth | finance_audit | finance_audit_estado | finance_reconcile | finance_reconcile_estado | sync_docs" }, 400);
  } catch (e) {
    if (e instanceof HttpError) {
      // So o callback devolve HTML (e uma pagina para pessoa ler). O auth
      // devolve sempre JSON, para nunca substituir o redirect por uma pagina.
      return rota === "callback"
        ? html(`<h1 class="err">Erro</h1><p>${esc(e.message)}</p>`, e.status)
        : json({ error: e.message }, e.status);
    }
    return json({ error: "Erro interno ao contactar o TOConline." }, 500);
  }
});
