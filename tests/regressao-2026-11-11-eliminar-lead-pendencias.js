// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — obEliminarLeadRapido(): permite eliminar um lead
// directamente a partir do cartão "Pendências Comerciais" (ex.: "Leads
// parados há mais de 7 dias"), sem ter de o abrir primeiro (11/11/2026,
// pedido da Edna ao ver um lead de teste parado há 43 dias).
//
// Corre com: node tests/regressao-2026-11-11-eliminar-lead-pendencias.js
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

const SRC = extrairFuncao('obEliminarLeadRapido');

function rodar(leadsIniciais, confirmaResposta) {
  var chamouRegistar = null, chamouSave = false, chamouRenderAll = false, chamouAtualizarPendencias = false;
  const ctx = {
    confirm: function () { return confirmaResposta; },
    crmLeads: leadsIniciais.slice(),
    crmRegistarOperacaoLead: function (tipo, id) { chamouRegistar = { tipo: tipo, id: id }; },
    saveCrmLeads: function () { chamouSave = true; },
    crmRenderAll: function () { chamouRenderAll = true; },
    obAtualizarPendencias: function () { chamouAtualizarPendencias = true; },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx: ctx, chamadas: function () { return { registar: chamouRegistar, save: chamouSave, renderAll: chamouRenderAll, pendencias: chamouAtualizarPendencias }; } };
}

console.log('\n[A] obEliminarLeadRapido() elimina pelo id directamente, sem depender de crmEditingId');

teste('confirma -> remove o lead certo de crmLeads, grava, re-renderiza, e atualiza as pendências', () => {
  const r = rodar([{ id: 10, n: 'teste 1' }, { id: 20, n: 'Cliente real' }], true);
  vm.runInContext('obEliminarLeadRapido(10)', r.ctx);
  assert.deepStrictEqual(r.ctx.crmLeads.map(function(l){return l.id;}), [20], 'só o lead 10 devia ter sido removido');
  const c = r.chamadas();
  assert.deepStrictEqual(c.registar, { tipo: 'delete', id: 10 });
  assert.strictEqual(c.save, true);
  assert.strictEqual(c.renderAll, true);
  assert.strictEqual(c.pendencias, true);
});

teste('não confirma -> não mexe em nada', () => {
  const r = rodar([{ id: 10, n: 'teste 1' }], false);
  vm.runInContext('obEliminarLeadRapido(10)', r.ctx);
  assert.deepStrictEqual(r.ctx.crmLeads.map(function(l){return l.id;}), [10], 'sem confirmação, o lead tinha de continuar lá');
  const c = r.chamadas();
  assert.strictEqual(c.save, false);
  assert.strictEqual(c.renderAll, false);
});

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou ? 1 : 0);
