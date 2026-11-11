// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — _sbOrcUpsert() com isCreate:true nunca limpava
// deleted_at/deleted_by, por isso "recriar" um orçamento cujo id já
// existisse (apagado) deixava-o para sempre invisível (11/11/2026).
//
// Causa raiz confirmada em produção: 16 orçamentos sincronizados da folha
// "Orçamentos" ficavam sempre de fora do Mapa de Vendas/Follow-up/etc.,
// sincronização após sincronização — porque já existiam na tabela
// ob_orcamentos, mas marcados como apagados (deleted_at preenchido) desde
// uma limpeza feita a 07/10/2026. O upsert (onConflict:'id') actualizava o
// conteúdo (cliente, valor, data — tudo certo) mas NUNCA tocava em
// deleted_at, porque esse campo não fazia parte do objecto `row` enviado —
// a linha continuava invisível em todo o CRM apesar do conteúdo estar
// correcto e actualizado.
//
// Corre com: node tests/regressao-2026-11-11-sbOrcUpsert-nao-reanima-apagados.js
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

const SRC = 'async ' + extrairFuncao('_sbOrcUpsert');

function fakeSBClient(capturaLinha) {
  function chainable() {
    const obj = {
      upsert: function (row) { capturaLinha.row = row; return obj; },
      update: function (row) { capturaLinha.row = row; return obj; },
      eq: function () { return obj; },
      select: function () { return obj; },
      then: function (resolve, reject) {
        return Promise.resolve({ data: [{ updated_at: '2026-11-11T00:00:00Z' }], error: null }).then(resolve, reject);
      },
    };
    return obj;
  }
  return { from: function () { return chainable(); } };
}

(async () => {
  console.log('\n[A] _sbOrcUpsert() com isCreate:true limpa deleted_at/deleted_by — nunca deixa uma linha "recriada" presa como apagada');

  await teste('isCreate:true envia deleted_at:null e deleted_by:null, mesmo a linha já existindo apagada', async () => {
    const captura = {};
    const ctx = {
      crmSBClient: function () { return fakeSBClient(captura); },
      CU: { id: 'u1', admin: true },
      console,
    };
    vm.createContext(ctx);
    vm.runInContext(SRC + "\nthis._p = _sbOrcUpsert({ num: 'ORC-OB-2026.09.790.RM', cli: 'NextFitout', val: 425, vendedor: 'Rui Mota' }, { isCreate: true });", ctx);
    const res = await ctx._p;
    assert.strictEqual(res.ok, true);
    assert.strictEqual(captura.row.deleted_at, null, 'uma recriação (isCreate:true) tem de limpar deleted_at — senão a linha fica invisível para sempre, mesmo com conteúdo certo');
    assert.strictEqual(captura.row.deleted_by, null);
  });

  await teste('isCreate:false (actualização normal) NUNCA toca em deleted_at — não é isto que apaga/reanima nada', async () => {
    const captura = {};
    const ctx = {
      crmSBClient: function () { return fakeSBClient(captura); },
      CU: { id: 'u1', admin: true },
      console,
    };
    vm.createContext(ctx);
    vm.runInContext(SRC + "\nthis._p = _sbOrcUpsert({ num: 'ORC-OB-2026.09.790.RM', cli: 'NextFitout', val: 425, vendedor: 'Rui Mota', _sbVersaoConhecida: null }, { isCreate: false });", ctx);
    await ctx._p;
    assert.ok(!('deleted_at' in captura.row), 'uma actualização normal não deve sequer mencionar deleted_at no objecto enviado');
  });

  console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
  process.exit(falhou ? 1 : 0);
})();
