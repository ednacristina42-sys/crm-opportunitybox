// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — mvSincronizarGoogleSheet(): os dois travões
// (sincronização já em curso / travão de 2min entre sincronizações)
// devolviam em silêncio, sem qualquer aviso (07/10/2026).
//
// mvSincronizarGoogleSheet() corre automaticamente sempre que se navega
// para "Mapa de Vendas" (goPage, linha ~13037), além do clique manual no
// botão. Isso significa que clicar no botão pouco depois de ter entrado na
// página (ou pouco depois de outra sincronização) caía quase sempre no
// travão de 2 minutos — e, como não avisava nada, parecia exactamente "o
// botão não funciona" (reportado pela Edna, 07/10/2026, depois de testar a
// sincronização várias vezes seguidas). Agora avisa sempre via showToast.
//
// Corre com: node tests/regressao-2026-10-07-mv-sync-travao-silencioso.js
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
  extrairFuncao('crmVeTudo'),
  'async ' + extrairFuncao('mvSincronizarGoogleSheet'),
].join('\n');

async function correr(ctxExtra) {
  var toasts = [];
  var fetchChamado = false;
  const doc = { getElementById: function () { return null; } };
  const ctx = Object.assign({
    console, document: doc, CU: { admin: true, role: 'administrativo', name: 'Edna Faria' },
    MV_SYNC_EM_CURSO: false, MV_SYNC_ULTIMA_EXECUCAO: 0,
    localStorage: { setItem: function () {}, getItem: function () { return null; } },
    mvFetchOrcSheetCSV: async function () { fetchChamado = true; throw new Error('rede não disponível no teste'); },
    showToast: function (msg) { toasts.push(msg); },
  }, ctxExtra);
  vm.createContext(ctx);
  ctx._done = vm.runInContext(SRC + '\nmvSincronizarGoogleSheet();', ctx);
  await ctx._done;
  return { fetchChamado: fetchChamado, toasts: toasts };
}

(async () => {
  console.log('\n[A] mvSincronizarGoogleSheet() avisa sempre quando um travão impede a sincronização de arrancar');

  await teste('MV_SYNC_EM_CURSO=true — nunca tenta buscar, mas avisa com showToast', async () => {
    const r = await correr({ MV_SYNC_EM_CURSO: true });
    assert.strictEqual(r.fetchChamado, false);
    assert.ok(r.toasts.length >= 1, 'tinha de avisar que já há uma sincronização em curso — antes não dizia nada');
    assert.ok(/em curso/i.test(r.toasts[0]));
  });

  await teste('travão de 2min (sincronizou há poucos segundos) — nunca tenta buscar, mas avisa quanto falta esperar', async () => {
    const r = await correr({ MV_SYNC_ULTIMA_EXECUCAO: Date.now() - 5000 }); // há 5s, faltam ~115s
    assert.strictEqual(r.fetchChamado, false);
    assert.ok(r.toasts.length >= 1, 'tinha de avisar do travão de 2min — antes não dizia nada, parecia "o botão não funciona"');
    assert.ok(/aguarde/i.test(r.toasts[0]) && /s\b/.test(r.toasts[0]));
  });

  await teste('fora do travão (sincronizou há mais de 2min) — tenta buscar normalmente, sem aviso de bloqueio', async () => {
    const r = await correr({ MV_SYNC_ULTIMA_EXECUCAO: Date.now() - 200000 });
    assert.strictEqual(r.fetchChamado, true, 'passado o travão, tinha de chegar a tentar a sincronização normalmente');
  });

  console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
  process.exit(falhou ? 1 : 0);
})();
