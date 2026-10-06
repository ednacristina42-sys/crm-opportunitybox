// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — feedback da secretária sobre o teste da Fase C/D
// (06/10/2026), dois bugs reais:
//
//   (A) Tesouraria → IVA & Resumo: "Salários" continuava a €0 em meses sem
//       Fecho de Ordenados enviado — não havia onde lançar manualmente (a
//       secretária perguntou "o lançamento será individual ou geral?").
//       tesImpostosManuaisDe()/tesIvaCalcularReal() passam a aceitar um
//       lançamento manual GERAL (total do mês, mesmo padrão de "Impostos"),
//       usado só quando finTotaisMesReal().folhaIndisponivel===true — nunca
//       substitui o valor real do Fecho de Ordenados quando este existe.
//
//   (B) Análise de Vendas / Histórico de Faturação: a coluna "sem IVA" da
//       folha "Vendas 2026" chama-se, na prática, "Total Líquido" (coluna
//       E) — avFindCol() não reconhecia este nome, por isso idx.semIVA
//       ficava sempre -1 e sincFinAplicarSheetPura() caía sempre na
//       estimativa fixa de 23% (total/1.23), que não bate com o Excel da
//       Edna quando há taxas diferentes de IVA. Passa a usar o valor REAL
//       da coluna "Total Líquido" quando presente; só cai no /1.23 como
//       fallback se a Sheet genuinamente não tiver a coluna.
//
// Corre com: node tests/regressao-2026-10-06-salarios-manuais-semiva-real.js
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

function correNumContexto(src, chamada, globals) {
  const ctx = Object.assign({ console }, globals);
  vm.createContext(ctx);
  vm.runInContext(src + '\n_RESULT = ' + chamada + ';', ctx);
  return ctx._RESULT;
}

// ── (A) Salários — lançamento manual geral quando falta o Fecho ────────────
const SRC_TES = [
  extrairFuncao('parseVencTes'),
  extrairFuncao('finParseVenc'),
  extrairFuncao('finTotaisMesReal'),
  extrairFuncao('tesImpostosManuaisDe'),
  extrairFuncao('tesIvaCalcularReal'),
].join('\n');

function correrTes(globals) {
  const ctx = Object.assign({
    console,
    FIN_MESES: ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'],
    TES_MESES: ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'],
    TES_RECEBER: [], TES_CONTAS: [], TES_COMPRAS_TOCO: {},
    TES_IMPOSTOS_MANUAIS: {},
  }, globals);
  vm.createContext(ctx);
  vm.runInContext(SRC_TES + '\n_RESULT = tesIvaCalcularReal();', ctx);
  return ctx._RESULT;
}

const ANO = new Date().getFullYear();
const MES_ATUAL_IDX = new Date().getMonth();
const PREFIXO_ATUAL = ANO + '-' + String(MES_ATUAL_IDX + 1).padStart(2, '0');
const NOME_MES_ATUAL = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'][MES_ATUAL_IDX];

console.log('\n[A] tesImpostosManuaisDe() devolve também "salarios" (geral, por mês)');
{
  teste('lançamento manual com salarios preenchido', () => {
    const SRC = extrairFuncao('tesImpostosManuaisDe');
    const r = correNumContexto(SRC, 'tesImpostosManuaisDe(_M)', { _M: 'x', TES_IMPOSTOS_MANUAIS: { x: { impostos: 10, ivaPago: null, salarios: 4500, nota: '' } } });
    assert.strictEqual(r.salarios, 4500);
  });
  teste('sem lançamento — salarios=0, nunca undefined/NaN', () => {
    const SRC = extrairFuncao('tesImpostosManuaisDe');
    const r = correNumContexto(SRC, 'tesImpostosManuaisDe(_M)', { _M: 'x', TES_IMPOSTOS_MANUAIS: {} });
    assert.strictEqual(r.salarios, 0);
  });
}

