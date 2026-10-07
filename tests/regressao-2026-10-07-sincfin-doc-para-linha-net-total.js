// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — sincFinDocParaLinhaTes(): usar o net_total real do
// TOConline em vez de estimar sempre 23% de IVA (07/10/2026).
//
// Pedido da Edna: "o valor do mapa de vendas do TOConline é diferente do
// nosso... esse mesmo valor tem que ser igual". Causa raiz: esta função
// converte documentos REAIS da API do TOConline (faturas/NC) para as linhas
// que alimentam o "Total Faturado" do Mapa de Vendas — e calculava sempre
// valorLiq = total / 1.23, ignorando o net_total real que a Edge Function já
// devolve (achatarDocumento()). Qualquer fatura com IVA reduzido/isento, ou
// mesmo só arredondamentos, fazia o total do CRM divergir do "Rendimentos"
// que o TOConline mostra — exactamente o mesmo tipo de bug já corrigido em
// sincFinAplicarSheetPura() (pedido de 06/10/2026), mas que tinha ficado por
// corrigir aqui.
//
// Corre com: node tests/regressao-2026-10-07-sincfin-doc-para-linha-net-total.js
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

const SRC = [
  extrairFuncao('sincFinDataISO'),
  extrairFuncao('sincFinDocParaLinhaTes'),
].join('\n');

function rodar(doc, tipoTes) {
  const ctx = { tesResolverVendedor: function(){ return ''; } };
  vm.createContext(ctx);
  vm.runInContext(SRC + '\nthis._r = sincFinDocParaLinhaTes(' + JSON.stringify(doc) + ', ' + JSON.stringify(tipoTes) + ');', ctx);
  return ctx._r;
}

console.log('\n[A] sincFinDocParaLinhaTes() usa o net_total real do TOConline, não uma estimativa fixa de 23% de IVA');

teste('FT com net_total real (IVA reduzido, não bate com /1.23) — usa o net_total tal qual', () => {
  const doc = { id: 1, document_no: 'FT 1/1', date: '2026-10-01', gross_total: 106, net_total: 100, pending_total: 0, customer_business_name: 'Cliente X' };
  const r = rodar(doc, 'FT');
  assert.strictEqual(r.valorLiq, 100, 'tinha de usar o net_total real (100), não total/1.23 (' + (106/1.23).toFixed(2) + ')');
  assert.strictEqual(r.total, 106);
});

teste('NC com net_total real — valorLiq negativo, usando o net_total (não /1.23)', () => {
  const doc = { id: 2, document_no: 'NC 1/1', date: '2026-10-02', gross_total: 53, net_total: 50, pending_total: 0, customer_business_name: 'Cliente Y' };
  const r = rodar(doc, 'NC');
  assert.strictEqual(r.valorLiq, -50);
  assert.strictEqual(r.total, -53);
});

teste('doc sem net_total (campo ausente) — cai no fallback /1.23, comportamento antigo preservado', () => {
  const doc = { id: 3, document_no: 'FT 1/2', date: '2026-10-03', gross_total: 123, pending_total: 0, customer_business_name: 'Cliente Z' };
  const r = rodar(doc, 'FT');
  assert.strictEqual(r.valorLiq, 100, '123/1.23 = 100, só como fallback');
});

teste('doc com net_total=0 explícito (ex.: documento totalmente isento) — usa 0 real, não o fallback', () => {
  const doc = { id: 4, document_no: 'FT 1/3', date: '2026-10-04', gross_total: 0, net_total: 0, pending_total: 0, customer_business_name: 'Cliente W' };
  const r = rodar(doc, 'FT');
  assert.strictEqual(r.valorLiq, 0);
});

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou ? 1 : 0);
