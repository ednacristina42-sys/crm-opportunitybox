// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — a tabela "Despesas de Funcionários" (Financeiro)
// ficava sempre em "Todos os meses" por omissão, enquanto o cartão
// "Este mês" já só soma o mês actual (13/11/2026, Edna: "estas despesas
// também estão erradas, pois não somam" — confirmado que os números já
// batiam certo, só a tabela mostrava todos os meses misturados por
// omissão, parecendo discordar do cartão).
//
// finRenderDespesas() passa agora a pré-seleccionar o mês actual no
// dropdown 'fin-desp-filtro-mes' — mas só enquanto a Edna não tiver mexido
// ela própria nesse filtro ('data-tocado', marcado pelo onchange do
// próprio <select> e por finDespLimparFiltros()).
//
// Corre com: node tests/regressao-2026-11-13-fin-desp-filtro-mes-omissao.js
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

const SRC = extrairFuncao('finDespParseData') + '\n' + extrairFuncao('finRenderDespesas');

// Data fixa de "hoje" para o teste ser determinístico: 13/11/2026.
const HOJE_ISO = '2026-11-13T12:00:00.000Z';

function elFalso() {
  var attrs = {};
  return {
    _innerHTML: '',
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) { this._innerHTML = v; },
    value: '',
    appendChild: function (o) { /* no-op — só nos interessa o valor final do select */ },
    getAttribute: function (k) { return attrs[k] || null; },
    setAttribute: function (k, v) { attrs[k] = v; },
    textContent: '',
    style: {},
    disabled: false,
  };
}

function montarCtx(fixaMesInicial) {
  var elementos = {};
  function getEl(id) { if (!elementos[id]) elementos[id] = elFalso(); return elementos[id]; }
  const RealDate = Date;
  const ctx = {
    console,
    FIN_DESPESAS: [],
    EC_DESPESAS_APP: fixaMesInicial ? [] : [
      { id: 1, amount_eur: '12.50', status: 'paga', user_name: 'Rui', occurred_at: '2026-11-06' },
      { id: 2, amount_eur: '22.00', status: 'paga', user_name: 'Rui', occurred_at: '2026-11-05' },
    ],
    finDespRegistoDoApp: function (d) {
      return { id: 'app-' + d.id, appId: d.id, data: d.occurred_at, funcionario: d.user_name, categoria: 'x', descricao: '', valor: parseFloat(d.amount_eur) || 0, estado: 'Aprovada', temRecibo: false, origem: 'App de Pontos' };
    },
    fmtEur: function (v) { return '€' + v; },
    finGetSupabase: function () { return null; },
    _finSupaOnline: false,
    document: { getElementById: getEl, createElement: function () { return elFalso(); } },
    Date: class extends RealDate {
      constructor(...args) { if (args.length === 0) { super(HOJE_ISO); } else { super(...args); } }
      static now() { return new RealDate(HOJE_ISO).getTime(); }
    },
  };
  getEl('fin-desp-tbody'); // garante que finRenderDespesas() não sai cedo (tbody existe)
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx: ctx, el: getEl };
}

console.log('\n[A] finRenderDespesas() pré-seleciona o mês actual no filtro, sem a Edna ter mexido nele');

teste('Novembro já existe na lista (EC_DESPESAS_APP com despesas de Novembro) -> filtro abre em "2026-11"', () => {
  const r = montarCtx(false);
  r.ctx.finRenderDespesas();
  assert.strictEqual(r.el('fin-desp-filtro-mes').value, '2026-11', 'na primeira vez, sem a Edna ter tocado no filtro, tinha de abrir já no mês actual');
});

teste('depois de a Edna escolher outro mês (data-tocado), uma nova renderização não lhe repõe o mês actual por cima', () => {
  const r = montarCtx(false);
  r.ctx.finRenderDespesas();
  // Simula a Edna a escolher "Todos os meses" à mão (o onchange do <select> marca data-tocado antes de chamar finRenderDespesas()).
  const sel = r.el('fin-desp-filtro-mes');
  sel.value = '';
  sel.setAttribute('data-tocado', '1');
  r.ctx.finRenderDespesas();
  assert.strictEqual(sel.value, '', 'depois de "tocado", a escolha da Edna (Todos os meses) tem de ser respeitada — nunca reposta para o mês actual');
});

teste('sem nenhuma despesa de Novembro ainda carregada -> não força um mês que nem sequer existe na lista', () => {
  const r = montarCtx(true); // EC_DESPESAS_APP vazio -> nenhuma linha de Novembro
  r.ctx.finRenderDespesas();
  assert.strictEqual(r.el('fin-desp-filtro-mes').value, '', 'sem Novembro na lista de meses, tinha de ficar em "Todos os meses" (nunca um valor inexistente)');
});

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou ? 1 : 0);
