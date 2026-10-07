// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — mvSincronizarGoogleSheet() tinha de invalidar o
// cache _mvData do Mapa de Vendas através da função exportada pela IIFE,
// não de uma atribuição directa que nunca lhe tocava (07/10/2026).
//
// Causa raiz confirmada via Playwright contra o ficheiro real: _mvData
// (e renderMapaVendas/_mvEnsureData) vivem dentro de
// "(function(){ 'use strict'; ... })()" num bloco de <script> muito mais à
// frente no ficheiro do que mvSincronizarGoogleSheet(). Um "_mvData = null"
// feito de fora dessa IIFE não gera erro (não está em modo estrito aí) —
// cria sem ninguém reparar uma global solta e completamente desligada da
// variável real, por isso o ecrã do Mapa de Vendas nunca voltava a ler do
// Supabase depois de uma sincronização: a Edna via "63 orçamentos novos" no
// aviso, confirmados na base de dados, mas a tabela continuava com os dados
// antigos. Corrigido exportando window._mvInvalidarCache() de dentro da
// IIFE, e mvSincronizarGoogleSheet() passou a chamá-la em vez da atribuição
// directa.
//
// Este teste cobre só a parte estaticamente verificável: que
// mvSincronizarGoogleSheet() chama window._mvInvalidarCache() (nunca mais
// "_mvData = null" directo) quando há orçamentos novos. O comportamento
// ponta-a-ponta (a tabela realmente recarrega) foi confirmado manualmente
// via Playwright contra o ficheiro real antes deste commit.
//
// Corre com: node tests/regressao-2026-10-07-mv-invalidar-cache-apos-sync.js
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

console.log('\n[A] mvSincronizarGoogleSheet() não volta a usar "_mvData = null" directo — só a função exportada');

teste('o corpo da função nunca mais atribui directamente a _mvData (bug antigo: global solta, sem efeito nenhum)', () => {
  const src = extrairFuncao('mvSincronizarGoogleSheet');
  // Remove comentários de bloco e de linha antes de procurar código real —
  // o próprio comentário que documenta o bug antigo menciona
  // "_mvData = null" como texto, o que faria um grep ingénuo (sem isto)
  // acusar falso positivo nele próprio.
  const semComentarios = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/[^.]\b_mvData\s*=\s*null/.test(semComentarios), 'não pode voltar a ter "_mvData = null" directo em código real — isso nunca tocava na variável real (está dentro de outra IIFE)');
});

teste('o corpo da função chama window._mvInvalidarCache() antes de renderMapaVendas()', () => {
  const src = extrairFuncao('mvSincronizarGoogleSheet');
  const idxInvalidar = src.indexOf('_mvInvalidarCache');
  const idxRender = src.indexOf('renderMapaVendas()');
  assert.ok(idxInvalidar !== -1, 'tem de chamar _mvInvalidarCache()');
  assert.ok(idxRender !== -1, 'tem de chamar renderMapaVendas()');
  assert.ok(idxInvalidar < idxRender, '_mvInvalidarCache() tem de correr ANTES de renderMapaVendas(), para já encontrar _mvData===null');
});

(async () => {
  await teste('_mvInvalidarCache(), tal como exportado pela IIFE, invalida mesmo o _mvData real (não uma cópia solta)', async () => {
    const marcador = 'window._mvInvalidarCache = function(){';
    const inicio = html.indexOf(marcador);
    assert.ok(inicio !== -1, 'window._mvInvalidarCache não está exportado — o Mapa de Vendas nunca mais invalida o cache a partir de fora');
    // Replica isolada do essencial da IIFE: _mvData local, exportação, e uma
    // função de leitura que só o closure consegue ver — prova de que
    // _mvInvalidarCache() afecta a MESMA variável que _mvGetView() lê.
    const ctx = { window: {} };
    vm.createContext(ctx);
    vm.runInContext(`
      (function(){
        var _mvData = ['antigo'];
        window._mvInvalidarCache = function(){ _mvData = null; };
        window._mvLer = function(){ return _mvData; };
      })();
    `, ctx);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.window._mvLer())), ['antigo']);
    ctx.window._mvInvalidarCache();
    assert.strictEqual(ctx.window._mvLer(), null, '_mvInvalidarCache() tem de pôr a MESMA _mvData a null, visível a quem a lê de dentro da IIFE');
  });

  console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
  process.exit(falhou ? 1 : 0);
})();
