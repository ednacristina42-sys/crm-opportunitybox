// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — Tesouraria → IVA & Resumo, Fase C CFO (30/09/2026):
// corrige a duplicação "Impostos"==="IVA" (ambos mostravam sempre a mesma
// estimativa) e "Salários" preso a 0. Cobre tesIvaCalcularReal():
//
//   (a) Impostos deixa de duplicar o valor de IVA — vem só do lançamento
//       manual (TES_IMPOSTOS_MANUAIS via tesImpostosManuaisDe()), nunca
//       igual à estimativa de IVA, mesmo quando ambos existem.
//   (b) Salários lê finTotaisMesReal(ano,mes).custoFolha real — nunca mais
//       hardcoded a 0; fica 0 só quando folhaIndisponivel=true (sem dados
//       genuínos, igual ao resto do Dashboard CFO).
//   (c) "Valor Real Pago" de IVA (ivaArr) vem do lançamento manual
//       (ivaPago) — fica null (nunca inventado) quando não preenchido.
//   (d) Saldo = Vendas − Compras − Impostos − IVA(estimativa) − Salários,
//       as 4 componentes reais, mesma fórmula do Excel da Edna.
//   (e) Um mês só com lançamento manual (sem vendas/compras TOConline)
//       continua a aparecer — não é descartado pelo filtro de "mês vazio".
//
// Corre com: node tests/regressao-2026-09-30-iva-resumo-impostos.js
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
  extrairFuncao('finTotaisMesReal'),
  extrairFuncao('tesImpostosManuaisDe'),
  extrairFuncao('tesIvaCalcularReal'),
].join('\n');

function correr(globals) {
  const ctx = Object.assign({
    console,
    FIN_MESES: ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'],
    TES_MESES: ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'],
    TES_RECEBER: [], TES_CONTAS: [], TES_COMPRAS_TOCO: {},
    TES_IMPOSTOS_MANUAIS: {},
  }, globals);
  vm.createContext(ctx);
  vm.runInContext(SRC + '\n_RESULT = tesIvaCalcularReal();', ctx);
  return ctx._RESULT;
}

const ANO = new Date().getFullYear();
const MES_ATUAL_IDX = new Date().getMonth(); // 0-based
const PREFIXO_ATUAL = ANO + '-' + String(MES_ATUAL_IDX + 1).padStart(2, '0');
const NOME_MES_ATUAL = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'][MES_ATUAL_IDX];

console.log('\n[a] Impostos não duplica a estimativa de IVA');
{
  teste('mês com vendas/compras reais e Impostos manual — impostos != estimativa de IVA', () => {
    const TES_RECEBER = [{ total: 10000, ivaPct: 23, dataEmissao: '01/' + String(MES_ATUAL_IDX + 1).padStart(2, '0') + '/' + ANO, estado: 'Recebido' }];
    const TES_IMPOSTOS_MANUAIS = { [PREFIXO_ATUAL]: { impostos: 500, ivaPago: null, nota: '' } };
    const r = correr({ TES_RECEBER, TES_IMPOSTOS_MANUAIS });
    const linha = r.resumo.find(x => x.mes === NOME_MES_ATUAL);
    assert.ok(linha, 'devia ter uma linha para o mês actual');
    assert.strictEqual(linha.impostos, 500, 'impostos vem do lançamento manual');
    assert.notStrictEqual(linha.impostos, linha.iva, 'impostos NUNCA deve ser igual ao IVA (bug antigo)');
  });

  teste('sem lançamento manual — impostos=0, nunca herda a estimativa de IVA', () => {
    const TES_RECEBER = [{ total: 10000, ivaPct: 23, dataEmissao: '01/' + String(MES_ATUAL_IDX + 1).padStart(2, '0') + '/' + ANO, estado: 'Recebido' }];
    const r = correr({ TES_RECEBER });
    const linha = r.resumo.find(x => x.mes === NOME_MES_ATUAL);
    assert.strictEqual(linha.impostos, 0);
    assert.ok(linha.iva > 0, 'a estimativa de IVA continua a ser calculada normalmente');
  });
}

console.log('\n[b] Salários lê finTotaisMesReal().custoFolha — nunca hardcoded a 0');
{
  teste('mês com "Salários — <Mês>" completo em TES_CONTAS — salarios > 0', () => {
    const mesNome = NOME_MES_ATUAL;
    const TES_CONTAS = [{
      estado: 'Paga', categoria: 'Salários', descricao: 'Salários — ' + mesNome,
      dataPagamento: '05/' + String(MES_ATUAL_IDX + 1).padStart(2, '0') + '/' + ANO,
      folhaBruto: 3000, folhaSSEmpresa: 712.5, valor: 2500,
    }];
    const r = correr({ TES_CONTAS });
    const linha = r.resumo.find(x => x.mes === mesNome);
    assert.ok(linha, 'devia aparecer mesmo só com a conta de Salários (despesas conta como "compra")');
    assert.strictEqual(linha.salarios, 3712.5);
  });

  teste('mês sem entrada de Salários — salarios=0, nunca NaN/undefined', () => {
    const TES_RECEBER = [{ total: 1000, ivaPct: 23, dataEmissao: '01/' + String(MES_ATUAL_IDX + 1).padStart(2, '0') + '/' + ANO, estado: 'Recebido' }];
    const r = correr({ TES_RECEBER });
    const linha = r.resumo.find(x => x.mes === NOME_MES_ATUAL);
    assert.strictEqual(linha.salarios, 0);
  });
}

