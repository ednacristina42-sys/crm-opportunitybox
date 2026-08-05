// ============================================================
// ob-followup-email — Fase 1 do Follow-up (Email), MODO SIMULAÇÃO.
//
// Esta função NUNCA chama a Resend nem qualquer serviço de envio —
// não há sequer código para isso aqui. Só decide o que faria e regista
// em ob_followup_emails com estado='simulado'. Sem cron associado,
// sem deploy em produção nesta fase.
//
// Regra importante sobre deduplicação: uma linha 'simulado' nunca
// bloqueia um envio real futuro — a verificação de "já tratado
// recentemente" (jaTratadoRecentemente) só considera estado='enviado'.
// A restrição de 1-por-dia na tabela é só para não duplicar a MESMA
// avaliação no MESMO dia, não para impedir ações em dias diferentes.
//
// Elegibilidade histórica: um Pendente só entra na simulação se
// dt >= CUTOFF_HISTORICO OU se já foi reativado (ob_orcamento_triagem
// .reativado = true). Pendentes antigos e nunca reativados são
// excluídos como histórico, antes de qualquer outra verificação.
// ============================================================

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ESTADO_ELEGIVEL = 'Pendente';
const VALOR_ALTO_LIMIAR = 10000;
const JANELA_DEDUP_DIAS = 7;
const CUTOFF_HISTORICO = '2026-07-01';

type Orcamento = {
  id: string; num: string; cli: string; vendedor: string; st: string;
  val: number | null; email: string | null; cliemail: string | null; dt: string | null;
};
type Triagem = { orcamento_id: string; classificacao: string | null; reativado: boolean | null };
type RegistoExistente = { estado: string; data_referencia: string };

