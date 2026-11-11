// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — avParseNumPT() não tratava o espaço como separador
// de milhares (07/10/2026).
//
// Reportado pela Edna com screenshot do Follow-up: "estes follow up os
// valores dos orçamentos estão errados" — "JF Santa Luzia €7,00" (real:
// 7 980,00 €, confirmado na folha), "5 a Seco Portugal... €26,00" (real:
// 26 277,71 €). Causa: a folha "Orçamentos" usa espaço como separador de
// milhares (formato pt-PT do Google Sheets); avParseNumPT() só tratava "."
// como separador de milhares e "," como decimal — parseFloat("7 980.00")
// pára no primeiro espaço e devolve só 7. Os orçamentos sincronizados via
// mvSincronizarGoogleSheet() ficavam gravados no Supabase com o valor
// truncado, sem nenhum erro nem aviso.
//
// Corre com: node tests/regressao-2026-10-07-avparsenumpt-espaco-milhares.js
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

const SRC = extrairFuncao('avParseNumPT');

function rodar(s) {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(SRC + '\nthis._r = avParseNumPT(' + JSON.stringify(s) + ');', ctx);
  return ctx._r;
}

console.log('\n[A] avParseNumPT() trata o espaço (normal e não-separável) como separador de milhares');

teste('"7 980,00 €" (caso real — JF Santa Luzia) → 7980, não 7', () => {
  assert.strictEqual(rodar('7 980,00 €'), 7980);
});

teste('"26 277,71 €" (caso real — 5 a Seco Portugal) → 26277.71, não 26', () => {
  assert.strictEqual(rodar('26 277,71 €'), 26277.71);
});

teste('espaço não-separável \\u00A0 (comum em exports do Google Sheets) tratado da mesma forma', () => {
  assert.strictEqual(rodar('1 100,00 €'), 1100);
});

teste('valor pequeno sem separador de milhares continua igual (sem regressão)', () => {
  assert.strictEqual(rodar('100,00 €'), 100);
  assert.strictEqual(rodar('1,00'), 1);
});

teste('"." continua a funcionar como separador de milhares (formato alternativo já suportado)', () => {
  assert.strictEqual(rodar('1.100,00'), 1100);
});

teste('vazio/nulo continua a devolver 0', () => {
  assert.strictEqual(rodar(''), 0);
  assert.strictEqual(rodar(null), 0);
});

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou ? 1 : 0);