console.log('\n[A2] tesIvaCalcularReal() — Salários usa o lançamento manual SÓ quando falta o Fecho de Ordenados');
{
  teste('sem Fecho de Ordenados (TES_CONTAS vazio) mas com lançamento manual de Salários — usa o manual', () => {
    const TES_RECEBER = [{ total: 1000, ivaPct: 23, dataEmissao: '01/' + String(MES_ATUAL_IDX + 1).padStart(2, '0') + '/' + ANO, estado: 'Recebido' }];
    const TES_IMPOSTOS_MANUAIS = { [PREFIXO_ATUAL]: { impostos: 0, ivaPago: null, salarios: 3800, nota: '' } };
    const r = correrTes({ TES_RECEBER, TES_IMPOSTOS_MANUAIS });
    const linha = r.resumo.find(x => x.mes === NOME_MES_ATUAL);
    assert.ok(linha, 'devia aparecer — tem lançamento manual de salários');
    assert.strictEqual(linha.salarios, 3800, 'Salários devia vir do lançamento manual (geral), já que não há Fecho de Ordenados');
  });

  teste('COM Fecho de Ordenados real (TES_CONTAS "Salários — <Mês>") — o real vence, nunca o manual', () => {
    const mesNome = NOME_MES_ATUAL;
    const dataMes = String(MES_ATUAL_IDX + 1).padStart(2, '0') + '/' + ANO;
    const TES_CONTAS = [{
      estado: 'Paga', categoria: 'Salários', descricao: 'Salários — ' + mesNome,
      dataPagamento: '05/' + dataMes, folhaBruto: 3000, folhaSSEmpresa: 712.5,
    }];
    const TES_IMPOSTOS_MANUAIS = { [PREFIXO_ATUAL]: { impostos: 0, ivaPago: null, salarios: 999999, nota: '' } };
    const r = correrTes({ TES_CONTAS, TES_IMPOSTOS_MANUAIS });
    const linha = r.resumo.find(x => x.mes === mesNome);
    assert.strictEqual(linha.salarios, 3712.5, 'o Fecho de Ordenados real nunca é substituído pelo lançamento manual');
  });

  teste('sem Fecho de Ordenados e sem lançamento manual — continua a €0, nunca inventa', () => {
    const TES_RECEBER = [{ total: 1000, ivaPct: 23, dataEmissao: '01/' + String(MES_ATUAL_IDX + 1).padStart(2, '0') + '/' + ANO, estado: 'Recebido' }];
    const r = correrTes({ TES_RECEBER });
    const linha = r.resumo.find(x => x.mes === NOME_MES_ATUAL);
    assert.strictEqual(linha.salarios, 0);
  });

  teste('mês só com o lançamento manual de salários (sem mais nada) continua a aparecer', () => {
    const TES_IMPOSTOS_MANUAIS = { [PREFIXO_ATUAL]: { impostos: 0, ivaPago: null, salarios: 2200, nota: 'estimativa' } };
    const r = correrTes({ TES_IMPOSTOS_MANUAIS });
    const linha = r.resumo.find(x => x.mes === NOME_MES_ATUAL);
    assert.ok(linha, 'devia aparecer — só o lançamento manual de salários já chega');
    assert.strictEqual(linha.salarios, 2200);
  });
}

// ── (B) "Total Líquido" (coluna real da Sheet) — sem IVA real, nunca /1.23 ──
console.log('\n[B] avFindCol()/idx.semIVA reconhece "Total Líquido" (nome real na folha Vendas 2026)');
{
  const SRC_FINDCOL = extrairFuncao('avNormHdr') + '\n' + extrairFuncao('avFindCol');
  teste('header "Total Líquido" é encontrado pelos variants usados para semIVA', () => {
    const variants = ['total liquido','total líquido','valor sem iva','total sem iva','sem iva','valor liquido','valor líquido','net amount','netamount'];
    const header = ['Vendedor','Data','Numero','Nome','Total com IVA','Total Líquido','Status'];
    const r = correNumContexto(SRC_FINDCOL, 'avFindCol(_H,_V)', { _H: header, _V: variants });
    assert.strictEqual(r, 5, 'devia encontrar a coluna "Total Líquido" (índice 5), nunca -1');
  });
}

console.log('\n[B2] sincFinAplicarSheetPura() — usa o "Total Líquido" REAL da Sheet, nunca o estimado a 23% quando a coluna existe');
{
  const SRC_SHEET = extrairFuncao('sincFinAplicarSheetPura');
  teste('linha da Sheet com semIVA real preenchido — valorLiq = esse valor, nunca total/1.23', () => {
    const sheetRows = [{ numero: 'FT2026/900', nome: 'Cliente X', total: 1230, semIVA: 1000, status: 'Pendente', data: '01/06/2026' }];
    const r = correNumContexto(SRC_SHEET, 'sincFinAplicarSheetPura(_E,_S)', { _E: [], _S: sheetRows });
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].valorLiq, 1000, 'tem de usar o valor real da coluna "Total Líquido", nunca a estimativa de 23%');
  });

  teste('linha da Sheet SEM semIVA (coluna ausente nessa folha) — cai no fallback total/1.23, como antes', () => {
    const sheetRows = [{ numero: 'FT2026/901', nome: 'Cliente Y', total: 1230, semIVA: null, status: 'Pendente', data: '01/06/2026' }];
    const r = correNumContexto(SRC_SHEET, 'sincFinAplicarSheetPura(_E,_S)', { _E: [], _S: sheetRows });
    assert.ok(Math.abs(r[0].valorLiq - (1230/1.23)) < 0.01, 'sem dado real, mantém o fallback estimado — nunca 0 nem rebenta');
  });

  teste('linha já existente (por _sheetId) é actualizada com o valorLiq real, nunca perde o valor antigo sem motivo', () => {
    const existentes = [{ id: 'SHEET-FT2026/902', _sheetId: 'FT2026/902', total: 1000, valorLiq: 812.99 }];
    const sheetRows = [{ numero: 'FT2026/902', nome: 'Cliente Z', total: 1230, semIVA: 1050, status: 'Recebido', data: '01/06/2026' }];
    const r = correNumContexto(SRC_SHEET, 'sincFinAplicarSheetPura(_E,_S)', { _E: existentes, _S: sheetRows });
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].valorLiq, 1050);
  });
}

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou ? 1 : 0);