function emailValido(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

// `dt` vem como texto 'DD/MM/YYYY' (confirmado por leitura direta do
// schema — não é um date nativo). Só converte se o formato bater
// certo; um dt em formato inesperado nunca é tratado como elegível
// por omissão — fica de fora até haver evidência real do formato.
function dtParaISO(dt: string | null | undefined): string | null {
  if (!dt) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dt.trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo}-${d}`;
}

function elegivelPorHistorico(o: Orcamento, triagem: Triagem | undefined): boolean {
  if (triagem?.reativado === true) return true;
  const iso = dtParaISO(o.dt);
  if (!iso) return false;
  return iso >= CUTOFF_HISTORICO;
}

// Sem coluna de consentimento na base de dados hoje (confirmado por
// leitura direta do schema: ob_orcamentos/ob_clientes não têm nenhum
// campo de opt-in/opt-out). Não há nada real para validar ainda — a
// função sinaliza isso no relatório em vez de fingir que validou.
const CONSENTIMENTO_TEM_COLUNA = false;

function escolherModelo(o: Orcamento, triagem: Triagem | undefined): string {
  if ((o.val ?? 0) >= VALOR_ALTO_LIMIAR) return 'valor_alto_personalizado';
  const classificacao = triagem?.classificacao ?? null;
  if (classificacao === 'ainda_em_negociacao' || classificacao === 'contactar_novamente') return 'reativacao';
  if (classificacao === 'sem_resposta' || classificacao === 'nao_adjudicado' || classificacao === 'duplicado') return 'lembrete_intermedio';
  return 'primeiro_lembrete';
}

function assuntoDoModelo(modelo: string, o: Orcamento): string {
  switch (modelo) {
    case 'valor_alto_personalizado': return `${o.cli} — sobre o seu orçamento ${o.num}`;
    case 'reativacao': return `${o.cli}, continuamos disponíveis para o orçamento ${o.num}`;
    case 'lembrete_intermedio': return `Novidades sobre o seu orçamento ${o.num}`;
    default: return `Follow-up do orçamento ${o.num}`;
  }
}

function dataMenosNDias(base: string, dias: number): string {
  const d = new Date(base + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

async function sbFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase REST ${path} falhou: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

Deno.serve(async () => {
  const hoje = new Date().toISOString().slice(0, 10);
  const desde = dataMenosNDias(hoje, JANELA_DEDUP_DIAS);

  const orcamentosTodos: Orcamento[] = await sbFetch(
    `ob_orcamentos?st=eq.${ESTADO_ELEGIVEL}&select=id,num,cli,vendedor,st,val,email,cliemail,dt`
  );
  const triagens: Triagem[] = await sbFetch(
    `ob_orcamento_triagem?select=orcamento_id,classificacao,reativado`
  );
  const triagemPorOrc = new Map(triagens.map((t) => [t.orcamento_id, t]));

  const orcamentos = orcamentosTodos.filter((o) => elegivelPorHistorico(o, triagemPorOrc.get(o.id)));
  const excluidosHistorico = orcamentosTodos.length - orcamentos.length;

  const resultado = {
    executado_em: new Date().toISOString(),
    modo: 'simulacao',
    data_referencia: hoje,
    cutoff_historico: CUTOFF_HISTORICO,
    total_pendentes: orcamentosTodos.length,
    excluidos_historico: excluidosHistorico,
    total_avaliados: orcamentos.length,
    simulados: 0,
    ignorados: 0,
    motivos_ignorado: {} as Record<string, number>,
    distribuicao_modelos: {
      primeiro_lembrete: 0, lembrete_intermedio: 0,
      valor_alto_personalizado: 0, reativacao: 0,
    } as Record<string, number>,
    avisos: [] as string[],
    detalhe: [] as Record<string, unknown>[],
  };

  if (!CONSENTIMENTO_TEM_COLUNA) {
    resultado.avisos.push(
      'Não existe coluna de consentimento em ob_orcamentos/ob_clientes — o email só foi validado quanto ao formato, não quanto a consentimento real.'
    );
  }

  async function registarIgnorado(o: Orcamento, motivo: string) {
    resultado.ignorados++;
    resultado.motivos_ignorado[motivo] = (resultado.motivos_ignorado[motivo] || 0) + 1;
    resultado.detalhe.push({ orcamento_id: o.id, estado: 'ignorado', motivo });
    try {
      await sbFetch('ob_followup_emails', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates' },
        body: JSON.stringify({
          orcamento_id: o.id, modelo: null, destinatario: o.cliemail || o.email || '(sem email)',
          assunto: '(não aplicável — ignorado)', estado: 'ignorado', motivo_ignorado: motivo,
          data_referencia: hoje,
        }),
      });
    } catch (e) {
      resultado.avisos.push(`Falha ao registar ignorado para ${o.id}: ${(e as Error).message}`);
    }
  }

  for (const o of orcamentos) {
    const email = (o.cliemail || o.email || '').trim();

    if (!emailValido(email)) {
      await registarIgnorado(o, 'email_invalido');
      continue;
    }

    const modelo = escolherModelo(o, triagemPorOrc.get(o.id));

    let existentes: RegistoExistente[] = [];
    try {
      existentes = await sbFetch(
        `ob_followup_emails?orcamento_id=eq.${encodeURIComponent(o.id)}&modelo=eq.${modelo}&data_referencia=gte.${desde}&select=estado,data_referencia`
      );
    } catch (e) {
      resultado.avisos.push(`Falha ao consultar histórico de ${o.id}: ${(e as Error).message}`);
    }

    // Só 'enviado' bloqueia — 'simulado' nunca impede uma ação futura real.
    const jaEnviadoRecentemente = existentes.some((r) => r.estado === 'enviado');
    if (jaEnviadoRecentemente) {
      await registarIgnorado(o, 'ja_enviado_recentemente');
      continue;
    }

    const assunto = assuntoDoModelo(modelo, o);

    try {
      await sbFetch('ob_followup_emails', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates' },
        body: JSON.stringify({
          orcamento_id: o.id, modelo, destinatario: email, assunto,
          estado: 'simulado', data_referencia: hoje,
        }),
      });
      resultado.simulados++;
      resultado.distribuicao_modelos[modelo] = (resultado.distribuicao_modelos[modelo] || 0) + 1;
      resultado.detalhe.push({ orcamento_id: o.id, estado: 'simulado', modelo, destinatario: email });
    } catch (e) {
      resultado.avisos.push(`Falha ao registar simulação de ${o.id}: ${(e as Error).message}`);
    }
  }

  return new Response(JSON.stringify(resultado, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
});
