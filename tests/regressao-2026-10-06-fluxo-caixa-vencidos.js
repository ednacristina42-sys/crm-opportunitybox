// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — Fluxo de Caixa / Previsão de Tesouraria, 90 dias
// (06/10/2026). A Edna reportou não conseguir "encontrar exatamente esses
// cálculos" — o gráfico tinha um pico enorme na 1.ª semana seguido de quase
// nada. Causa: finCalcularFluxoCaixaSemanal() metia TODOS os documentos já
// vencidos na semana 0 (bucket(d) devolvia 0 para qualquer data passada),
// inflando-a artificialmente — a maior parte do "A Pagar" real está vencida.
//
// Cobre, sem tocar em rede nem no Supabase real:
//   (a) um documento vencido (vencimento no passado) nunca entra em
//       nenhuma semana — nem na 0, nem nalguma negativa.
//   (b) um documento que vence hoje ou nos próximos 90 dias entra na
//       semana certa, como antes.
//   (c) um documento que vence depois da janela de 13 semanas fica de
//       fora (comportamento já existente, não mudou).
//   (d) caso concreto: metade vencido, metade a vencer — só a parte a
//       vencer aparece nos buckets; a soma das entradas/saídas nunca
//       inclui o valor vencido.
//
// Corre com: node tests/regressao-2026-10-06-fluxo-caixa-vencidos.js
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
  extrairFuncao('parseVencTes'),
  extrairFuncao('finParseVenc'),
  extrairFuncao('finCalcularFluxoCaixaSemanal'),
].join('\n');

function correr(globals) {
  const ctx = Object.assign({ console }, globals);
  vm.createContext(ctx);
  vm.runInContext(SRC + '\n_RESULT = finCalcularFluxoCaixaSemanal();', ctx);
  return ctx._RESULT;
}

function dataPT(diasAPartirDeHoje) {
  const d = new Date();
  d.setDate(d.getDate() + diasAPartirDeHoje);
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}

console.log('\n[a] Documento vencido — nunca entra em nenhuma semana');
{
  teste('fatura a receber vencida há 30 dias — não aparece em nenhum bucket de entradas', () => {
    const TES_RECEBER = [{ estado: 'Não Recebido', vencimento: dataPT(-30), total: 5000 }];
    const r = correr({ TES_RECEBER });
    const somaEntradas = r.entradas.reduce((s, v) => s + v, 0);
    assert.strictEqual(somaEntradas, 0, 'o valor vencido não devia aparecer em nenhum ponto do gráfico');
  });

  teste('conta a pagar vencida há 5 dias — não aparece em nenhum bucket de saídas', () => {
    const TES_CONTAS = [{ estado: 'Pendente', vencimento: dataPT(-5), valor: 2000 }];
    const r = correr({ TES_CONTAS });
    const somaSaidas = r.saidas.reduce((s, v) => s + v, 0);
    assert.strictEqual(somaSaidas, 0);
  });

  teste('compra TOConline (aPagar) vencida há 60 dias — não aparece', () => {
    const TES_COMPRAS_TOCO = { aPagar: [{ vencimento: dataPT(-60), pendente: 9999 }] };
    const r = correr({ TES_COMPRAS_TOCO });
    const somaSaidas = r.saidas.reduce((s, v) => s + v, 0);
    assert.strictEqual(somaSaidas, 0);
  });
}

console.log('\n[b] Documento a vencer dentro da janela de 90 dias — entra na semana certa');
{
  teste('fatura a vencer daqui a 10 dias — entra no bucket da semana 1 (dias 7-13)', () => {
    const TES_RECEBER = [{ estado: 'Não Recebido', vencimento: dataPT(10), total: 1234 }];
    const r = correr({ TES_RECEBER });
    assert.strictEqual(r.entradas[1], 1234);
    assert.strictEqual(r.entradas.reduce((s, v) => s + v, 0), 1234, 'só devia aparecer uma vez, no bucket certo');
  });

  teste('conta a pagar que vence hoje — entra no bucket 0 (semana actual, nunca excluída)', () => {
    const TES_CONTAS = [{ estado: 'Pendente', vencimento: dataPT(0), valor: 777 }];
    const r = correr({ TES_CONTAS });
    assert.strictEqual(r.saidas[0], 777, 'vencer HOJE não é "vencido" — continua a contar na semana actual');
  });
}

console.log('\n[c] Documento fora da janela de 13 semanas — fica de fora, como já acontecia');
{
  teste('fatura a vencer daqui a 200 dias — não entra em nenhum bucket (fora da janela de 90 dias)', () => {
    const TES_RECEBER = [{ estado: 'Não Recebido', vencimento: dataPT(200), total: 50000 }];
    const r = correr({ TES_RECEBER });
    assert.strictEqual(r.entradas.reduce((s, v) => s + v, 0), 0);
  });
}

console.log('\n[d] Caso concreto — metade vencido, metade a vencer: só a parte a vencer aparece');
{
  teste('2 contas a pagar, uma vencida e outra a vencer — soma das saídas é só a parte a vencer', () => {
    const TES_CONTAS = [
      { estado: 'Pendente', vencimento: dataPT(-15), valor: 149110.49 }, // vencida — fica de fora
      { estado: 'Pendente', vencimento: dataPT(20), valor: 36365.28 },   // a vencer — conta
    ];
    const r = correr({ TES_CONTAS });
    const somaSaidas = r.saidas.reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(somaSaidas - 36365.28) < 0.01, 'a soma devia ser só a parte a vencer, nunca incluir a vencida');
  });
}

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou ? 1 : 0);
