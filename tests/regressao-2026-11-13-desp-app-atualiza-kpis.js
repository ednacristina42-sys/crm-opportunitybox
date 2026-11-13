// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — despSyncApp() esquecia-se de atualizar os cartões
// "Este mês / Pendentes / Reembolsos / Aprovadas" da página "Despesas de
// Funcionários" (Financeiro) depois de carregar as despesas do app de
// pontos (13/11/2026, reportado pela Edna: "esta parte aqui não altera
// nada" / "não fique só em 666, isso tá errado tem que preencher tudo").
//
// Causa raiz: despCalcularTotais() soma CRM_DESPESAS + EC_DESPESAS_APP, mas
// os cartões (finAtualizarKpisDespesas()) só eram recalculados ANTES de
// EC_DESPESAS_APP chegar (síncrono, no load da página) — nunca depois do
// despSyncApp() preencher EC_DESPESAS_APP a sério. A tabela por baixo
// (finRenderDespesas()) já era atualizada; só os cartões do topo ficavam
// presos ao valor incompleto.
//
// Corre com: node tests/regressao-2026-11-13-desp-app-atualiza-kpis.js
// Sem dependências externas — só Node core (fs, vm, assert).
// ══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

let passou = 0, falhou = 0;
async function teste(nome, fn) {
  try { await fn(); console.log('  ok  — ' + nome); passou++; }
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

const SRC_SYNC = 'async ' + extrairFuncao('despSyncApp');

function fakeFetchOk(dados) {
  return function () {
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve(dados); } });
  };
}

function montarCtx(dadosApp) {
  var chamouKpis = false, chamouRenderDespesas = false, chamouFinRenderDespesas = false, chamouAppRenderTabela = false;
  var elementos = {};
  function elFalso() { return { textContent: '', style: {}, disabled: false, value: '', innerHTML: '', appendChild: function () {} }; }
  const ctx = {
    console,
    fetch: fakeFetchOk(dadosApp),
    EC_SB_KEY: 'fake',
    EC_DESPESAS_APP: [],
    _despAppSynced: false,
    document: {
      getElementById: function (id) { if (!elementos[id]) elementos[id] = elFalso(); return elementos[id]; },
      createElement: function () { return elFalso(); },
    },
    despAppEstadoNorm: function (st) { return st === 'approved' ? 'approved' : st === 'pending' ? 'pending' : 'outro'; },
    despAppRenderTabela: function () { chamouAppRenderTabela = true; },
    renderDespesas: function () { chamouRenderDespesas = true; },
    finRenderDespesas: function () { chamouFinRenderDespesas = true; },
    finAtualizarKpisDespesas: function () { chamouKpis = true; },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC_SYNC, ctx);
  return {
    ctx: ctx,
    chamadas: function () {
      return { kpis: chamouKpis, renderDespesas: chamouRenderDespesas, finRenderDespesas: chamouFinRenderDespesas, appRenderTabela: chamouAppRenderTabela };
    },
  };
}

(async () => {
  console.log('\n[A] despSyncApp() tem de recalcular os cartões (finAtualizarKpisDespesas) depois de EC_DESPESAS_APP chegar, tal como já faz com a tabela');

  await teste('com despesas no app: chama finAtualizarKpisDespesas() além de finRenderDespesas()/renderDespesas()', async () => {
    const r = montarCtx([
      { amount_eur: '12.50', status: 'approved', user_name: 'Rui Manuel', occurred_at: '2026-11-06T10:00:00Z' },
      { amount_eur: '49.95', status: 'pending', user_name: 'Rui Jorge', occurred_at: '2026-11-05T10:00:00Z' },
    ]);
    await r.ctx.despSyncApp();
    const c = r.chamadas();
    assert.strictEqual(c.renderDespesas, true, 'já chamava renderDespesas() — não pode deixar de chamar');
    assert.strictEqual(c.finRenderDespesas, true, 'já chamava finRenderDespesas() (a tabela) — não pode deixar de chamar');
    assert.strictEqual(c.kpis, true, 'tinha de chamar finAtualizarKpisDespesas() — é isto que faltava, por isso os cartões do topo ficavam presos ao valor antigo');
  });

  console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
  process.exit(falhou ? 1 : 0);
})();
