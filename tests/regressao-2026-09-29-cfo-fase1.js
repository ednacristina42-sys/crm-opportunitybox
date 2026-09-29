// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — Dashboard CFO, Fase 1 (29/09/2026): 12 métricas
// pedidas pela Edna, calculadas automaticamente de TOConline/TES_RECEBER/
// TES_CONTAS/Fecho de Ordenados/Despesas de Funcionários — nunca lançadas
// manualmente. Cobre, sem tocar em rede nem no Supabase real:
//
//   1. finTotaisMesReal() — custoFolha soma folhaBruto+folhaSSEmpresa de
//      uma entrada TES_CONTAS "Salários — <Mês>" do mês alvo; é 0 com
//      folhaIndisponivel=true quando não há entrada para esse mês, ou a
//      entrada é anterior a esta funcionalidade (sem esses campos).
//   2. custoOutros/custoContas exclui a entrada "Salários" (nunca duplica
//      com custoFolha) — confirma que uma soma "à antiga" (contando
//      Salários também em custoOutros) daria um total errado.
//   3. receitaRecebida soma o total inteiro de faturas 'Recebido' e só
//      valorRecebido de faturas 'Recebido Parcial', filtradas por
//      dataRec no mês alvo, excluindo NC.
//   4. despCalcularTotaisMes(ano, mes) devolve um resultado diferente e
//      correcto para um mês passado vs. o mês actual, com dados mock a
//      cobrir dois meses diferentes, e nunca interfere com
//      despCalcularTotais() (a versão não-parametrizada, presa a "agora").
//
// Corre com: node tests/regressao-2026-09-29-cfo-fase1.js
// Sem dependências externas — só Node core (fs, vm, assert).
// ══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

let passou = 0, falhou = 0;
function teste(nome, fn) {
  try { fn(); console.log('  ok  — ' + nome); passou++; }
  catch (e) { console.log('FALHA — ' + nome + '\n        ' + (e && e.stack)); falhou++; }
}

// ── Extrai o corpo de uma função "function NOME(...) { ... }" do index.html
// por contagem de chavetas (mesma técnica de tests/regressao-2026-09-24.js).
function extrairFuncao(nome) {
  const marcador = 'function ' + nome + '(';
  const inicio = html.indexOf(marcador);
  if (inicio === -1) throw new Error('função "' + nome + '" não encontrada em index.html');
  let i = html.indexOf('{', inicio);
  let profundidade = 0, fim = -1;
  for (; i < html.length; i++) {
    if (html[i] === '{') profundidade++;
    else if (html[i] === '}') { profundidade--; if (profundidade === 0) { fim = i + 1; break; } }
  }
  if (fim === -1) throw new Error('não fechou as chavetas de "' + nome + '"');
  return html.slice(inicio, fim);
}

// finTotaisMesReal() depende de finParseVenc(), que por sua vez depende de
// parseVencTes() (definida na Tesouraria) — as três precisam de estar no
// mesmo contexto vm para o teste correr sem simular globals a mais.
const SRC_FIN_TOTAIS = [
  extrairFuncao('parseVencTes'),
  extrairFuncao('finParseVenc'),
  extrairFuncao('finTotaisMesReal'),
].join('\n');

const SRC_DESP_MES = extrairFuncao('despCalcularTotaisMes');
const SRC_DESP_ORIG = extrairFuncao('despCalcularTotais');

