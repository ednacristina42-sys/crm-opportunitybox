// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — correção 29/09/2026 (Financeiro: "A Receber"/"Vencido"
// deixam de somar o total inteiro da fatura em faturas 'Recebido Parcial')
//
// Cobre, sem tocar em rede nem no Supabase real:
//   1. finSaldoReceber() — a nova fonte canónica do saldo real por cobrar
//      de uma linha de TES_RECEBER: 'Recebido' → 0; 'Recebido Parcial' →
//      saldoAReceber (não o total inteiro); qualquer outro estado
//      ('Não Recebido', etc.) → total inteiro.
//   2. Caso concreto pedido na auditoria: 'Não Recebido' (total €1000) +
//      'Recebido Parcial' (total €1000, já recebido €600 → €400 em falta) +
//      'Recebido' (total €1000, €0 em falta) deve somar exatamente €1400,
//      nunca €2000 (comportamento antigo, errado, que somava o total
//      inteiro mesmo em faturas parcialmente recebidas).
//   3. Uma linha 'NC' (nota de crédito) é excluída quando o chamador aplica
//      o filtro tipo!=='NC' — mesma convenção já usada em tesGetReceber()/
//      tesGetRecebidos()/_hfApplyFilters() (NC é uma redução de faturação,
//      nunca uma dívida em aberto).
//
// Corre com: node tests/regressao-2026-09-29-saldo-receber.js
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
  catch (e) { console.log('FALHA — ' + nome + '\n        ' + (e && e.message)); falhou++; }
}

// ── Extrai o corpo de uma função "function NOME(...) { ... }" do index.html
// por contagem de chavetas (mesma técnica de tests/regressao-2026-09-24.js).
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

function correFinSaldoReceber(r) {
  const src = extrairFuncao('finSaldoReceber');
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(src + '\n_RESULT = finSaldoReceber(_ROW);', Object.assign(ctx, { _ROW: r }));
  return ctx._RESULT;
}

console.log('\n[1] finSaldoReceber() — saldo real por cobrar de uma linha de TES_RECEBER');
{
  teste('estado "Recebido" — saldo 0, mesmo com total>0', () => {
    assert.strictEqual(correFinSaldoReceber({ estado: 'Recebido', total: 1000 }), 0);
  });
  teste('estado "Não Recebido" — saldo = total inteiro', () => {
    assert.strictEqual(correFinSaldoReceber({ estado: 'Não Recebido', total: 1000 }), 1000);
  });
  teste('estado "Recebido Parcial" — saldo = saldoAReceber, NUNCA o total inteiro', () => {
    assert.strictEqual(correFinSaldoReceber({ estado: 'Recebido Parcial', total: 1000, valorRecebido: 600, saldoAReceber: 400 }), 400);
  });
  teste('estado "Recebido Parcial" sem saldoAReceber gravado — nunca inventa (0), não cai no total', () => {
    assert.strictEqual(correFinSaldoReceber({ estado: 'Recebido Parcial', total: 1000, valorRecebido: 600 }), 0);
  });
  teste('linha nula/indefinida — 0, nunca rebenta', () => {
    assert.strictEqual(correFinSaldoReceber(null), 0);
  });
  teste('total como string (vindo de JSON/planilha) — parseFloat aplicado', () => {
    assert.strictEqual(correFinSaldoReceber({ estado: 'Não Recebido', total: '1000' }), 1000);
  });
}

console.log('\n[2] Caso concreto da auditoria — soma de 3 faturas deve dar €1400, nunca €2000');
{
  const linhas = [
    { id: 'F1', estado: 'Não Recebido', total: 1000 },
    { id: 'F2', estado: 'Recebido Parcial', total: 1000, valorRecebido: 600, saldoAReceber: 400 },
    { id: 'F3', estado: 'Recebido', total: 1000 },
  ];
  teste('soma finSaldoReceber() das 3 linhas = 1400 (não 2000, o total bruto das 3 faturas)', () => {
    const soma = linhas.reduce((s, r) => s + correFinSaldoReceber(r), 0);
    assert.strictEqual(soma, 1400);
    assert.notStrictEqual(soma, 2000, 'comportamento antigo (somar r.total sempre) nunca deve voltar');
  });
}

console.log('\n[3] NC excluído quando o chamador aplica o filtro tipo!==\'NC\' (mesma convenção de tesGetReceber)');
{
  const linhas = [
    { id: 'F1', tipo: 'FT', estado: 'Não Recebido', total: 1000 },
    { id: 'NC1', tipo: 'NC', estado: 'Não Recebido', total: -200 },
  ];
  teste('filtro tipo!==\'NC\' antes de somar finSaldoReceber() exclui a nota de crédito', () => {
    const semNC = linhas.filter(r => r.tipo !== 'NC');
    assert.strictEqual(semNC.length, 1);
    const soma = semNC.reduce((s, r) => s + correFinSaldoReceber(r), 0);
    assert.strictEqual(soma, 1000);
  });
}

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou > 0 ? 1 : 0);
