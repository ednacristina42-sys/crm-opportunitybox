// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — doc "CRM - Parte 6" (30/09/2026), 3 pedidos da Edna:
//
//   (A) Clientes → Editar Cliente → "Previsão de Recebimentos": vinha de
//       orçamentos (ob_orcamentos), mas "essa previsão não pode ser
//       preenchida por orçamentos, mas sim por faturas reais!" — e "nem
//       todos os clientes abre o campo". cliRenderRecebimentos() passa a
//       ler TES_RECEBER (faturas reais, nunca NC, nunca 'Recebido'),
//       mesmas fontes/regras de finSaldoReceber()/parseVencTes() já
//       usadas na Tesouraria — o painel aparece sempre que há faturas
//       reais por receber, independente de orçamentos.
//
//   (B) Mapa de Vendas → "Meta Anual": Paulo quer "só o total faturado",
//       nunca mais Orçamentos "Aprovado" (pipeline, valor ainda não
//       faturado) somado por cima.
//
//   (C) Instalações → "Equipa de Montagem" (checklist de colaboradores):
//       mostrava o roster inteiro (todos os departamentos) em vez da
//       lista curada de produção (obColaboradoresProducaoCurada(), já
//       usada no "Responsável" de Obras desde a parte 4).
//
// Corre com: node tests/regressao-2026-10-06-recebimentos-cliente-meta-anual-equipa.js
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

// Um documento falso minimalista: só os ids que cada função realmente lê.
function extrairVar(nome) {
  const re = new RegExp('var\\s+' + nome + '\\s*=.*?;');
  const m = html.match(re);
  if (!m) throw new Error('variável "' + nome + '" não encontrada em index.html');
  return m[0];
}

function fakeDoc(ids) {
  const els = {};
  ids.forEach(function (id) {
    els[id] = { id: id, value: '', textContent: '', innerHTML: '', style: {}, children: [], setAttribute: function () {}, querySelectorAll: function () { return []; } };
  });
  return { getElementById: function (id) { return els[id] || null; }, _els: els };
}

const ANO = new Date().getFullYear();
function dataPT(diasAPartirDeHoje) {
  const d = new Date();
  d.setDate(d.getDate() + diasAPartirDeHoje);
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}

// ── (A) cliRenderRecebimentos() ─────────────────────────────────────────
console.log('\n[A] cliRenderRecebimentos() — faturas reais (TES_RECEBER), nunca orçamentos');
{
  const SRC = [
    extrairFuncao('parseVencTes'),
    extrairFuncao('finParseVenc'),
    extrairFuncao('finSaldoReceber'),
    extrairFuncao('cliRenderRecebimentos'),
  ].join('\n');

  function correr(cliente, TES_RECEBER, orcData) {
    const doc = fakeDoc(['cli-recebimentos-panel', 'cli-donut-venc', 'cli-donut-30', 'cli-donut-60', 'cli-donut-mais60', 'cli-donut-total', 'cli-receb-lista']);
    const ctx = { console, document: doc, TES_RECEBER: TES_RECEBER || [], orcData: orcData || [], _C: cliente };
    vm.createContext(ctx);
    vm.runInContext(SRC + '\ncliRenderRecebimentos(_C);', ctx);
    return doc._els;
  }

  teste('cliente com orçamento "Aprovado" mas SEM nenhuma fatura real — painel fica escondido (nunca mais alimentado por orçamentos)', () => {
    const orcData = [{ cli: 'ACME', st: 'Aprovado', totais: { total: 5000 }, val: dataPT(10), num: 'ORC-1' }];
    const els = correr({ n: 'ACME' }, [], orcData);
    assert.strictEqual(els['cli-recebimentos-panel'].style.display, 'none');
  });

  teste('cliente com fatura real "Não Recebido" vencida — painel aparece, valor vem de finSaldoReceber()', () => {
    const TES_RECEBER = [{ cliente: 'ACME', total: 1000, estado: 'Não Recebido', vencimento: dataPT(-10), descricao: 'Fatura 2026/9' }];
    const els = correr({ n: 'ACME' }, TES_RECEBER, []);
    assert.strictEqual(els['cli-recebimentos-panel'].style.display, 'flex');
    assert.strictEqual(els['cli-donut-total'].textContent, '€' + (1000).toLocaleString('pt-PT'));
  });

  teste('fatura "Recebido Parcial" — usa só o saldo em falta (saldoAReceber), nunca o total inteiro da fatura', () => {
    const TES_RECEBER = [{ cliente: 'ACME', total: 1000, estado: 'Recebido Parcial', saldoAReceber: 300, vencimento: dataPT(5), descricao: 'Fatura X' }];
    const els = correr({ n: 'ACME' }, TES_RECEBER, []);
    assert.strictEqual(els['cli-donut-total'].textContent, '€' + (300).toLocaleString('pt-PT'));
  });

  teste('fatura já "Recebido" — nunca entra na previsão (já foi paga)', () => {
    const TES_RECEBER = [{ cliente: 'ACME', total: 1000, estado: 'Recebido', vencimento: dataPT(5), descricao: 'Fatura paga' }];
    const els = correr({ n: 'ACME' }, TES_RECEBER, []);
    assert.strictEqual(els['cli-recebimentos-panel'].style.display, 'none');
  });

  teste('NC (nota de crédito) nunca entra, mesmo "Não Recebido"', () => {
    const TES_RECEBER = [{ cliente: 'ACME', total: -200, estado: 'Não Recebido', tipo: 'NC', vencimento: dataPT(5) }];
    const els = correr({ n: 'ACME' }, TES_RECEBER, []);
    assert.strictEqual(els['cli-recebimentos-panel'].style.display, 'none');
  });

  teste('fatura de OUTRO cliente nunca aparece na previsão deste', () => {
    const TES_RECEBER = [{ cliente: 'Outro Cliente, Lda', total: 1000, estado: 'Não Recebido', vencimento: dataPT(5) }];
    const els = correr({ n: 'ACME' }, TES_RECEBER, []);
    assert.strictEqual(els['cli-recebimentos-panel'].style.display, 'none');
  });
}