console.log('\n[c] "Valor Real Pago" de IVA vem do lançamento manual, nunca inventado');
{
  teste('ivaPago preenchido manualmente — aparece em ivaArr[].valorPago', () => {
    const TES_RECEBER = [{ total: 1000, ivaPct: 23, dataEmissao: '01/' + String(MES_ATUAL_IDX + 1).padStart(2, '0') + '/' + ANO, estado: 'Recebido' }];
    const TES_IMPOSTOS_MANUAIS = { [PREFIXO_ATUAL]: { impostos: 0, ivaPago: 187.3, nota: '' } };
    const r = correr({ TES_RECEBER, TES_IMPOSTOS_MANUAIS });
    const linha = r.iva.find(x => x.mes === NOME_MES_ATUAL);
    assert.strictEqual(linha.valorPago, 187.3);
  });

  teste('sem lançamento manual — valorPago=null, nunca 0 nem a estimativa', () => {
    const TES_RECEBER = [{ total: 1000, ivaPct: 23, dataEmissao: '01/' + String(MES_ATUAL_IDX + 1).padStart(2, '0') + '/' + ANO, estado: 'Recebido' }];
    const r = correr({ TES_RECEBER });
    const linha = r.iva.find(x => x.mes === NOME_MES_ATUAL);
    assert.strictEqual(linha.valorPago, null);
  });
}

console.log('\n[d] Saldo = Vendas - Compras - Impostos - IVA - Salários (fórmula do Excel da Edna)');
{
  teste('caso concreto com as 5 componentes todas presentes', () => {
    const mesNome = NOME_MES_ATUAL;
    const dataMes = String(MES_ATUAL_IDX + 1).padStart(2, '0') + '/' + ANO;
    const TES_RECEBER = [{ total: 12300, ivaPct: 23, dataEmissao: '01/' + dataMes, estado: 'Recebido' }];
    const TES_CONTAS = [
      { estado: 'Paga', categoria: 'Fornecedor', descricao: 'Material', dataPagamento: '02/' + dataMes, valor: 1000, ivaPct: 23 },
      { estado: 'Paga', categoria: 'Salários', descricao: 'Salários — ' + mesNome, dataPagamento: '05/' + dataMes, folhaBruto: 2000, folhaSSEmpresa: 475 },
    ];
    const TES_IMPOSTOS_MANUAIS = { [PREFIXO_ATUAL]: { impostos: 300, ivaPago: null, nota: '' } };
    const r = correr({ TES_RECEBER, TES_CONTAS, TES_IMPOSTOS_MANUAIS });
    const linha = r.resumo.find(x => x.mes === mesNome);
    const vendas = linha.vendas, despesas = linha.despesas, impostos = linha.impostos, iva = linha.iva, salarios = linha.salarios;
    const esperado = vendas - despesas - impostos - iva - salarios;
    assert.ok(Math.abs(linha.saldo - esperado) < 0.01, 'saldo devia bater exactamente com a fórmula das 5 componentes');
    assert.strictEqual(salarios, 2475);
  });
}

console.log('\n[e] Mês só com lançamento manual (sem vendas/compras) continua a aparecer');
{
  teste('TES_IMPOSTOS_MANUAIS preenchido para um mês sem nenhum outro dado — não é descartado', () => {
    const TES_IMPOSTOS_MANUAIS = { [PREFIXO_ATUAL]: { impostos: 150, ivaPago: null, nota: 'IRC' } };
    const r = correr({ TES_IMPOSTOS_MANUAIS });
    const linha = r.resumo.find(x => x.mes === NOME_MES_ATUAL);
    assert.ok(linha, 'o mês tem de aparecer mesmo sem vendas/compras — só tem o lançamento manual');
    assert.strictEqual(linha.impostos, 150);
    assert.strictEqual(linha.vendas, 0);
  });

  teste('mês genuinamente vazio (nada, nenhures) — continua ausente, como antes', () => {
    const r = correr({});
    assert.strictEqual(r.resumo.length, 0);
    assert.strictEqual(r.iva.length, 0);
  });
}

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou ? 1 : 0);
