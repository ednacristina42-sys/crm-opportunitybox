// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — crmEliminarComercial(): permite remover um comercial
// da lista de "Gestão Comerciais" (ex.: saiu da empresa), sem apagar nada do
// histórico de leads/orçamentos/vendas já atribuídos ao nome dele (11/11/2026,
// pedido da Edna: "quero poder eliminar comerciais quando sairem da empresa").
//
// Antes só existia editar (✏️) e pausar/reativar (⏸/▶, via crmToggleComercial
// — c.ativo). Não havia nenhuma forma de remover de facto a entrada da lista.
//
// Corre com: node tests/regressao-2026-11-11-eliminar-comercial.js
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

const SRC = extrairFuncao('crmEliminarComercial');

function rodar(comerciaisIniciais, confirmaResposta) {
  var chamouSave = false, chamouRenderAll = false, chamouSyncEmails = false, chamouRefrescarSelects = false;
  const ctx = {
    confirm: function () { return confirmaResposta; },
    crmComerciais: comerciaisIniciais.slice(),
    saveComerciaisData: function () { chamouSave = true; },
    crmRenderComerciaisList: function () { chamouRenderAll = true; },
    syncOrcEmails: function () { chamouSyncEmails = true; },
    crmRefrescarSelectsComerciais: function () { chamouRefrescarSelects = true; },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx: ctx, chamadas: function () { return { save: chamouSave, render: chamouRenderAll, syncEmails: chamouSyncEmails, refrescarSelects: chamouRefrescarSelects }; } };
}

console.log('\n[A] crmEliminarComercial() remove da lista mas nunca toca em dados de leads/orçamentos/vendas (isso fica noutro sítio, atribuído por nome)');

teste('confirma -> remove o comercial certo, grava, re-renderiza e sincroniza emails', () => {
  const r = rodar([
    { id: 1, nome: 'Paulo Faria', email: 'paulo@opportunitybox.pt', cor: '#e74c3c', ativo: true },
    { id: 2, nome: 'Rui Mota', email: 'rui@opportunitybox.pt', cor: '#3b82f6', ativo: true },
  ], true);
  vm.runInContext('crmEliminarComercial(1)', r.ctx);
  assert.deepStrictEqual(r.ctx.crmComerciais.map(function (c) { return c.id; }), [2], 'só o comercial 1 (Paulo Faria) devia ter sido removido');
  const c = r.chamadas();
  assert.strictEqual(c.save, true);
  assert.strictEqual(c.render, true);
  assert.strictEqual(c.syncEmails, true);
});

teste('confirma -> também refresca o dropdown "Filtrar por vendedor" (senão o nome eliminado continua lá até sair/voltar à página)', () => {
  const r = rodar([{ id: 1, nome: 'Humberto Estrelinha', email: 'humberto@opportunitybox.pt', cor: '#8b5cf6', ativo: true }], true);
  vm.runInContext('crmEliminarComercial(1)', r.ctx);
  assert.strictEqual(r.chamadas().refrescarSelects, true, 'tinha de chamar crmRefrescarSelectsComerciais() para o filtro deixar de mostrar o Humberto imediatamente');
});

teste('não confirma -> não mexe em nada', () => {
  const r = rodar([{ id: 1, nome: 'Paulo Faria', email: 'paulo@opportunitybox.pt', cor: '#e74c3c', ativo: true }], false);
  vm.runInContext('crmEliminarComercial(1)', r.ctx);
  assert.deepStrictEqual(r.ctx.crmComerciais.map(function (c) { return c.id; }), [1], 'sem confirmação, o comercial tinha de continuar lá');
  const c = r.chamadas();
  assert.strictEqual(c.save, false);
  assert.strictEqual(c.render, false);
});

teste('id inexistente -> não faz nada, não rebenta', () => {
  const r = rodar([{ id: 1, nome: 'Paulo Faria', email: 'paulo@opportunitybox.pt', cor: '#e74c3c', ativo: true }], true);
  vm.runInContext('crmEliminarComercial(999)', r.ctx);
  assert.deepStrictEqual(r.ctx.crmComerciais.map(function (c) { return c.id; }), [1]);
  const c = r.chamadas();
  assert.strictEqual(c.save, false);
});

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou ? 1 : 0);
