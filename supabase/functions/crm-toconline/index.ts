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
//   ?resource=callback  → recebe o code, troca por tokens, mostra o
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
//   TOC_REDIRECT_URI    Default: https://<SUPABASE_URL>/functions/v1/crm-toconline?resource=callback
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
// O callback tem de ser SEMPRE a URL publica e completa desta funcao:
//   https://<ref>.supabase.co/functions/v1/crm-toconline?resource=callback
// Nao pode ser derivada de req.url: o runtime das Edge Functions apresenta o
// pedido interno como http://<ref>.supabase.co/crm-toconline — perde o https
// e perde o /functions/v1. Era isso que produzia um redirect_uri invalido.
const NOME_FUNCAO = "crm-toconline";
const CALLBACK_FALLBACK =
  `https://ddzlbmnmsdyodouqxbjx.supabase.co/functions/v1/${NOME_FUNCAO}?resource=callback`;

function redirectUri(): string {
  const e = Deno.env.get("TOC_REDIRECT_URI");
  if (e) return e.trim();
  const base = Deno.env.get("SUPABASE_URL");
  if (base) return `${semBarra(base)}/functions/v1/${NOME_FUNCAO}?resource=callback`;
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
  // O `resource` pode nem chegar no retorno: ha servidores OAuth que
  // reconstroem o redirect_uri e descartam a query string ja existente,
  // devolvendo so ?code=…&state=…. Sem isto, esse retorno caia no ramo final
  // e respondia 401. Por isso o callback e reconhecido tambem pela presenca
  // de code/error com state — e SO quando nao vem `resource` nenhum, para
  // que ninguem possa anexar ?code=&state= a um recurso de dados e escapar
  // a gateway key.
  const retornoOAuth = url.searchParams.has("state") &&
    (url.searchParams.has("code") || url.searchParams.has("error"));
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
        const p = new URLSearchParams({
          response_type: "code",
          client_id: precisaSecret("TOC_CLIENT_ID"),
          redirect_uri: redirectUri(),
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
      const t = await pedirToken(new URLSearchParams({
        grant_type: "authorization_code",
        code,
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
        const clientes = await buscarTudo("customers", access!);
        snapshot.customers = clientes;
        snapshot.customers_count = clientes.length;
        resumo += `<li>clientes: <b>${clientes.length}</b> (via <code>${esc(pathCache["customers"] ?? "?")}</code>)</li>`;
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

    // ── 3) Tudo o resto exige a gateway key, SÓ no cabeçalho ───────────────
    // Chega-se aqui em tudo o que nao seja auth/callback: diag, token,
    // customers, clients, invoices, credit_notes, receipts, e tambem um
    // pedido sem `resource`. Nenhum destes passa sem a chave, e a chave so
    // e lida do cabecalho — nunca da query string.
    const esperada = precisaSecret("TOC_GATEWAY_KEY");
    if (!safeEqual(req.headers.get("x-api-key") ?? "", esperada)) {
      return json({ error: "Nao autorizado." }, 401);
    }

    if (pedido === "diag") return json(await diagnostico(), 200);

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

    return json({ error: "resource invalido. Use: customers | clients | invoices | credit_notes | receipts | token | diag | auth" }, 400);
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
