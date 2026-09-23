// ══════════════════════════════════════════════════════════════════════════
// crm-admin-users — criação de contas de login (Supabase Auth + ob_profiles)
// e reposição de password. Só chamável por Admin (Edna/Paulo). Nunca expõe
// a service_role key ao browser — fica só dentro desta função, exactamente
// como em crm-toconline. Pedido pela Edna, 23/09/2026: conta
// "administrativo" (Carolina Martins) e futuras contas semelhantes.
//
// Nenhuma password é lida de volta — nem por esta função nem por nenhuma
// outra: o Supabase Auth guarda só um hash irreversível. "Esqueci a
// password" resolve-se sempre por REPOR uma nova, nunca por recuperar a
// antiga (ver ?action=reset_password abaixo).
// ══════════════════════════════════════════════════════════════════════════

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function sbCfg(): { url: string; key: string } {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new HttpError(500, "Configuração do Supabase em falta (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY).");
  return { url: url.replace(/\/+$/, ""), key };
}

// Papéis que esta função pode atribuir. 'admin' fica de fora de propósito —
// uma segunda conta admin não se cria por um atalho automático, só
// diretamente no painel do Supabase, com decisão humana explícita ali.
const PAPEIS_PERMITIDOS = ["administrativo", "comercial", "financeiro", "manager"];

async function utilizadorAdminDoToken(token: string, cfg: { url: string; key: string }): Promise<{ id: string } | null> {
  const r = await fetch(`${cfg.url}/auth/v1/user`, {
    headers: { "apikey": cfg.key, "Authorization": `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const u = await r.json();
  if (!u?.id) return null;
  const rp = await fetch(`${cfg.url}/rest/v1/ob_profiles?id=eq.${encodeURIComponent(u.id)}&select=id,role,active`, {
    headers: { "apikey": cfg.key, "Authorization": `Bearer ${cfg.key}` },
  });
  if (!rp.ok) return null;
  const linhas = await rp.json();
  const p = linhas?.[0];
  if (!p || p.active !== true || p.role !== "admin") return null;
  return { id: u.id };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Apenas POST é suportado." }, 405);

  try {
    const cfg = sbCfg();
    const auth = req.headers.get("authorization") ?? "";
    if (!/^Bearer\s+/i.test(auth)) throw new HttpError(401, "Sem sessão. Volte a entrar no CRM.");
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    const quem = await utilizadorAdminDoToken(token, cfg);
    if (!quem) throw new HttpError(403, "Só contas Admin activas podem criar novas contas.");

    let corpo: Record<string, unknown>;
    try { corpo = await req.json(); } catch { throw new HttpError(400, "Corpo do pedido tem de ser JSON."); }
    const action = String(corpo.action ?? "create_user").trim();

    if (action === "reset_password") {
      const userId = String(corpo.user_id ?? "").trim();
      const novaPassword = String(corpo.new_password ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new HttpError(400, "user_id inválido.");
      if (!novaPassword || novaPassword.length < 8) throw new HttpError(400, "A nova password tem de ter pelo menos 8 caracteres.");
      const rReset = await fetch(`${cfg.url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: "PUT",
        headers: {
          "apikey": cfg.key,
          "Authorization": `Bearer ${cfg.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password: novaPassword }),
      });
      if (!rReset.ok) {
        const corpoErro = await rReset.json().catch(() => ({}));
        const msg = (corpoErro && (corpoErro.msg || corpoErro.message || corpoErro.error_description)) || `HTTP ${rReset.status}`;
        throw new HttpError(502, `Falha ao repor a password: ${msg}`);
      }
      return json({ ok: true, user_id: userId }, 200);
    }

    if (action !== "create_user") throw new HttpError(400, "action inválida. Use: create_user | reset_password.");

    const email = String(corpo.email ?? "").trim().toLowerCase();
    const password = String(corpo.password ?? "");
    const fullName = String(corpo.full_name ?? "").trim();
    const role = String(corpo.role ?? "").trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Email inválido.");
    if (!password || password.length < 8) throw new HttpError(400, "Password tem de ter pelo menos 8 caracteres.");
    if (!fullName) throw new HttpError(400, "Falta o nome completo.");
    if (!PAPEIS_PERMITIDOS.includes(role)) {
      throw new HttpError(400, `Papel inválido. Use um de: ${PAPEIS_PERMITIDOS.join(", ")}.`);
    }

    // 1) Cria o utilizador no Supabase Auth (Admin API — só acessível com a
    // service_role key, que nunca sai desta função).
    const rCriar = await fetch(`${cfg.url}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        "apikey": cfg.key,
        "Authorization": `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: fullName } }),
    });
    const corpoCriar = await rCriar.json().catch(() => ({}));
    if (!rCriar.ok) {
      const msg = (corpoCriar && (corpoCriar.msg || corpoCriar.message || corpoCriar.error_description)) || `HTTP ${rCriar.status}`;
      throw new HttpError(rCriar.status === 422 ? 409 : 502, `Falha ao criar utilizador no Supabase Auth: ${msg}`);
    }
    const novoId = corpoCriar?.id;
    if (!novoId) throw new HttpError(502, "Supabase Auth não devolveu o id do novo utilizador.");

    // 2) Cria o perfil correspondente em ob_profiles — é isto que dá acesso
    // real ao CRM (login sem perfil activo é recusado, ver crmRealLogin()).
    // crmValidateSessionAndEnter() recusa o login de qualquer perfil sem
    // department preenchido — por isso tem sempre de vir com um valor aqui,
    // nunca null (foi o que bloqueou a Carolina Martins, 23/09/2026).
    const DEPARTAMENTO_POR_PAPEL: Record<string, string> = {
      administrativo: "Administrativo",
      comercial: "Comercial",
      financeiro: "Financeiro",
      manager: "Direção",
    };
    const departamento = String(corpo.department ?? "").trim() || DEPARTAMENTO_POR_PAPEL[role] || "Geral";
    const rPerfil = await fetch(`${cfg.url}/rest/v1/ob_profiles`, {
      method: "POST",
      headers: {
        "apikey": cfg.key,
        "Authorization": `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
      },
      body: JSON.stringify({ id: novoId, full_name: fullName, email, role, department: departamento, active: true }),
    });
    if (!rPerfil.ok) {
      const corpoErro = await rPerfil.text();
      // Utilizador Auth já foi criado — não o apaga sozinho (evitar apagar
      // algo às cegas); devolve o erro claro para decisão manual.
      throw new HttpError(502, `Utilizador criado no Auth (id ${novoId}), mas falhou a criar o perfil em ob_profiles: ${corpoErro}. Resolver manualmente — não repetir sem verificar primeiro.`);
    }

    return json({ ok: true, id: novoId, email, full_name: fullName, role }, 200);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    return json({ error: "Erro interno ao criar utilizador." }, 500);
  }
});