function correFinTotaisMesReal(ano, mes, globals) {
  const ctx = Object.assign({ console, FIN_MESES: ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'] }, globals);
  vm.createContext(ctx);
  vm.runInContext(SRC_FIN_TOTAIS + '\n_RESULT = finTotaisMesReal(_ANO, _MES);', Object.assign(ctx, { _ANO: ano, _MES: mes }));
  return ctx._RESULT;
}

function correDespCalcularTotaisMes(ano, mes, globals) {
  const ctx = Object.assign({ console }, globals);
  vm.createContext(ctx);
  vm.runInContext(SRC_DESP_MES + '\n_RESULT = despCalcularTotaisMes(_ANO, _MES);', Object.assign(ctx, { _ANO: ano, _MES: mes }));
  return ctx._RESULT;
}

function correDespCalcularTotaisOriginal(globals) {
  // despCalcularTotais() lê `new Date()` internamente — corre no
  // contexto vm normalmente, sem mockar a data (é suposto ficar preso a
  // "agora": o próprio comportamento que o teste [4] confirma que não
  // muda com a introdução da nova função irmã).
  const ctx = Object.assign({ console }, globals);
  vm.createContext(ctx);
  vm.runInContext(SRC_DESP_ORIG + '\n_RESULT = despCalcularTotais();', ctx);
  return ctx._RESULT;
}

console.log('\n[1] finTotaisMesReal() — custoFolha (folha salarial completa: bruto + SS empresa)');
{
  teste('soma folhaBruto+folhaSSEmpresa da entrada "Salários — <Mês>" do mês alvo', () => {
    const TES_CONTAS = [
      { id: 'sal-1', descricao: 'Salários — Setembro 2026', categoria: 'Salários', estado: 'Pendente', data: '29/09/2026', dataPagamento: null, valor: 8000, folhaBruto: 10500, folhaSSEmpresa: 2493.75 },
    ];
    const r = correFinTotaisMesReal(2026, 9, { TES_RECEBER: [], TES_CONTAS, FIN_DESPESAS: [], EC_DESPESAS_APP: [], TES_COMPRAS_TOCO: null });
    assert.strictEqual(r.folhaIndisponivel, false);
    assert.strictEqual(r.custoFolha, 10500 + 2493.75);
  });
  teste('sem entrada "Salários" para o mês alvo — custoFolha=0, folhaIndisponivel=true', () => {
    const r = correFinTotaisMesReal(2026, 9, { TES_RECEBER: [], TES_CONTAS: [], FIN_DESPESAS: [], EC_DESPESAS_APP: [], TES_COMPRAS_TOCO: null });
    assert.strictEqual(r.custoFolha, 0);
    assert.strictEqual(r.folhaIndisponivel, true);
  });
  teste('entrada "Salários" existe mas é anterior a esta funcionalidade (sem folhaBruto/folhaSSEmpresa) — custoFolha=0, folhaIndisponivel=true', () => {
    const TES_CONTAS = [
      { id: 'sal-old', descricao: 'Salários — Setembro 2026', categoria: 'Salários', estado: 'Paga', dataPagamento: '05/09/2026', valor: 8000 },
    ];
    const r = correFinTotaisMesReal(2026, 9, { TES_RECEBER: [], TES_CONTAS, FIN_DESPESAS: [], EC_DESPESAS_APP: [], TES_COMPRAS_TOCO: null });
    assert.strictEqual(r.custoFolha, 0);
    assert.strictEqual(r.folhaIndisponivel, true);
  });
  teste('entrada "Salários" de OUTRO mês nunca conta para o mês alvo', () => {
    const TES_CONTAS = [
      { id: 'sal-ago', descricao: 'Salários — Agosto 2026', categoria: 'Salários', estado: 'Paga', dataPagamento: '05/08/2026', valor: 8000, folhaBruto: 10000, folhaSSEmpresa: 2375 },
    ];
    const r = correFinTotaisMesReal(2026, 9, { TES_RECEBER: [], TES_CONTAS, FIN_DESPESAS: [], EC_DESPESAS_APP: [], TES_COMPRAS_TOCO: null });
    assert.strictEqual(r.custoFolha, 0);
    assert.strictEqual(r.folhaIndisponivel, true);
  });
}

console.log('\n[2] custoOutros/custoContas — exclui Salários (nunca duplica com custoFolha)');
{
  teste('uma conta "Salários" Paga no mês NUNCA entra em custoOutros/custoContas — só em custoFolha', () => {
    const TES_CONTAS = [
      { id: 'sal-1', descricao: 'Salários — Setembro 2026', categoria: 'Salários', estado: 'Paga', dataPagamento: '30/09/2026', valor: 8000, folhaBruto: 10500, folhaSSEmpresa: 2493.75 },
      { id: 'aluguer', descricao: 'Aluguer armazém', categoria: 'Instalações', estado: 'Paga', dataPagamento: '05/09/2026', valor: 1200 },
    ];
    const r = correFinTotaisMesReal(2026, 9, { TES_RECEBER: [], TES_CONTAS, FIN_DESPESAS: [], EC_DESPESAS_APP: [], TES_COMPRAS_TOCO: null });
    // Comportamento correto: só o Aluguer entra em "outros custos".
    assert.strictEqual(r.custoOutros, 1200);
    assert.strictEqual(r.custoContas, 1200);
    // Comportamento antigo (somar TUDO o que é Paga, incluindo Salários)
    // teria dado 8000+1200=9200 — confirma que a soma "à antiga" estaria errada.
    assert.notStrictEqual(r.custoOutros, 9200, 'somar Salários dentro de "outros custos" duplicaria com custoFolha');
    // custo total = compras(0) + folha(10500+2493.75) + despesas(0) + outros(1200), sem duplicar Salários
    assert.strictEqual(Math.round(r.custo * 100) / 100, Math.round((0 + (10500 + 2493.75) + 0 + 1200) * 100) / 100);
  });
}

console.log('\n[3] receitaRecebida — total inteiro em \'Recebido\', só valorRecebido em \'Recebido Parcial\', exclui NC');
{
  teste('faturas \'Recebido\' contam o total inteiro; \'Recebido Parcial\' só valorRecebido; \'Não Recebido\' não conta; NC excluído', () => {
    const TES_RECEBER = [
      { id: 'F1', tipo: 'FT', estado: 'Recebido', total: 1000, valorLiq: 813, dataRec: '10/09/2026' },
      { id: 'F2', tipo: 'FT', estado: 'Recebido Parcial', total: 2000, valorRecebido: 500, saldoAReceber: 1500, dataRec: '15/09/2026' },
      { id: 'F3', tipo: 'FT', estado: 'Não Recebido', total: 900, dataRec: undefined },
      { id: 'NC1', tipo: 'NC', estado: 'Recebido', total: -300, dataRec: '12/09/2026' },
    ];
    const r = correFinTotaisMesReal(2026, 9, { TES_RECEBER, TES_CONTAS: [], FIN_DESPESAS: [], EC_DESPESAS_APP: [], TES_COMPRAS_TOCO: null });
    assert.strictEqual(r.receitaRecebida, 1000 + 500);
  });
  teste('datas fora do mês alvo não contam, mesmo com estado \'Recebido\'/\'Recebido Parcial\'', () => {
    const TES_RECEBER = [
      { id: 'F1', tipo: 'FT', estado: 'Recebido', total: 1000, dataRec: '10/08/2026' },
      { id: 'F2', tipo: 'FT', estado: 'Recebido Parcial', total: 2000, valorRecebido: 500, saldoAReceber: 1500, dataRec: '15/10/2026' },
    ];
    const r = correFinTotaisMesReal(2026, 9, { TES_RECEBER, TES_CONTAS: [], FIN_DESPESAS: [], EC_DESPESAS_APP: [], TES_COMPRAS_TOCO: null });
    assert.strictEqual(r.receitaRecebida, 0);
  });
}

console.log('\n[4] despCalcularTotaisMes(ano, mes) — mês arbitrário, nunca interfere com despCalcularTotais()');
{
  // Dados mock cobrindo dois meses diferentes (Agosto e Setembro 2026).
  const CRM_DESPESAS = [
    { id: 'd1', data: '2026-08-10', valor: 100, estado: 'approved' },
    { id: 'd2', data: '2026-08-15', valor: 50, estado: 'pending' },
    { id: 'd3', data: '2026-09-05', valor: 300, estado: 'approved' },
    { id: 'd4', data: '2026-09-20', valor: 40, estado: 'rejected' },
  ];
  const EC_DESPESAS_APP = [
    { id: 'e1', occurred_at: '2026-08-12T10:00:00Z', amount_eur: 20, status: 'approved' },
    { id: 'e2', occurred_at: '2026-09-08T10:00:00Z', amount_eur: 75, status: 'approved' },
    { id: 'e3', occurred_at: '2026-09-09T10:00:00Z', amount_eur: 15, status: 'pending' },
  ];

  teste('mês passado (Agosto 2026) — só soma despesas aprovadas de Agosto', () => {
    const r = correDespCalcularTotaisMes(2026, 8, { CRM_DESPESAS, EC_DESPESAS_APP });
    assert.strictEqual(r.totalAprovMes, 100 + 20);
    assert.strictEqual(r.cntAprovMes, 2);
    // totalMes inclui TODOS os estados de Agosto (100 aprovada + 50 pendente + 20 aprovada app)
    assert.strictEqual(r.totalMes, 100 + 50 + 20);
  });
  teste('mês diferente (Setembro 2026) dá um resultado diferente e correcto', () => {
    const r = correDespCalcularTotaisMes(2026, 9, { CRM_DESPESAS, EC_DESPESAS_APP });
    assert.strictEqual(r.totalAprovMes, 300 + 75);
    assert.strictEqual(r.cntAprovMes, 2);
    // rejeitada (40) e pendente (15) entram em totalMes mas não em totalAprovMes
    assert.strictEqual(r.totalMes, 300 + 40 + 75 + 15);
  });
  teste('despCalcularTotais() original continua presa a "agora" (new Date()) e não recebe parâmetros — nunca é alterada por esta adição', () => {
    // A versão original usa `new Date()` internamente: com dados só de
    // Ago/Set 2026, se "agora" (data real da máquina de teste) não for
    // nenhum desses meses, totalMes deve ficar a 0 — comportamento
    // inalterado desde antes desta funcionalidade.
    const hoje = new Date();
    const r = correDespCalcularTotaisOriginal({ CRM_DESPESAS, EC_DESPESAS_APP });
    const estaEmAgoOuSet2026 = (hoje.getFullYear() === 2026 && (hoje.getMonth() === 7 || hoje.getMonth() === 8));
    if (!estaEmAgoOuSet2026) {
      assert.strictEqual(r.totalMes, 0, 'despCalcularTotais() deve continuar a olhar só para o mês real do sistema, nunca para um mês simulado');
    }
    // Confirma que a assinatura não mudou (função continua sem parâmetros úteis).
    assert.strictEqual(typeof r.totalAprov, 'number');
  });
}

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou > 0 ? 1 : 0);
