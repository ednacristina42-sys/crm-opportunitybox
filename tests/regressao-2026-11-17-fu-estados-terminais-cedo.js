// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — FU_ESTADOS_LEAD_TERMINAIS (e FU_ESTADOS_ORC_TERMINAIS)
// tinham a sua ÚNICA declaração muito à frente no ficheiro, num <script>
// separado do resto. Se qualquer código mais cedo NESSE MESMO <script>
// lançasse uma exceção síncrona no arranque (window.onerror apanha-a e
// regista-a, mas não impede o resto desse bloco de parar), o resto desse
// <script> — incluindo esta declaração — nunca chegava a correr, e qualquer
// função que a usasse antes (crmUpdateFunnel(), chamada pela sincronização
// em tempo real) rebentava com "FU_ESTADOS_LEAD_TERMINAIS is not defined".
//
// Reportado pela Edna em produção, 17/11/2026, logo depois da correção do
// filtro do Realtime (13/11/2026) ter feito obSbMesclarRemotoAntesDoBackup()
// disparar de verdade pela primeira vez — um caminho nunca antes exercitado.
//
// Corrigido movendo a declaração para muito mais cedo no ficheiro (logo a
// seguir ao window.onerror, antes de qualquer outro <script>), onde fica
// imune a uma exceção tardia noutro bloco. A declaração original mais à
// frente foi deixada (redundante, mas inofensiva — var permite reatribuir).
// Este teste verifica só a POSIÇÃO da primeira declaração; não reproduz a
// semântica real de <script> tags separados (o harness de testes desta
// suite corre tudo num único vm.createContext, por isso não apanharia a
// falha original por si só).
//
// Corre com: node tests/regressao-2026-11-17-fu-estados-terminais-cedo.js
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

function linhaDe(indiceChar) {
  return html.slice(0, indiceChar).split('\n').length;
}

console.log('\n[A] FU_ESTADOS_LEAD_TERMINAIS/FU_ESTADOS_ORC_TERMINAIS declarados cedo no ficheiro, antes de qualquer outro <script>');

// Limite generoso (bem dentro do primeiro <script>, que só fecha muito mais
// à frente no ficheiro — o window.onerror/EventBus que o abrem vivem nas
// primeiras ~40 linhas) — não compara contra "o próximo <script>" por texto
// literal, porque o próprio comentário desta correção menciona "<script>"
// como texto, o que confundia uma busca ingénua por substring.
const LIMITE_LINHA = 60;

teste('FU_ESTADOS_LEAD_TERMINAIS: a PRIMEIRA declaração está bem cedo no ficheiro (linha <= ' + LIMITE_LINHA + ')', () => {
  const idxDecl = html.indexOf('var FU_ESTADOS_LEAD_TERMINAIS');
  assert.ok(idxDecl !== -1, 'declaração não encontrada');
  const linha = linhaDe(idxDecl);
  assert.ok(linha <= LIMITE_LINHA, 'está na linha ' + linha + ', devia estar perto do topo do ficheiro (<= ' + LIMITE_LINHA + ')');
});

teste('FU_ESTADOS_ORC_TERMINAIS: a PRIMEIRA declaração também está cedo, junto à de FU_ESTADOS_LEAD_TERMINAIS', () => {
  const idxDecl = html.indexOf('var FU_ESTADOS_ORC_TERMINAIS');
  assert.ok(idxDecl !== -1, 'declaração não encontrada');
  const linha = linhaDe(idxDecl);
  assert.ok(linha <= LIMITE_LINHA, 'está na linha ' + linha + ', devia estar perto do topo do ficheiro (<= ' + LIMITE_LINHA + ')');
});

teste('os valores continuam exatamente os mesmos de sempre (nenhum estado novo inventado)', () => {
  const m = html.match(/var FU_ESTADOS_LEAD_TERMINAIS\s*=\s*(\[[^\]]*\]);/);
  assert.ok(m, 'não encontrou a atribuição');
  const valores = eval(m[1]); // eslint-disable-line no-eval -- só lê um array literal de strings, controlado por nós
  assert.deepStrictEqual(valores, ['Produção/Adjudicação', 'Orçamento Perdido', 'Arquivo']);
});

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou ? 1 : 0);
