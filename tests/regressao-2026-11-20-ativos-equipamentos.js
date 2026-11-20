// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — "Equipamentos e Ferramentas" (Compras e Fornecedores).
//
// Pedido da Edna no plano de transição (20/11/2026): "quero otimizar grande
// parte dos trabalhos" antes de ficar no lugar da secretária. Substitui a
// folha "Equipamentos e Ferramentas", que tinha muitos campos em branco
// (Em Uso/Localização) — ativoAdicionar() nunca inventa um valor para um
// campo não preenchido, só exige o nome do equipamento.
//
// Corre com: node tests/regressao-2026-11-20-ativos-equipamentos.js
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
  extrairFuncao('ativosSalvar'),
  extrairFuncao('ativoAdicionar'),
  extrairFuncao('ativoRemover'),
].join('\n\n');

function montarCtx(listaInicial) {
  var localStorageData = {};
  var toastMsgs = [];
  var pushes = [];
  var confirmResposta = true;
  const ctx = {
    console,
    window: {},
    ATIVOS_LISTA: listaInicial || [],
    localStorage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(localStorageData, k) ? localStorageData[k] : null; },
      setItem: function (k, v) { localStorageData[k] = v; },
    },
    obSbPush: function (chave) { pushes.push(chave); },
    showToast: function (msg) { toastMsgs.push(msg); },
    confirm: function () { return confirmResposta; },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return {
    ctx: ctx,
    toasts: function () { return toastMsgs; },
    pushes: function () { return pushes; },
    setConfirm: function (v) { confirmResposta = v; },
  };
}

console.log('\n[A] ativoAdicionar — só exige o nome do equipamento, nunca inventa o resto');

teste('equipamento em branco -> rejeita', () => {
  const r = montarCtx([]);
  const ok = r.ctx.ativoAdicionar({ equipamento: '' });
  assert.strictEqual(ok, false);
  assert.strictEqual(r.ctx.ATIVOS_LISTA.length, 0);
  assert.ok(r.toasts().length > 0);
});

teste('só com equipamento -> grava, resto fica null (nunca inventado)', () => {
  const r = montarCtx([]);
  const ok = r.ctx.ativoAdicionar({ equipamento: 'Berbequim Bosch' });
  assert.strictEqual(ok, true);
  assert.strictEqual(r.ctx.ATIVOS_LISTA.length, 1);
  const a = r.ctx.ATIVOS_LISTA[0];
  assert.strictEqual(a.equipamento, 'Berbequim Bosch');
  assert.strictEqual(a.identificacaoAtivo, null);
  assert.strictEqual(a.nSerie, null);
  assert.strictEqual(a.localizacao, null);
  assert.strictEqual(a.emUso, null);
  assert.strictEqual(a.estado, 'Ativo', 'sem estado indicado -> assume Ativo (default sensato, não um valor desconhecido)');
});

teste('valor de aquisição inválido -> fica null, não bloqueia o resto', () => {
  const r = montarCtx([]);
  const ok = r.ctx.ativoAdicionar({ equipamento: 'Escada', valorAquisicao: 'abc' });
  assert.strictEqual(ok, true);
  assert.strictEqual(r.ctx.ATIVOS_LISTA[0].valorAquisicao, null);
});

console.log('\n[B] Edição por id — substitui no lugar, nunca duplica');

teste('editar um ativo existente substitui a linha, não cria uma nova', () => {
  const r = montarCtx([]);
  r.ctx.ativoAdicionar({ equipamento: 'Plotter Roland', tipo: 'Maquinário', estado: 'Ativo' });
  const idGerado = r.ctx.ATIVOS_LISTA[0].id;
  const ok = r.ctx.ativoAdicionar({ equipamento: 'Plotter Roland', tipo: 'Maquinário', estado: 'Inativo' }, idGerado);
  assert.strictEqual(ok, true);
  assert.strictEqual(r.ctx.ATIVOS_LISTA.length, 1, 'não devia duplicar a linha');
  assert.strictEqual(r.ctx.ATIVOS_LISTA[0].estado, 'Inativo');
  assert.strictEqual(r.ctx.ATIVOS_LISTA[0].id, idGerado, 'o id mantém-se igual ao editar');
});

teste('cada ativoAdicionar grava em localStorage e envia obSbPush', () => {
  const r = montarCtx([]);
  r.ctx.ativoAdicionar({ equipamento: 'Compressor' });
  assert.ok(r.pushes().indexOf('ob-ativos-equipamentos') !== -1);
});

console.log('\n[C] ativoRemover — pede confirmação, nunca apaga sem ela');

teste('confirmação negada -> não remove', () => {
  const r = montarCtx([{ id: 'x1', equipamento: 'Trator' }]);
  r.setConfirm(false);
  r.ctx.ativoRemover('x1');
  assert.strictEqual(r.ctx.ATIVOS_LISTA.length, 1);
});

teste('confirmação aceite -> remove o ativo certo', () => {
  const r = montarCtx([{ id: 'x1', equipamento: 'Trator' }, { id: 'x2', equipamento: 'Furadeira' }]);
  r.setConfirm(true);
  r.ctx.ativoRemover('x1');
  assert.strictEqual(r.ctx.ATIVOS_LISTA.length, 1);
  assert.strictEqual(r.ctx.ATIVOS_LISTA[0].id, 'x2');
});

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou ? 1 : 0);
