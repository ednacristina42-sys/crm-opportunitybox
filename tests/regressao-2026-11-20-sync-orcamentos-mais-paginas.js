// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — mvSincronizarGoogleSheet() (orçamentos novos da
// folha "Mapa de vendas" dos comerciais, em ob_orcamentos) só corria
// quando alguém abria a página "Mapa de Vendas". Confirmado na base de
// dados (20/11/2026): a última importação foi há 8 dias (12/11), porque
// ninguém abriu essa página específica desde então — mesmo com os
// comerciais a editar a folha todos os dias.
//
// Pedido da Edna (20/11/2026, "deixar de usar o Excel"): chamar também
// ao abrir o Dashboard e a Tesouraria — páginas que qualquer pessoa com
// perfil admin abre com muito mais frequência — para nunca ficar mais de
// um dia sem atualizar. mvSincronizarGoogleSheet() já tem o seu próprio
// travão de 2 minutos e verificação de permissão (crmVeTudo()), por isso
// é seguro chamar de vários pontos sem duplicar nem sobrecarregar.
//
// A função goPage() é enorme e manipula DOM extensivamente — em vez de a
// executar (precisaria de simular toda a navegação), este teste verifica
// a ESTRUTURA do código: cada bloco "if(id===...)" relevante tem de
// conter a chamada a mvSincronizarGoogleSheet(), tal como o teste de
// 17/11/2026 sobre ordem de declaração de <script> verificou estrutura
// em vez de executar código.
//
// Corre com: node tests/regressao-2026-11-20-sync-orcamentos-mais-paginas.js
// Sem dependências externas — só Node core (fs, assert).
// ══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const assert = require('assert');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

let passou = 0, falhou = 0;
function teste(nome, fn) {
  try { fn(); console.log('  ok  — ' + nome); passou++; }
  catch (e) { console.log('FALHA — ' + nome + '\n        ' + (e && e.stack)); falhou++; }
}

function extrairBlocoLinha(marcadorLinha) {
  const inicio = html.indexOf(marcadorLinha);
  if (inicio === -1) throw new Error('marcador não encontrado: "' + marcadorLinha + '"');
  const fimLinha = html.indexOf('\n', inicio);
  return html.slice(inicio, fimLinha === -1 ? html.length : fimLinha);
}

console.log('\n[A] mvSincronizarGoogleSheet() continua a correr no Mapa de Vendas (não regredir o que já existia)');

teste('bloco "mapa-vendas" ainda chama mvSincronizarGoogleSheet()', () => {
  const bloco = extrairBlocoLinha("if(id==='mapa-vendas'&&typeof mvSincronizarGoogleSheet");
  assert.ok(bloco.indexOf('mvSincronizarGoogleSheet()') !== -1);
});

console.log('\n[B] mvSincronizarGoogleSheet() passa a correr também no Dashboard e na Tesouraria');

teste('bloco "dashboard" chama mvSincronizarGoogleSheet()', () => {
  const bloco = extrairBlocoLinha("if(id==='dashboard')");
  assert.ok(bloco.indexOf('mvSincronizarGoogleSheet()') !== -1, 'bloco do dashboard: ' + bloco);
});

teste('bloco "tesouraria" chama mvSincronizarGoogleSheet()', () => {
  const bloco = extrairBlocoLinha("if (id === 'tesouraria')");
  assert.ok(bloco.indexOf('mvSincronizarGoogleSheet()') !== -1, 'bloco da tesouraria: ' + bloco);
});

teste('as chamadas novas continuam protegidas por typeof (nunca rebentam se a função não existir)', () => {
  const blocoDash = extrairBlocoLinha("if(id==='dashboard')");
  const blocoTes = extrairBlocoLinha("if (id === 'tesouraria')");
  assert.ok(blocoDash.indexOf("typeof mvSincronizarGoogleSheet==='function'") !== -1);
  assert.ok(blocoTes.indexOf("typeof mvSincronizarGoogleSheet==='function'") !== -1);
});

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou ? 1 : 0);
