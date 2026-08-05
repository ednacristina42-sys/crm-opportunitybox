// Fase 1 — Follow-up automático, MODO SIMULAÇÃO EXCLUSIVAMENTE.
//
// Esta função nunca escreve na base de dados — só lê ob_orcamentos e
// ob_crm_dados (chave='ob-crm-atividades') e devolve um relatório JSON do
// que SERIA proposto se estivesse em modo real. Não há tabela de destino
// ainda (ob_followup_acoes não existe), não há cron configurado, não há
// política RLS nova — nada disto foi criado nesta etapa.
//
// Usa SUPABASE_SERVICE_ROLE_KEY porque corre inteiramente no servidor
// (nunca é exposta ao browser) e precisa de ver todos os 577 orçamentos,
// não só os de um comercial — é o mesmo padrão de qualquer Edge Function
// agendada. O client-side do CRM continua, como sempre, a nunca usar
// service_role.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ESTADOS_TERMINAIS = ["Aprovado", "Faturado", "Cancelado"];
const TIPOS_CONTACTO = ["whatsapp", "chamada", "email"]; // comparação em minúsculas

const FAIXAS_PRIORIDADE: Array<{ min: number; key: string }> = [
  { min: 30, key: "revisao_perda" },
  { min: 14, key: "critica" },
  { min: 7, key: "alta" },
  { min: 3, key: "normal" },
  { min: 1, key: "lembrete" },
];

interface Orcamento {
  id: string;
  num: string | null;
  cli: string | null;
  owner_id: string | null;
  st: string | null;
  email: string | null;
  cliemail: string | null;
  cliwa: string | null;
  dt: string | null;
}

interface Atividade {
  tipo?: unknown;
  ts?: unknown;
  orcId?: unknown;
  leadId?: unknown;
}

interface DetalheOrcamento {
  id: string;
  num: string | null;
  cliente: string | null;
  owner_id: string | null;
  estado: string | null;
  email: string | null;
  cliemail: string | null;
  cliwa: string | null;
  data_referencia: string | null; // ISO
  origem_data: "atividade" | "dt_orcamento" | null;
  ultima_atividade_valida: { tipo: string; ts: string } | null;
  dias_sem_contacto: number | null;
  prioridade_calculada: string | null; // faixa de dias, informativa
  tipo_proposto: string | null; // o que a rotina realmente proporia
  motivo: string;
  categoria: string; // bucket do relatório (ver baixo)
}

function contactoValido(email: string | null, cliemail: string | null, cliwa: string | null): boolean {
  const emailValido = (v: string | null) => !!v && /\S+@\S+\.\S+/.test(v.trim());
  const telValido = (v: string | null) => !!v && (v.match(/\d/g) || []).length >= 6;
  return emailValido(email) || emailValido(cliemail) || telValido(cliwa);
}

// dt vem sempre como "DD/MM/AAAA" (confirmado: 577/577 dos orçamentos reais
// batem neste formato) — mas tratado defensivamente, nunca assumido às cegas.
function parseDtPtBr(dt: string | null): Date | null {
  if (!dt) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dt.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  return isNaN(d.getTime()) ? null : d;
}

function diasEntre(data: Date, agora: Date): number {
  return Math.floor((agora.getTime() - data.getTime()) / 86400000);
}

function prioridadePorDias(dias: number): string {
  for (const faixa of FAIXAS_PRIORIDADE) {
    if (dias >= faixa.min) return faixa.key;
  }
  return dias > 0 ? "sem_acao" : "sem_acao";
}

async function fetchOrcamentos(): Promise<Orcamento[]> {
  const url =
    `${SUPABASE_URL}/rest/v1/ob_orcamentos?deleted_at=is.null` +
    `&select=id,num,cli,owner_id,st,email,cliemail,cliwa,dt`;
  const r = await fetch(url, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!r.ok) throw new Error(`Falha ao ler ob_orcamentos: ${r.status} ${await r.text()}`);
  return await r.json();
}

async function fetchAtividadesBrutas(): Promise<unknown> {
  const url = `${SUPABASE_URL}/rest/v1/ob_crm_dados?chave=eq.ob-crm-atividades&select=dados`;
  const r = await fetch(url, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!r.ok) throw new Error(`Falha ao ler ob_crm_dados: ${r.status} ${await r.text()}`);
  const rows = await r.json();
  if (!rows.length) return [];
  return rows[0].dados;
}

