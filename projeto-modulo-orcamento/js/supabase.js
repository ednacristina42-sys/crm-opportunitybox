// ═══════════════════════════════════════════════════════════════════
// SINCRONIZAÇÃO SUPABASE — tabela public.ob_orcamentos
// ═══════════════════════════════════════════════════════════════════
// Este ficheiro replica exactamente o mecanismo de sincronização do CRM
// principal (funções _sbOrcUpsert / _sbOrcLoadAll). Sem chaves configuradas
// em config.js, todas as funções degradam graciosamente para modo local.

function _sbOrcHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': OB_CONFIG.SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + OB_CONFIG.SUPABASE_ANON_KEY,
    'Prefer': 'return=representation'
  };
}

// Grava/actualiza um orçamento no Supabase (upsert pela coluna id = num)
async function _sbOrcUpsert(orc) {
  if (!obSupabaseAtivo()) return; // modo local — nada a fazer
  try {
    var row = {
      id: orc.num || orc.id || ('ORC-' + Date.now()),
      num: orc.num, cli: orc.cli, vendedor: orc.vendedor || '', email: orc.email || '',
      st: orc.st || 'Pendente', stc: orc.stc || 'ba',
      dt: orc.dt || orc.data || '', data: orc.data || orc.dt || '',
      prazo: orc.prazo || '', morada: orc.morada || '', nif: orc.nif || '',
      val: orc.totais ? orc.totais.total : (orc.val || 0),
      linhas: orc.linhas || [], totais: orc.totais || {},
      obs: orc.obs || '',
      cliemail: orc.cliEmail || '', cliwa: orc.cliWA || '',
      pagamento50: orc.pagamento50 || false, sinal: orc.sinal || null, saldo: orc.saldo || null,
      extra: { dtProducao: orc.dtProducao, aprovado_em: orc.aprovado_em, aprovado_por: orc.aprovado_por }
    };
    await fetch(OB_CONFIG.SUPABASE_URL + '/rest/v1/' + OB_CONFIG.SUPABASE_TABELA + '?on_conflict=id', {
      method: 'POST', headers: _sbOrcHeaders(), body: JSON.stringify(row)
    });
  } catch (e) { console.warn('[SB-ORC] upsert falhou:', e); }
}

// Carrega todos os orçamentos do Supabase (máx. 2000, mais recentes primeiro)
async function _sbOrcLoadAll() {
  if (!obSupabaseAtivo()) return null;
  try {
    var r = await fetch(OB_CONFIG.SUPABASE_URL + '/rest/v1/' + OB_CONFIG.SUPABASE_TABELA + '?order=created_at.desc&limit=2000', {
      headers: { 'apikey': OB_CONFIG.SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + OB_CONFIG.SUPABASE_ANON_KEY }
    });
    if (!r.ok) return null;
    var rows = await r.json();
    return rows.map(function(row) {
      return {
        num: row.num, cli: row.cli, vendedor: row.vendedor, email: row.email,
        st: row.st, stc: row.stc, dt: row.dt, data: row.data,
        prazo: row.prazo, morada: row.morada, nif: row.nif,
        val: row.val, linhas: row.linhas || [], totais: row.totais || {},
        obs: row.obs,
        cliEmail: row.cliemail, cliWA: row.cliwa,
        pagamento50: row.pagamento50, sinal: row.sinal, saldo: row.saldo,
        dtProducao: (row.extra || {}).dtProducao,
        aprovado_em: (row.extra || {}).aprovado_em,
        aprovado_por: (row.extra || {}).aprovado_por
      };
    });
  } catch (e) { console.warn('[SB-ORC] load falhou:', e); return null; }
}