// ── (B) _mvRenderMetaAnual() ────────────────────────────────────────────
console.log('\n[B] _mvRenderMetaAnual() — só total faturado, nunca Orçamentos Aprovados somados por cima');
{
  const SRC = [
    extrairFuncao('_mvParseData'),
    extrairFuncao('_mvFmtEUR'),
    extrairFuncao('_mvFmtPct'),
    extrairFuncao('_mvRenderMetaAnual'),
  ].join('\n');

  function correr(view, _mvTesData) {
    const doc = fakeDoc(['mv-meta-anual-card']);
    const ctx = {
      console, document: doc,
      MV_META_CONFIG: { anual: 1000000, mensal: 83333, porComercial: {} },
      _mvTesData: _mvTesData,
      _mvEnsureTesData: function () { return Promise.resolve(); },
    };
    vm.createContext(ctx);
    vm.runInContext(SRC + '\n_mvRenderMetaAnual(_V);', Object.assign(ctx, { _V: view }));
    return doc._els['mv-meta-anual-card'].innerHTML;
  }

  teste('orçamentos "Aprovado" no pipeline NUNCA somam para o acumulado — só a faturação real conta', () => {
    const view = { isAdmin: true, rows: [{ st: 'Aprovado', totais: { total: 999999 } }] };
    const html1 = correr(view, []); // sem faturação real nenhuma
    assert.ok(html1.indexOf('€0') !== -1 || /€0(?!\d)/.test(html1), 'acumulado devia ser €0 — nada de orçamentos aprovados a inflacionar o valor');
  });

  teste('faturação real do ano conta integralmente (valorLiq, mesma fonte do cartão Total Faturado)', () => {
    const anoAtual = new Date().getFullYear();
    const dataStr = '01/06/' + anoAtual;
    const view = { isAdmin: true, rows: [] };
    const tesData = [{ dataEmissao: dataStr, valorLiq: 123456 }];
    const htmlOut = correr(view, tesData);
    assert.ok(htmlOut.indexOf((123456).toLocaleString('pt-PT')) !== -1, 'o total faturado real (123456) devia aparecer no acumulado');
  });

  teste('subtítulo deixa de mencionar Orçamentos Aprovados', () => {
    const htmlOut = correr({ isAdmin: true, rows: [] }, []);
    assert.ok(htmlOut.indexOf('Orçamentos Aprovados') === -1, 'o texto antigo "Orçamentos Aprovados + Vendas 2026" não devia mais aparecer');
    assert.ok(htmlOut.indexOf('Total Faturado') !== -1);
  });
}

// ── (C) instEquipaAtiva() ────────────────────────────────────────────────
console.log('\n[C] instEquipaAtiva() — "Equipa de Montagem" usa a lista curada de produção, nunca o roster inteiro');
{
  const SRC = [
    extrairFuncao('rhNormalizarNome'),
    extrairFuncao('rhMesmaPessoa'),
    extrairVar('OB_PRODUCAO_COLABS_CURADOS'),
    extrairFuncao('obColaboradoresProducaoCurada'),
    extrairFuncao('instEquipaAtiva'),
  ].join('\n');

  function correr(roster, obListaResponsaveisAtivosFn) {
    const ctx = { console, obRosterColaboradores: function () { return roster || []; }, obListaResponsaveisAtivos: obListaResponsaveisAtivosFn };
    vm.createContext(ctx);
    vm.runInContext(SRC + '\n_RESULT = instEquipaAtiva();', ctx);
    return ctx._RESULT;
  }

  teste('com o roster completo (todos os departamentos) disponível — mostra só a lista curada de produção, nunca todos', () => {
    const rosterCompleto = [
      { nome: 'Paulo Faria' }, { nome: 'Edna Cristina' }, { nome: 'André Nolasco' }, { nome: 'Humberto Estrelinha' },
      { nome: 'Rui Mota' }, { nome: 'Carlos Lopes' }, { nome: 'Rute Alves' }, { nome: 'Sofia Nunes' },
      { nome: 'Maksim Ivanov' }, { nome: 'Bruno Ferreira' }, { nome: 'Rui Teixeira' }, { nome: 'Fabio Costa' },
    ];
    const r = correr(rosterCompleto, function () { return rosterCompleto.map(c => c.nome); });
    assert.ok(r.length <= 7, 'devia ser a lista curada (7 nomes), nunca o roster inteiro de 12');
    assert.ok(r.indexOf('Edna Cristina') === -1, 'Edna não faz parte da equipa de montagem — nunca devia aparecer aqui');
    assert.ok(r.some(n => /maksim/i.test(n)), 'Maksim (equipa real de montagem) tem de aparecer');
  });

  teste('lista curada vazia (função indisponível) — cai no roster completo, nunca fica vazia', () => {
    const r = correr([], function () { return ['Ricardo Faria', 'Pedro Silva']; });
    assert.ok(r.length > 0);
  });
}

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou ? 1 : 0);