// Valida o JSONB linha a linha — nunca assume que está bem formado.
// Devolve só as atividades utilizáveis (com tipo+ts+identificador) e a
// contagem de entradas com formato inválido.
function validarAtividades(dadosBrutos: unknown): {
  validas: Array<{ tipo: string; ts: string; orcId: string | null; leadId: string | null }>;
  errosFormato: number;
  tiposEncontrados: Record<string, number>;
} {
  const tiposEncontrados: Record<string, number> = {};
  if (!Array.isArray(dadosBrutos)) {
    return { validas: [], errosFormato: 1, tiposEncontrados };
  }
  const validas: Array<{ tipo: string; ts: string; orcId: string | null; leadId: string | null }> = [];
  let errosFormato = 0;
  for (const item of dadosBrutos as Atividade[]) {
    if (!item || typeof item !== "object") { errosFormato++; continue; }
    const tipo = typeof item.tipo === "string" ? item.tipo : null;
    const ts = typeof item.ts === "string" ? item.ts : null;
    const orcId = item.orcId != null ? String(item.orcId) : null;
    const leadId = item.leadId != null ? String(item.leadId) : null;
    if (!tipo || !ts || isNaN(new Date(ts).getTime()) || (!orcId && !leadId)) {
      errosFormato++;
      continue;
    }
    tiposEncontrados[tipo] = (tiposEncontrados[tipo] || 0) + 1;
    validas.push({ tipo, ts, orcId, leadId });
  }
  return { validas, errosFormato, tiposEncontrados };
}

