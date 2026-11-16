// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — despAppEstadoNorm() não reconhecia o estado "paga"
// (ou "pago"/"paid") enviado pelo app de pontos, por isso essas despesas
// nunca entravam em nenhum dos 4 estados contabilizados (Pendente/
// Submetida/Aprovada/Rejeitada/Reembolsada) — os cartões "Pendentes",
// "Reembolsos" e "Aprovadas" ficavam sempre a €0, por mais despesas pagas
// que existissem (13/11/2026, Edna: "pq nao preenche estes dados? se nao
// preencher que adianta ter um valor só o tempo todo?"). Decisão da Edna:
// "paga" conta como reembolso já concluído.
//
// Corre com: node tests/regressao-2026-11-13-desp-app-estado-paga.js
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

const SRC = extrairFuncao('despAppEstadoNorm');

function rodar(estadoBruto) {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(SRC + '\nthis._r = despAppEstadoNorm(' + JSON.stringify(estadoBruto) + ');', ctx);
  return ctx._r;
}

console.log('\n[A] despAppEstadoNorm() reconhece "paga"/"pago"/"paid" como reembolso concluído');

teste('"paga" (o que o app de pontos manda de facto) -> reimbursed', () => {
  assert.strictEqual(rodar('paga'), 'reimbursed');
});
teste('"Pago" (maiúscula) -> reimbursed', () => {
  assert.strictEqual(rodar('Pago'), 'reimbursed');
});
teste('"paid" (inglês) -> reimbursed', () => {
  assert.strictEqual(rodar('paid'), 'reimbursed');
});
teste('continua a reconhecer os estados já existentes, sem regressão', () => {
  assert.strictEqual(rodar('aprovada'), 'approved');
  assert.strictEqual(rodar('pendente'), 'pending');
  assert.strictEqual(rodar('rejeitada'), 'rejected');
  assert.strictEqual(rodar('reembolsada'), 'reimbursed');
  assert.strictEqual(rodar('submetida'), 'submitted');
});
teste('não apanha por engano palavras que só começam por "pag" mas não são "paga/pago" (ex.: "pagamento")', () => {
  assert.notStrictEqual(rodar('pagamento pendente'), 'reimbursed');
});

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou ? 1 : 0);
