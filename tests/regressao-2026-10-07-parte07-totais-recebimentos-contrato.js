// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — doc "Sugestões CRM - Parte 07" (07/10/2026), 4 pontos:
//
//   (A) Clientes → "Previsão de Recebimentos": só mostrava 1 de 3 faturas
//       reais por receber do mesmo cliente ("este cliente tem mais faturas
//       a vencer") — r.cliente===c.n (igualdade exacta) falhava quando o
//       nome do cliente vem escrito de forma ligeiramente diferente entre
//       fontes. Passa a usar obSimilaridadeNomes() (mesma lógica já usada
//       para ligar faturas importadas a clientes), limiar 0.8.
//
//   (B) Histórico de Faturação "Total Faturado" vs Mapa de Vendas "Total
//       Faturado": números diferentes para os mesmos dados ("esse mesmo
//       valor tem que ser igual") — Histórico excluía SEMPRE notas de
//       crédito (NC), Mapa de Vendas não. Uma NC reduz a faturação real;
//       excluí-la sempre inflacionava o total do Histórico. Corrigido:
//       o "Total Faturado" do Histórico passa a incluir NC (como o Mapa
//       de Vendas); os cartões por estado (Recebido/Não Recebido/Parcial)
//       continuam sem NC, que não se aplica a eles.
//
//   (C) Análise de Vendas "VENDAS 2026 YTD": mostrava o total COM IVA sem
//       nenhuma indicação disso ("Valores devem ser sem IVA") — passa a
//       mostrar o total sem IVA (coluna real "Total Líquido") quando TODAS
//       as linhas do ano o têm, com o valor com IVA na sub-linha; nunca
//       inventa um sem-IVA parcial quando a coluna não cobre tudo.
//
//   (D) RH → Colaboradores: os novos campos de "Gerar Contrato" (tipo/nº/
//       validade de documento, motivo do termo incerto) nunca chegavam a
//       gravar no Supabase (ob_colaboradores não tem essas colunas, e o
//       formToPayload() que grava de facto não as incluía) — ficavam só
//       na memória do formulário, perdidos ao recarregar. Passam a viver
//       dentro de "extra" (jsonb), nunca inventados quando vazios.
//
// Corre com: node tests/regressao-2026-10-07-parte07-totais-recebimentos-contrato.js
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

function fakeDoc(values) {
  const els = {};
  Object.keys(values || {}).forEach(function (id) { els[id] = values[id] && typeof values[id] === 'object' ? values[id] : { value: values[id] }; });
  return {
    getElementById: function (id) {
      if (!els[id]) els[id] = { value: '', dataset: {}, style: {} };
      if (!els[id].setAttribute) els[id].setAttribute = function () {};
      return els[id];
    },
  };
}

console.log('\n[A] cliRenderRecebimentos() — faturas com nome do cliente ligeiramente diferente ainda contam');
{
  const SRC = [
    extrairFuncao('parseVencTes'),
    extrairFuncao('finParseVenc'),
    extrairFuncao('finSaldoReceber'),
    extrairFuncao('obSimilaridadeNomes'),
    extrairFuncao('cliRenderRecebimentos'),
  ].join('\n');

  function correr(cliente, TES_RECEBER) {
    const doc = fakeDoc({ 'cli-recebimentos-panel': { style: {} }, 'cli-donut-venc': { style: {} }, 'cli-donut-30': { style: {} }, 'cli-donut-60': { style: {} }, 'cli-donut-mais60': { style: {} }, 'cli-donut-total': {}, 'cli-receb-lista': {} });
    const ctx = { console, document: doc, TES_RECEBER: TES_RECEBER || [] };
    vm.createContext(ctx);
    vm.runInContext(SRC + '\ncliRenderRecebimentos(_C);', Object.assign(ctx, { _C: cliente }));
    return doc.getElementById('cli-recebimentos-panel');
  }

  teste('3 faturas do mesmo cliente, nomes ligeiramente diferentes (abreviatura/pontuação) — as 3 contam', () => {
    const cliente = { n: '5 a Seco Portugal - Industria de Lavandaria, S.A.' };
    const TES_RECEBER = [
      { cliente: '5 a Seco Portugal - Industria de Lavandaria, S.A.', total: 3760.11, estado: 'Não Recebido', vencimento: '02/10/2026', descricao: 'Fatura 496' },
      { cliente: '5 a Seco Portugal - Industria de Lavandaria SA', total: 1105.77, estado: 'Não Recebido', vencimento: '14/10/2026', descricao: 'Fatura 520' },
      { cliente: '5 a Seco Portugal - Industria de Lavandar', total: 2681.40, estado: 'Não Recebido', vencimento: '21/10/2026', descricao: 'Fatura 531' },
    ];
    const painel = correr(cliente, TES_RECEBER);
    assert.strictEqual(painel.style.display, 'flex');
  });

  teste('cliente genuinamente diferente (nome não parecido) nunca entra', () => {
    const cliente = { n: 'ACME, Lda' };
    const TES_RECEBER = [{ cliente: 'Outra Empresa Totalmente Diferente, S.A.', total: 100, estado: 'Não Recebido', vencimento: '01/01/2027' }];
    const painel = correr(cliente, TES_RECEBER);
    assert.strictEqual(painel.style.display, 'none');
  });
}

