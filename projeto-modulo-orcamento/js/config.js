// ═══════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO — Módulo de Orçamentos OpportunityBox
// ═══════════════════════════════════════════════════════════════════
// ⚠️ NUNCA colocar chaves reais neste ficheiro nem fazer commit delas.
// As chaves reais serão inseridas pela OpportunityBox na integração final.
// Enquanto os placeholders estiverem vazios, o módulo funciona apenas
// com localStorage (modo offline) — suficiente para todo o desenvolvimento.

var OB_CONFIG = {
  // URL do projecto Supabase (ex: https://xxxxxxxx.supabase.co)
  SUPABASE_URL: '',

  // Chave pública "anon" do Supabase (NÃO usar a service_role)
  SUPABASE_ANON_KEY: '',

  // Nome da tabela de orçamentos no Supabase
  SUPABASE_TABELA: 'ob_orcamentos',

  // Dados da empresa usados no PDF e nas mensagens
  EMPRESA: {
    nome: 'OPPORTUNITYBOX – DESIGN & STORE CONCEPT UNIPESSOAL LDA',
    nipc: 'NIPC 510 575 170',
    morada: 'Parque Industrial Alcopark I, Armazém E, 2705-778 Terrugem',
    site: 'www.opportunitybox.pt',
    email: 'geral@opportunitybox.pt',
    tel: '+351 215 874 779',
    slogan: 'BETTER · FASTER · STRONGER'
  }
};

// true quando o Supabase está configurado; caso contrário fica em modo local
function obSupabaseAtivo(){
  return !!(OB_CONFIG.SUPABASE_URL && OB_CONFIG.SUPABASE_ANON_KEY);
}
