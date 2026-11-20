// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — "Frota: custo médio por km" (Compras e Fornecedores).
//
// Pedido da Edna no plano de transição da secretária (20/11/2026): construir
// a vista "custo por km" da frota. Confirmado com ela (AskUserQuestion) que
// o TOConline categoriza despesa por FORNECEDOR, nunca por fatura — não há
// como saber automaticamente qual viatura gastou o quê — por isso o
// resultado é sempre uma MÉDIA da frota, nunca por viatura. Edna escolheu
// essa opção explicitamente ("Custo médio da frota").
//
// kmFrotaDistanciaMes(ano,mes): soma, por matrícula, (última leitura DENTRO
// do mês) - (última leitura ANTES do mês). Nunca inventa um km inicial para
// uma matrícula sem leitura anterior ao mês, e nunca gera distância negativa
// quando uma leitura está incoerente com a anterior.
//
// kmFrotaCustoPorKm(ano,mes): total TOConline já categorizado "Veículos &
// Combustível" ÷ km percorridos no mês. Devolve null explicitamente quando
// falta km suficiente — nunca um custo/km fabricado ou um 0 disfarçado.
//
// kmFrotaAdicionar(matricula,data,km): valida entrada antes de gravar;
// nunca grava uma leitura inválida.
//
// Corre com: node tests/regressao-2026-11-20-km-frota-custo-por-km.js
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

const SRC = [
  extrairFuncao('kmFrotaDistanciaMes'),
  extrairFuncao('kmFrotaCustoPorKm'),
  extrairFuncao('kmFrotaAdicionar'),
].join('\n\n');

function montarCtx(listaInicial, porCategoriaMes) {
  var localStorageData = {};
  var toastMsgs = [];
  const ctx = {
    console,
    window: {},
    KM_FROTA_LISTA: listaInicial || [],
    localStorage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(localStorageData, k) ? localStorageData[k] : null; },
      setItem: function (k, v) { localStorageData[k] = v; },
    },
    obSbPush: function () {},
    showToast: function (msg) { toastMsgs.push(msg); },
    finComprasPorCategoriaMes: function () { return porCategoriaMes || {}; },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx: ctx, toasts: function () { return toastMsgs; } };
}

console.log('\n[A] kmFrotaDistanciaMes — nunca inventa km inicial, nunca gera distância negativa');

teste('matrícula com leitura antes e dentro do mês: distância = diferença das duas leituras', () => {
  const r = montarCtx([
    { matricula: 'BG-19-HA', data: '2026-10-01', km: 184964 },
    { matricula: 'BG-19-HA', data: '2026-11-05', km: 186200 },
  ]);
  const out = r.ctx.kmFrotaDistanciaMes(2026, 11);
  assert.strictEqual(out.distanciaKm, 186200 - 184964);
  assert.strictEqual(out.matriculasComDados, 1);
});

teste('matrícula SEM nenhuma leitura antes do mês fica de fora (nunca inventa km inicial)', () => {
  const r = montarCtx([
    { matricula: 'CJ-53-DZ', data: '2026-11-05', km: 40000 },
  ]);
  const out = r.ctx.kmFrotaDistanciaMes(2026, 11);
  assert.strictEqual(out.distanciaKm, 0);
  assert.strictEqual(out.matriculasComDados, 0);
});

teste('leitura dentro do mês MENOR que a anterior (erro de registo) fica de fora, nunca gera distância negativa', () => {
  const r = montarCtx([
    { matricula: '01-TI-42', data: '2026-10-01', km: 230000 },
    { matricula: '01-TI-42', data: '2026-11-05', km: 10 }, // claramente um engano
  ]);
  const out = r.ctx.kmFrotaDistanciaMes(2026, 11);
  assert.strictEqual(out.distanciaKm, 0);
  assert.strictEqual(out.matriculasComDados, 0);
});

teste('soma várias matrículas corretamente', () => {
  const r = montarCtx([
    { matricula: 'A', data: '2026-10-31', km: 1000 },
    { matricula: 'A', data: '2026-11-30', km: 1500 },
    { matricula: 'B', data: '2026-10-31', km: 5000 },
    { matricula: 'B', data: '2026-11-15', km: 5300 },
  ]);
  const out = r.ctx.kmFrotaDistanciaMes(2026, 11);
  assert.strictEqual(out.distanciaKm, 500 + 300);
  assert.strictEqual(out.matriculasComDados, 2);
});

console.log('\n[B] kmFrotaCustoPorKm — nunca fabrica um custo/km sem dados suficientes de ambos os lados');

teste('sem km suficiente -> null, mesmo havendo despesa TOConline', () => {
  const r = montarCtx([], { 'Veículos & Combustível': 1000 });
  const out = r.ctx.kmFrotaCustoPorKm(2026, 11);
  assert.strictEqual(out, null);
});

teste('com km e despesa -> custo/km = despesa ÷ km', () => {
  const r = montarCtx([
    { matricula: 'BG-19-HA', data: '2026-10-01', km: 184964 },
    { matricula: 'BG-19-HA', data: '2026-11-30', km: 186464 }, // +1500 km
  ], { 'Veículos & Combustível': 750 });
  const out = r.ctx.kmFrotaCustoPorKm(2026, 11);
  assert.ok(out, 'devia ter devolvido um resultado');
  assert.strictEqual(out.custoTotal, 750);
  assert.strictEqual(out.distanciaKm, 1500);
  assert.strictEqual(out.custoPorKm, 0.5);
});

console.log('\n[C] kmFrotaAdicionar — valida antes de gravar, nunca grava lixo');

teste('matrícula em branco -> rejeita e não altera a lista', () => {
  const r = montarCtx([]);
  const ok = r.ctx.kmFrotaAdicionar('', '2026-11-20', 1000);
  assert.strictEqual(ok, false);
  assert.strictEqual(r.ctx.KM_FROTA_LISTA.length, 0);
  assert.ok(r.toasts().length > 0, 'devia ter avisado o utilizador');
});

teste('km negativo -> rejeita', () => {
  const r = montarCtx([]);
  const ok = r.ctx.kmFrotaAdicionar('BG-19-HA', '2026-11-20', -5);
  assert.strictEqual(ok, false);
  assert.strictEqual(r.ctx.KM_FROTA_LISTA.length, 0);
});

teste('entrada válida -> grava e normaliza a matrícula para maiúsculas', () => {
  const r = montarCtx([]);
  const ok = r.ctx.kmFrotaAdicionar('bg-19-ha', '2026-11-20', 186500);
  assert.strictEqual(ok, true);
  assert.strictEqual(r.ctx.KM_FROTA_LISTA.length, 1);
  assert.strictEqual(r.ctx.KM_FROTA_LISTA[0].matricula, 'BG-19-HA');
  assert.strictEqual(r.ctx.KM_FROTA_LISTA[0].km, 186500);
});

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou ? 1 : 0);
