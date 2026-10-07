// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — Mapa de Vendas: sincronização automática da folha
// "Orçamentos 2026" parada desde 21/09/2026 (07/10/2026, cliente perguntou
// "aqui não está atualizado?" ao ver o Mapa de Vendas muito desactualizado).
//
// Causa raiz confirmada: a tabela ob_orcamentos não recebia nenhuma linha
// nova desde o dia em que mvSincronizarGoogleSheet() foi criada
// (21/09/2026) — a própria função só corre para CU.admin===true à letra,
// nunca para CU.role==='administrativo' (o critério "vê tudo" usado em
// todo o resto do CRM, crmVeTudo()). Como a conta do dia-a-dia da Edna/
// Carolina usa 'administrativo', a sincronização nunca disparava — sem
// nenhum erro nem aviso, por isso ninguém reparou durante duas semanas.
//
// Cobre só o portão de autorização (a parte testável sem rede real):
//   (a) CU.role==='administrativo' — passa o portão, tenta sincronizar.
//   (b) CU.admin===true — continua a passar (comportamento antigo intacto).
//   (c) comercial/sem sessão — continua bloqueado, como sempre foi.
//
// Corre com: node tests/regressao-2026-10-07-sync-mapa-vendas-administrativo.js
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

async function correr(CU) {
  var fetchChamado = false;
  const doc = { getElementById: function () { return null; } };
  const ctx = {
    console, document: doc, CU: CU,
    MV_SYNC_EM_CURSO: false, MV_SYNC_ULTIMA_EXECUCAO: 0,
    localStorage: { setItem: function () {}, getItem: function () { return null; } },
    mvFetchOrcSheetCSV: async function () { fetchChamado = true; throw new Error('rede não disponível no teste — só queremos saber se chegou aqui'); },
    _done: null,
  };
  vm.createContext(ctx);
  ctx._done = vm.runInContext(SRC + '\nmvSincronizarGoogleSheet();', ctx);
  await ctx._done;
  return fetchChamado;
}

(async () => {
  console.log('\n[A] mvSincronizarGoogleSheet() — portão de autorização usa o mesmo critério "vê tudo" (crmVeTudo), não CU.admin===true à letra');

  await teste('CU.role==="administrativo" (conta do dia-a-dia da Edna) — passa o portão, tenta sincronizar', async () => {
    const chamou = await correr({ admin: false, role: 'administrativo', name: 'Edna Faria' });
    assert.strictEqual(chamou, true, 'com administrativo, tinha de chegar a tentar buscar a folha — antes nunca chegava aqui');
  });

  await teste('CU.admin===true — continua a passar (comportamento antigo intacto)', async () => {
    const chamou = await correr({ admin: true, role: 'comercial', name: 'X' });
    assert.strictEqual(chamou, true);
  });

  await teste('comercial normal (nem admin nem administrativo) — continua bloqueado', async () => {
    const chamou = await correr({ admin: false, role: 'comercial', name: 'Rui Mota' });
    assert.strictEqual(chamou, false);
  });

  await teste('sem sessão (CU undefined) — nunca rebenta, continua bloqueado', async () => {
    const chamou = await correr(undefined);
    assert.strictEqual(chamou, false);
  });

  console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
  process.exit(falhou ? 1 : 0);
})();