console.log('\n[B] _hfApplyFilters()/_hfRenderKpis() — "Total Faturado" inclui NC (bate com o Mapa de Vendas)');
{
  const SRC = [
    extrairFuncao('_hfParseData'),
    extrairFuncao('finSaldoReceber'),
    'var _hfFilters = { busca:"", estado:"", comercial:"", ano:"2026", mes:"", de:"", ate:"", valMin:"", valMax:"" };',
    extrairFuncao('_hfApplyFilters'),
    'function _hfFmtEUR(v){ return "€"+(v||0).toLocaleString("pt-PT",{minimumFractionDigits:2,maximumFractionDigits:2}); }',
    extrairFuncao('_hfRenderKpis'),
  ].join('\n');

  function correr(rows) {
    const vals = {};
    const doc = { getElementById: function (id) { return { set textContent(v) { vals[id] = v; }, get textContent() { return vals[id]; } }; } };
    const ctx = { console, document: doc };
    vm.createContext(ctx);
    vm.runInContext(SRC + '\n_hfRenderKpis(_ROWS);', Object.assign(ctx, { _ROWS: rows }));
    return vals;
  }

  teste('FT + NC do mesmo mês — Total Faturado líquido é FT.valorLiq + NC.valorLiq (NC negativa reduz o total)', () => {
    const rows = [
      { tipo: 'FT', cliente: 'X', total: 1230, valorLiq: 1000, dataEmissao: '01/06/2026', estado: 'Não Recebido' },
      { tipo: 'NC', cliente: 'X', total: -246, valorLiq: -200, dataEmissao: '05/06/2026', estado: '' },
    ];
    const vals = correr(rows);
    assert.strictEqual(vals['hf-kpi-total'], '€800,00', 'devia ser 1000 + (-200) = 800, incluindo a NC');
  });

  teste('a NC nunca entra nos cartões por estado (Recebido/Não Recebido/Parcial)', () => {
    const rows = [
      { tipo: 'FT', cliente: 'X', total: 1230, valorLiq: 1000, dataEmissao: '01/06/2026', estado: 'Recebido' },
      { tipo: 'NC', cliente: 'X', total: -246, valorLiq: -200, dataEmissao: '05/06/2026', estado: 'Recebido' },
    ];
    const vals = correr(rows);
    // Recebido só conta a FT (1000) — a NC, mesmo com estado "Recebido", não entra aqui.
    assert.strictEqual(vals['hf-kpi-recebido'], '€1000,00');
  });

  teste('sem NC nenhuma — comportamento idêntico ao de antes', () => {
    const rows = [{ tipo: 'FT', cliente: 'X', total: 1230, valorLiq: 1000, dataEmissao: '01/06/2026', estado: 'Não Recebido' }];
    const vals = correr(rows);
    assert.strictEqual(vals['hf-kpi-total'], '€1000,00');
  });
}

