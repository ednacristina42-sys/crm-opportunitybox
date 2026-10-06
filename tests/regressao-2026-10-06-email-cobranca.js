// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — Email de Cobrança, Tesouraria (06/10/2026). A Edna
// pediu um local para guardar um texto padrão de email de cobrança
// ("deixe um local onde adicionarei um email padrão para isso"), usado pelo
// novo botão "📧 Email" em cada linha de "A Receber". Cobre
// tesEmailCobrancaPreencher() — a única parte pura/testável (o resto é
// DOM: modal de configuração, mailto:).
//
//   (a) todas as chaves conhecidas ({cliente}/{fatura}/{valor}/
//       {vencimento}/{dias_atraso}) são substituídas pelos dados reais.
//   (b) uma chave desconhecida entre chavetas fica tal e qual (nunca
//       rebenta, nunca apaga texto à toa).
//   (c) {valor} vem sempre formatado em euros, nunca o número em bruto.
//   (d) template vazio/undefined — devolve string vazia, nunca "undefined".
//
// Corre com: node tests/regressao-2026-10-06-email-cobranca.js
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

const SRC = extrairFuncao('tesEmailCobrancaPreencher');

function preencher(template, r, dias) {
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(SRC + '\n_RESULT = tesEmailCobrancaPreencher(_T, _R, _D);', Object.assign(ctx, { _T: template, _R: r, _D: dias }));
  return ctx._RESULT;
}

console.log('\n[a] Substitui todas as chaves conhecidas pelos dados reais');
{
  teste('template com as 5 chaves — todas substituídas', () => {
    const r = { cliente: 'ACME, Lda', descricao: 'Fatura 2026/501', total: 1234.5, vencimento: '10/10/2026' };
    const out = preencher('Caro {cliente}, a fatura {fatura} de {valor} venceu em {vencimento} há {dias_atraso} dias.', r, 12);
    assert.strictEqual(out, 'Caro ACME, Lda, a fatura Fatura 2026/501 de €1234,50 venceu em 10/10/2026 há 12 dias.');
  });

  teste('{fatura} usa r.numero quando não há descricao', () => {
    const r = { cliente: 'X', numero: 'FT 2026/9', total: 10, vencimento: '01/01/2026' };
    const out = preencher('{fatura}', r, 0);
    assert.strictEqual(out, 'FT 2026/9');
  });
}

console.log('\n[b] Chave desconhecida entre chavetas fica tal e qual');
{
  teste('{nao_existe} não é substituída nem rebenta', () => {
    const r = { cliente: 'X', total: 10, vencimento: '01/01/2026' };
    const out = preencher('Olá {cliente}, {nao_existe} aqui.', r, 0);
    assert.strictEqual(out, 'Olá X, {nao_existe} aqui.');
  });
}

console.log('\n[c] {valor} sempre formatado em euros');
{
  teste('valor inteiro — duas casas decimais, símbolo €', () => {
    const r = { cliente: 'X', total: 500, vencimento: '01/01/2026' };
    assert.strictEqual(preencher('{valor}', r, 0), '€500,00');
  });
  teste('valor como string (vindo de JSON) — parseFloat aplicado, nunca NaN', () => {
    const r = { cliente: 'X', total: '87.3', vencimento: '01/01/2026' };
    assert.strictEqual(preencher('{valor}', r, 0), '€87,30');
  });
}

console.log('\n[d] Template vazio/undefined — string vazia, nunca "undefined"');
{
  teste('template undefined', () => {
    assert.strictEqual(preencher(undefined, { cliente: 'X' }, 0), '');
  });
  teste('template vazio', () => {
    assert.strictEqual(preencher('', { cliente: 'X' }, 0), '');
  });
  teste('dias_atraso<=0 — mostra "0", nunca negativo', () => {
    const r = { cliente: 'X', total: 10, vencimento: '01/01/2026' };
    assert.strictEqual(preencher('{dias_atraso}', r, -5), '0');
  });
}

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou ? 1 : 0);
