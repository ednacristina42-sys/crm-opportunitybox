// ============================================================
// crm-lead-ops — único caminho de escrita autenticada para
// ob-leads. Fino de propósito: valida o chamador e delega toda a
// leitura/aplicação/escrita ao RPC transacional public.crm_lead_op
// (ver supabase/proposals/crm_lead_op_rpc.sql), que é quem garante
// CAS real (SELECT...FOR UPDATE) e auditoria atómica. Esta função
// não faz read-modify-write nenhum — só autoriza e delega.
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// Resolve o utilizador a partir do token que o CHAMADOR enviou (nunca de
// um id vindo do corpo do pedido — isso permitiria impersonar outro
// utilizador). /auth/v1/user valida o JWT contra o Supabase Auth.
async function resolverUtilizador(req: Request): Promise<{ id: string } | null> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const user = await r.json();
  if (!user || !user.id) return null;
  return { id: user.id };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const utilizador = await resolverUtilizador(req);
  if (!utilizador) return json({ error: "sessao invalida ou expirada" }, 401);

  let body: { operacao?: string; id?: number; lead?: unknown };
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

  // Delega tudo ao RPC — autorização (papel), CAS (FOR UPDATE) e
  // auditoria atómica vivem lá, numa única transação. Esta função só
  // encaminha, com o id do utilizador já verificado acima.
  const r = await fetch(`${SB_URL}/rest/v1/rpc/crm_lead_op`, {
    method: "POST",
    headers: {
      apikey: SB_SERVICE_KEY,
      Authorization: `Bearer ${SB_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_operacao: operacao,
      p_id: id,
      p_lead: operacao === "delete" ? null : body.lead,
      p_actor_id: utilizador.id,
    }),
  });

  if (!r.ok) {
    const detalhe = await r.text().catch(() => "");
    // 42501 (sem permissao) e 22023 (payload invalido) do RPC chegam
    // aqui como erro do PostgREST — traduz para o status HTTP certo.
    const status = detalhe.includes("42501") ? 403 : detalhe.includes("22023") ? 400 : 502;
    return json({ error: "falha ao aplicar a operacao", detalhe }, status);
  }

  const dados = await r.json();
  return json({ ok: true, operacao, id, dados });
});