Deno.serve(async () => {
  const agora = new Date();
  const orcamentos = await fetchOrcamentos();
  const atividadesBrutas = await fetchAtividadesBrutas();
  const { validas: atividades, errosFormato, tiposEncontrados } = validarAtividades(atividadesBrutas);

  // Só contactos reais reiniciam o contador — nota/criado/estado ficam de
  // fora deliberadamente (confirmados nos dados reais como eventos de
  // sistema, não contactos com o cliente).
  const atividadesDeContacto = atividades.filter((a) =>
    TIPOS_CONTACTO.includes(a.tipo.toLowerCase())
  );

  // Nota conhecida: o mapeamento por lead (x.leadId===orc.leadId) usado no
  // frontend não é replicado aqui porque ob_orcamentos não tem coluna
  // leadId própria nesta base — só o mapeamento por orcId===num está
  // implementado. Isto pode divergir do ecrã Follow-up nalguns casos raros
  // em que a única atividade de um orçamento foi registada no lead ligado
  // a ele. Fica reportado explicitamente na comparação manual, não escondido.
  const atividadesPorOrcNum = new Map<string, typeof atividadesDeContacto>();
  for (const a of atividadesDeContacto) {
    if (!a.orcId) continue;
    const lista = atividadesPorOrcNum.get(a.orcId) || [];
    lista.push(a);
    atividadesPorOrcNum.set(a.orcId, lista);
  }

  const detalhes: DetalheOrcamento[] = [];
  const acoesPropostas: Array<{ id: string; num: string | null; tipo_proposto: string; motivo: string }> = [];

  const contagem = {
    total: orcamentos.length,
    ativos: 0,
    terminais: 0,
    distribuicao_estado: {} as Record<string, number>,
    distribuicao_prioridade: {} as Record<string, number>,
    distribuicao_tipo_proposto: {} as Record<string, number>,
    total_completar_dados: 0,
    total_sem_owner: 0,
    total_data_invalida: 0,
    total_terminal_ignorado: 0,
  };

  for (const orc of orcamentos) {
    const estado = orc.st || "(sem estado)";
    contagem.distribuicao_estado[estado] = (contagem.distribuicao_estado[estado] || 0) + 1;

    const base = {
      id: orc.id,
      num: orc.num,
      cliente: orc.cli,
      owner_id: orc.owner_id,
      estado: orc.st,
      email: orc.email,
      cliemail: orc.cliemail,
      cliwa: orc.cliwa,
    };

    if (ESTADOS_TERMINAIS.includes(orc.st || "")) {
      contagem.terminais++;
      contagem.total_terminal_ignorado++;
      detalhes.push({
        ...base,
        data_referencia: null,
        origem_data: null,
        ultima_atividade_valida: null,
        dias_sem_contacto: null,
        prioridade_calculada: null,
        tipo_proposto: null,
        motivo: "Estado terminal (" + orc.st + ") — fora da sequência de follow-up",
        categoria: "ignorado_terminal",
      });
      continue;
    }
    contagem.ativos++;

    if (!orc.owner_id) {
      contagem.total_sem_owner++;
      detalhes.push({
        ...base,
        data_referencia: null,
        origem_data: null,
        ultima_atividade_valida: null,
        dias_sem_contacto: null,
        prioridade_calculada: null,
        tipo_proposto: null,
        motivo: "Sem owner_id — nenhuma ação automática sem responsável",
        categoria: "ignorado_sem_owner",
      });
      continue;
    }

    // Última atividade de contacto válida para este orçamento (por num).
    const numOrc = orc.num || orc.id;
    const listaAtiv = atividadesPorOrcNum.get(numOrc) || [];
    let ultimaAtividade: { tipo: string; ts: string } | null = null;
    for (const a of listaAtiv) {
      if (!ultimaAtividade || new Date(a.ts) > new Date(ultimaAtividade.ts)) {
        ultimaAtividade = { tipo: a.tipo, ts: a.ts };
      }
    }

    let dataReferencia: Date | null = null;
    let origemData: "atividade" | "dt_orcamento" | null = null;
    if (ultimaAtividade) {
      dataReferencia = new Date(ultimaAtividade.ts);
      origemData = "atividade";
    } else {
      const dtParsed = parseDtPtBr(orc.dt);
      if (dtParsed) {
        dataReferencia = dtParsed;
        origemData = "dt_orcamento";
      }
    }

    if (!dataReferencia) {
      contagem.total_data_invalida++;
      detalhes.push({
        ...base,
        data_referencia: null,
        origem_data: null,
        ultima_atividade_valida: null,
        dias_sem_contacto: null,
        prioridade_calculada: null,
        tipo_proposto: null,
        motivo: "Sem atividade e sem dt válido — sem inventar data",
        categoria: "ignorado_data_insuficiente",
      });
      continue;
    }

    const dias = diasEntre(dataReferencia, agora);
    const prioridadeCalculada = dias === 0 ? "sem_acao" : prioridadePorDias(dias);
    contagem.distribuicao_prioridade[prioridadeCalculada] =
      (contagem.distribuicao_prioridade[prioridadeCalculada] || 0) + 1;

    const contactoOk = contactoValido(orc.email, orc.cliemail, orc.cliwa);
    let tipoProposto: string | null;
    let motivo: string;
    let categoria: string;

    if (!contactoOk) {
      tipoProposto = "completar_dados";
      motivo = "Completar os dados de contacto do cliente antes do follow-up";
      categoria = "completar_dados";
      contagem.total_completar_dados++;
    } else if (dias === 0) {
      tipoProposto = null;
      motivo = "Contacto recente, sem necessidade de ação";
      categoria = "sem_acao";
    } else {
      tipoProposto = prioridadeCalculada;
      motivo = dias + " dias sem contacto";
      categoria = "acao_proposta";
    }

    if (tipoProposto) {
      contagem.distribuicao_tipo_proposto[tipoProposto] =
        (contagem.distribuicao_tipo_proposto[tipoProposto] || 0) + 1;
      acoesPropostas.push({ id: orc.id, num: orc.num, tipo_proposto: tipoProposto, motivo });
    }

    detalhes.push({
      ...base,
      data_referencia: dataReferencia.toISOString(),
      origem_data: origemData,
      ultima_atividade_valida: ultimaAtividade,
      dias_sem_contacto: dias,
      prioridade_calculada: prioridadeCalculada,
      tipo_proposto: tipoProposto,
      motivo,
      categoria,
    });
  }

  const relatorio = {
    executed_at: agora.toISOString(),
    mode: "simulation",
    total_orcamentos: contagem.total,
    total_ativos: contagem.ativos,
    total_terminais: contagem.terminais,
    distribuicao_estado: contagem.distribuicao_estado,
    distribuicao_prioridade_calculada: contagem.distribuicao_prioridade,
    distribuicao_tipo_proposto: contagem.distribuicao_tipo_proposto,
    total_completar_dados: contagem.total_completar_dados,
    total_sem_owner_id: contagem.total_sem_owner,
    total_data_invalida: contagem.total_data_invalida,
    total_terminal_ignorado: contagem.total_terminal_ignorado,
    erros_formato_jsonb: errosFormato,
    atividades_processadas: atividades.length,
    atividades_de_contacto: atividadesDeContacto.length,
    tipos_atividade_encontrados: tiposEncontrados,
    acoes_que_seriam_propostas: acoesPropostas,
    orcamentos_detalhados: detalhes,
    aviso_limitacao:
      "Correspondência de atividades feita só por orcId===num; atividades " +
      "registadas apenas no lead ligado (leadId) não são consideradas nesta " +
      "simulação — ver nota no código.",
  };

  return new Response(JSON.stringify(relatorio, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
});
