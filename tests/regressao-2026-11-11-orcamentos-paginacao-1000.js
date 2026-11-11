// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — _mvEnsureData() e _sbOrcLoadAll() nunca traziam mais
// de 1000 orçamentos, mesmo pedindo .limit(5000)/.limit(2000) (11/11/2026).
//
// Causa raiz confirmada em produção: o Supabase/PostgREST aplica um tecto
// de 1000 linhas por pedido, no SERVIDOR, independentemente do .limit()
// pedido no cliente — e sem paginação (.range()), qualquer resultado acima
// disso fica silenciosamente cortado, sem erro nenhum. Com 1705 orçamentos
// reais na tabela, o Mapa de Vendas mostrava sempre "1000 registos" e os
// orçamentos sincronizados mais recentemente (novembro) não apareciam —
// _mvEnsureData() nem sequer tinha ORDER BY, por isso os 1000 devolvidos
// podiam ser quaisquer 1000, não necessariamente os mais recentes.
// _sbOrcLoadAll() (usada por orcData — Orçamentos, Follow-up, Recebimentos
// de clientes, etc.) tinha ORDER BY created_at DESC, por isso os que
// ficavam de fora eram sempre os ~700 orçamentos MAIS ANTIGOS, em silêncio.
//
// Corre com: node tests/regressao-2026-11-11-orcamentos-paginacao-1000.js
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

// Simula o tecto real do PostgREST: nunca devolve mais de `tectoServidor`
// linhas por pedido, mesmo que .range() peça um intervalo maior.
function fakeSBClient(totalLinhas, tectoServidor) {
  var chamadas = [];
  function linha(i) { return { id: 'ORC-' + i, created_at: '2026-01-01T00:00:00Z', val: i }; }
  function chainable() {
    var state = { table: null, orderCol: null, orderAsc: null, from: null, to: null };
    var obj = {
      from: function (t) { state.table = t; return obj; },
      select: function () { return obj; },
      is: function () { return obj; },
      order: function (col, opts) { state.orderCol = col; state.orderAsc = !!(opts && opts.ascending); return obj; },
      range: function (from, to) { state.from = from; state.to = to; return obj; },
      limit: function () { return obj; },
      then: function (resolve, reject) {
        chamadas.push({ from: state.from, to: state.to });
        var from = state.from == null ? 0 : state.from;
        var to = state.to == null ? totalLinhas - 1 : state.to;
        var pedido = to - from + 1;
        var devolve = Math.min(pedido, tectoServidor, Math.max(0, totalLinhas - from));
        var dados = [];
        for (var i = 0; i < devolve; i++) dados.push(linha(from + i));
        return Promise.resolve({ data: dados, error: null }).then(resolve, reject);
      },
    };
    return obj;
  }
  return { sb: { from: function (t) { return chainable().from(t); } }, chamadas: chamadas };
}

(async () => {
  console.log('\n[A] _mvEnsureData() pagina em vez de confiar só no .limit() — nunca mais presa a 1000 linhas');
  {
    const SRC = 'async ' + extrairFuncao('_mvEnsureData');
    await teste('1705 linhas reais, tecto do servidor em 1000 — _mvEnsureData() traz as 1705, não só 1000', async () => {
      const fake = fakeSBClient(1705, 1000);
      const ctx = { crmSBClient: function () { return fake.sb; }, console, _mvData: null, _mvLoading: false, _mvLoadingPromise: null };
      vm.createContext(ctx);
      vm.runInContext(SRC + '\nthis._p = _mvEnsureData();', ctx);
      const resultado = await ctx._p;
      assert.strictEqual(resultado.length, 1705, 'tinha de trazer as 1705 linhas reais, não ficar presa ao tecto do servidor (1000)');
      assert.ok(fake.chamadas.length >= 2, 'tinha de ter feito mais do que um pedido (paginado) para ultrapassar o tecto de 1000');
    });

    await teste('menos de 1000 linhas (sem paginação a mais) — só um pedido, sem chamadas extra desnecessárias', async () => {
      const fake = fakeSBClient(42, 1000);
      const ctx = { crmSBClient: function () { return fake.sb; }, console, _mvData: null, _mvLoading: false, _mvLoadingPromise: null };
      vm.createContext(ctx);
      vm.runInContext(SRC + '\nthis._p = _mvEnsureData();', ctx);
      const resultado = await ctx._p;
      assert.strictEqual(resultado.length, 42);
      assert.strictEqual(fake.chamadas.length, 1, 'com menos de uma página inteira, não devia tentar uma segunda chamada');
    });
  }

  console.log('\n[B] _sbOrcLoadAll() (orcData — Orçamentos/Follow-up/Recebimentos) pagina da mesma forma');
  {
    const SRC = 'async ' + extrairFuncao('_sbOrcLoadAll');
    await teste('1705 linhas reais, tecto do servidor em 1000 — _sbOrcLoadAll() devolve as 1705, não só os 1000 mais recentes', async () => {
      const fake = fakeSBClient(1705, 1000);
      const ctx = {
        crmSBClient: function () { return fake.sb; }, console,
        CU: { id: 'u1' },
        _sbOrcErroLegivel: function () { return 'erro'; },
        _sbOrcClassificarErro: function () { return 'erro'; },
      };
      vm.createContext(ctx);
      vm.runInContext(SRC + '\nthis._p = _sbOrcLoadAll();', ctx);
      const resultado = await ctx._p;
      assert.strictEqual(resultado.ok, true);
      assert.strictEqual(resultado.rows.length, 1705, 'orcData tinha de ter as 1705 linhas — antes perdia sempre as mais antigas em silêncio (ordenado DESC, cortado aos 1000)');
    });
  }

  console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
  process.exit(falhou ? 1 : 0);
})();
