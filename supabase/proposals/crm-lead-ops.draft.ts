// ============================================================
// RASCUNHO — NÃO IMPLANTADA. Ver
// ob-leads-write-via-edge-function-design.md para o desenho
// completo. Este ficheiro é só para revisão; não faz parte de
// supabase/functions/ propositadamente, para não ser apanhado por
// nenhum passo automático de deploy.
//
// Único caminho de escrita autenticada para ob-leads depois da
// proposta em ob-leads-restrict-authenticated-write.sql ser
// aplicada. Mesmo padrão de leitura/escrita/proteção de corrida já
// usado (e já em produção) em crm-lead-intake/index.ts — só troca
// "criar/atualizar a partir de uma conversa" por "aplicar UMA
// operação create/update/delete pedida pelo frontend autenticado".
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CHAVE_LEADS = "ob-leads";
const CHAVE_ATIVIDADES = "ob-crm-atividades";
const PAPEIS_PERMITIDOS = ["admin", "comercial"]; // mesmo conjunto de ob_crm_dados_update_comercial hoje

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

const sbHeaders = {
  apikey: SB_SERVICE_KEY,
  Authorization: `Bearer ${SB_SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function lerBlob(chave: string): Promise<any[]> {
  const r = await fetch(`${SB_URL}/rest/v1/ob_crm_dados?chave=eq.${chave}&select=dados`, { headers: sbHeaders });
  if (r.ok) {
    const rows = await r.json();
    if (Array.isArray(rows) && rows[0] && Array.isArray(rows[0].dados)) return rows[0].dados;
  }
  return [];
}

async function gravarBlob(chave: string, dados: unknown[]) {
  return fetch(`${SB_URL}/rest/v1/ob_crm_dados?on_conflict=chave`, {
    method: "POST",
    headers: { ...sbHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ chave, dados, updated_at: new Date().toISOString() }),
  });
}

// Extrai o utilizador do JWT do pedido (já validado pelo gateway,
// verify_jwt=true) e confirma o papel via ob_profiles com
// service_role — replica exatamente a condição hoje aplicada por
// ob_is_admin()/ob_current_role() em RLS, só que em código.
async function autorizarAutor(req: Request): Promise<{ ok: true; userId: string; nome: string } | { ok: false; motivo: string }> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return { ok: false, motivo: "sem token" };

  const rUser = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!rUser.ok) return { ok: false, motivo: "token invalido" };
  const user = await rUser.json();
  if (!user || !user.id) return { ok: false, motivo: "token sem utilizador" };

  const rProfile = await fetch(
    `${SB_URL}/rest/v1/ob_profiles?id=eq.${user.id}&select=role,full_name`,
    { headers: sbHeaders },
  );
  if (!rProfile.ok) return { ok: false, motivo: "falha a ler perfil" };
  const rows = await rProfile.json();
  const perfil = Array.isArray(rows) ? rows[0] : null;
  if (!perfil || !PAPEIS_PERMITIDOS.includes(perfil.role)) {
    return { ok: false, motivo: "papel sem permissao (precisa admin ou comercial)" };
  }
  return { ok: true, userId: user.id, nome: perfil.full_name || user.email || "desconhecido" };
}

// Mesma semântica de crmAplicarOperacaoLeadSobreRemoto() no
// frontend, portada para o servidor: 'create'/'update' substitui
// pelo objeto enviado (procura por id, nunca duplica); 'delete'
// remove só esse id. Todos os outros leads remotos (de outras
// sessões, ou da integração Leonor) passam intactos.
function aplicarOperacao(remotoArr: any[], operacao: string, id: number, lead: any): any[] {
  if (operacao === "delete") {
    return remotoArr.filter((l) => l && l.id !== id);
  }
  const idx = remotoArr.findIndex((l) => l && l.id === id);
  const novoArr = remotoArr.slice();
  if (idx >= 0) novoArr[idx] = lead;
  else novoArr.push(lead);
  return novoArr;
}

async function gravarComProtecaoDeCorrida(operacao: string, id: number, lead: any, maxTentativas = 2) {
  for (let tentativa = 0; tentativa < maxTentativas; tentativa++) {
    const atuais = await lerBlob(CHAVE_LEADS);
    const resultado = aplicarOperacao(atuais, operacao, id, lead);
    const r = await gravarBlob(CHAVE_LEADS, resultado);
    if (r.ok) return { ok: true, resultado };
  }
  return { ok: false };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const autor = await autorizarAutor(req);
  if (!autor.ok) return json({ error: autor.motivo }, 401);

  let body: { operacao?: string; id?: number; lead?: any };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const operacao = String(body.operacao || "");
  const id = Number(body.id);
  if (!["create", "update", "delete"].includes(operacao)) {
    return json({ error: "operacao deve ser create, update ou delete" }, 400);
  }
  if (!Number.isFinite(id)) return json({ error: "id em falta ou invalido" }, 400);
  if (operacao !== "delete" && (!body.lead || typeof body.lead !== "object")) {
    return json({ error: "lead em falta para create/update" }, 400);
  }

  const resultado = await gravarComProtecaoDeCorrida(operacao, id, body.lead);
  if (!resultado.ok) {
    return json({ error: "falha ao gravar — conflito de escrita persistente, tenta novamente" }, 502);
  }

  // Auditoria — mesmo padrão de crm-lead-intake.
  try {
    const atividades = await lerBlob(CHAVE_ATIVIDADES);
    atividades.unshift({
      leadId: id,
      orcId: null,
      ts: new Date().toISOString(),
      tipo: operacao === "delete" ? "apagado" : operacao === "create" ? "criado" : "editado",
      texto: `Lead ${operacao} via crm-lead-ops`,
      autor: autor.nome,
      resultado: null,
    });
    await gravarBlob(CHAVE_ATIVIDADES, atividades);
  } catch (_e) { /* auditoria nunca bloqueia a operação principal */ }

  return json({ ok: true, operacao, id, dados: resultado.resultado });
});