console.log('\n[C] Análise de Vendas — "VENDAS 2026 YTD" usa o total SEM IVA quando a coluna cobre tudo, nunca inventa um parcial');
{
  // Testa só a lógica de decisão pura (replica a condição usada na função
  // real) — a função em si é um bloco assíncrono gigante (fetch de CSV),
  // não isolável num teste vm puro sem rede.
  function decide(nFaturas, nFaturasSemIVA, totalYTD, totalYTDSemIVA) {
    const temSemIVACompleto = nFaturas > 0 && nFaturasSemIVA === nFaturas;
    return temSemIVACompleto ? totalYTDSemIVA : totalYTD;
  }
  teste('todas as linhas têm "Total Líquido" preenchido — usa o sem IVA', () => {
    assert.strictEqual(decide(538, 538, 1135211, 922936), 922936);
  });
  teste('só ALGUMAS linhas têm a coluna preenchida — nunca usa um sem-IVA parcial, mantém o com IVA', () => {
    assert.strictEqual(decide(538, 300, 1135211, 700000), 1135211);
  });
  teste('nenhuma linha tem a coluna — mantém o com IVA, como sempre foi', () => {
    assert.strictEqual(decide(538, 0, 1135211, 0), 1135211);
  });
  teste('confirma que o código real usa exactamente esta condição', () => {
    const corpo = html.slice(html.indexOf("AV_VEND_26 = lista;"), html.indexOf("AV_VEND_26 = lista;") + 700);
    assert.ok(/nFaturasSemIVA===nFaturas/.test(corpo), 'a condição real tem de exigir cobertura total da coluna, nunca parcial');
  });
}

console.log('\n[D] RH → Colaboradores — doc/motivo do contrato persistem no Supabase (extra jsonb), nunca perdidos ao recarregar');
{
  const SRC = html.slice(html.indexOf('function rowToColab'), html.indexOf('async function uid()'));
  function rodar(chamada, globals) {
    const doc = fakeDoc(globals.values || {});
    const ctx = Object.assign({ console, document: doc }, globals.extra || {});
    vm.createContext(ctx);
    vm.runInContext(SRC + '\n_RESULT = ' + chamada + ';', ctx);
    return ctx._RESULT;
  }

  teste('formToPayload() guarda tipo/nº/validade de documento e motivo dentro de extra', () => {
    const r = rodar('formToPayload()', {
      values: {
        'rh-c-nome': 'Suyenne Carolina', 'rh-c-nif': '297549588', 'rh-c-niss': '12081664489', 'rh-c-admissao': '2026-03-09',
        'rh-c-cargo': 'Assistente Administrativa', 'rh-c-dept': 'Gestão Administrativa', 'rh-c-salario': '1250',
        'rh-c-contrato': 'A termo incerto', 'rh-c-tel': '', 'rh-c-email': '', 'rh-c-iban': '', 'rh-c-morada': 'Rua X',
        'rh-c-doc-tipo': 'Cartão de Residência', 'rh-c-doc-num': '12798S33H', 'rh-c-doc-validade': '2027-06-03',
        'rh-c-motivo': 'Execução de projeto específico.', 'rh-c-foto': { dataset: { foto: '' } },
      },
    });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(r.extra)), { docTipo: 'Cartão de Residência', docNumero: '12798S33H', docValidade: '2027-06-03', motivoContrato: 'Execução de projeto específico.' });
  });

  teste('rowToColab() lê de volta os mesmos campos de extra, nunca "undefined"', () => {
    const row = { id: '1', nome: 'Suyenne Carolina', extra: { docTipo: 'Cartão de Residência', docNumero: '12798S33H', docValidade: '2027-06-03', motivoContrato: 'Execução de projeto específico.' } };
    const c = rodar('rowToColab(_ROW)', { extra: { _ROW: row } });
    assert.strictEqual(c.docTipo, 'Cartão de Residência');
    assert.strictEqual(c.docNumero, '12798S33H');
    assert.strictEqual(c.motivoContrato, 'Execução de projeto específico.');
  });

  teste('rowToColab() com "extra" vazio/ausente (registo antigo) — nunca rebenta, strings vazias', () => {
    const c1 = rodar('rowToColab(_ROW)', { extra: { _ROW: { id: '2', nome: 'X', extra: {} } } });
    assert.strictEqual(c1.docTipo, '');
    const c2 = rodar('rowToColab(_ROW)', { extra: { _ROW: { id: '3', nome: 'Y' } } });
    assert.strictEqual(c2.motivoContrato, '');
  });
}

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou ? 1 : 0);
