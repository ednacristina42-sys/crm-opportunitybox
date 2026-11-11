// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — avSyncVendedoresSheet() sobrescrevia sempre o KPI
// principal e os totais mensais reais do TOConline com os valores (errados)
// da folha "Vendas 2026" (11/11/2026).
//
// Confirmado pela Edna: a folha "Vendas 2026" (mantida à mão pela
// secretária) diverge do TOConline, sempre por mais, em todos os
// comerciais (ex.: Paulo Faria: €641.916 na folha vs €513.617 de
// faturação real no TOConline) — "sim as do toconline é a certa".
//
// Causa raiz: renderAnaliseVendas() chama avSyncTocOnline() (que grava o
// KPI principal e AV_ANOS[2026].meses corretamente a partir de faturas
// reais) e, QUANDO ESSE TERMINA, chama de seguida avSyncVendedoresSheet()
// — que sobrescrevia esses mesmos dois sítios sem nenhuma condição, com
// os valores da folha. Corrigido para só a folha escrever aí quando não
// há mesmo nenhuma fatura real do TOConline em cache (mesmo critério já
// usado na Área Financeira da mesma página).
//
// Corre com: node tests/regressao-2026-11-11-analise-vendas-toconline-prevalece.js
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

const SRC = [
  extrairFuncao('avParseCSV'),
  extrairFuncao('avNormHdr'),
  extrairFuncao('avFindCol'),
  extrairFuncao('avParseNumPT'),
  'async ' + extrairFuncao('avSyncVendedoresSheet'),
].join('\n');

const CSV_SHEET = [
  'Mês/Ano,Vendedor,Total com IVA,Total Líquido,Data',
  '01/2026,Paulo Faria,800,650,15/01/2026',
  '02/2026,Paulo Faria,900,750,10/02/2026',
].join('\n');

function rodar(ctxExtra) {
  const doc = {
    getElementById: function () { return null; },
  };
  const base = {
    console, document: doc, window: {},
    localStorage: {
      _s: Object.assign({}, ctxExtra && ctxExtra._localStorage),
      getItem: function (k) { return this._s.hasOwnProperty(k) ? this._s[k] : null; },
      setItem: function (k, v) { this._s[k] = v; },
    },
    avFetchVendSheetCSV: async function () { return CSV_SHEET; },
    avRenderSheetTable: function () {},
    AV_ANOS: [{ ano: 2026, total: 0, meses: [null, null, null, null, null, null, null, null, null, null, null, null] }],
    AV_SHEET_PORMES_KEY: 'ob-av-sheet-pormes',
    AV_YTD: 0, AV_VEND_26: null, AV_CLIENTES_2026: null, AV_CLIENTES: null, AV_TOTAL_ALL: 0,
  };
  const ctx = Object.assign(base, ctxExtra);
  vm.createContext(ctx);
  ctx._p = vm.runInContext(SRC + '\navSyncVendedoresSheet();', ctx);
  return ctx;
}

(async () => {
  console.log('\n[A] avSyncVendedoresSheet() nunca sobrescreve o KPI/meses reais quando já há faturas do TOConline em cache');

  await teste('com faturas reais do TOConline em cache — AV_ANOS[2026].meses[0] não é tocado pela folha', async () => {
    const ctx = rodar({ _localStorage: { 'ob-toconline-faturas': JSON.stringify({ data: [{ Id: 1 }] }) } });
    await ctx._p;
    const av2026 = ctx.AV_ANOS[0];
    assert.strictEqual(av2026.meses[0], null, 'com TOConline real em cache, Janeiro tinha de continuar como estava (null), nunca é a folha a decidir');
  });

  await teste('sem nenhuma fatura do TOConline em cache — a folha continua a preencher AV_ANOS[2026].meses (comportamento antigo preservado)', async () => {
    const ctx = rodar({ _localStorage: {} });
    await ctx._p;
    const av2026 = ctx.AV_ANOS[0];
    assert.strictEqual(av2026.meses[0], 800, 'sem TOConline nenhum, a folha continua a ser o único fallback disponível');
  });

  await teste('cache do TOConline vazio (data:[]) conta como "sem TOConline" — a folha continua a preencher', async () => {
    const ctx = rodar({ _localStorage: { 'ob-toconline-faturas': JSON.stringify({ data: [] }) } });
    await ctx._p;
    const av2026 = ctx.AV_ANOS[0];
    assert.strictEqual(av2026.meses[0], 800);
  });

  await teste('AV_VEND_26 (tabela de vendedores) continua sempre a ser preenchido pela folha, com ou sem TOConline — sem equivalente no TOConline ainda', async () => {
    const ctx = rodar({ _localStorage: { 'ob-toconline-faturas': JSON.stringify({ data: [{ Id: 1 }] }) } });
    await ctx._p;
    assert.ok(Array.isArray(ctx.AV_VEND_26) && ctx.AV_VEND_26.length > 0, 'a tabela de vendedores não tem fonte alternativa — deve continuar a vir da folha');
  });

  console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
  process.exit(falhou ? 1 : 0);
})();
