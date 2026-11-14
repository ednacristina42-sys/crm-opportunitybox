// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — sincFinReconciliar() nunca verificava se um documento
// já tinha uma ligação firmada por _tocoId antes de decidir "match" ou
// "novo" — decidia SEMPRE por nome+data+valor normalizados (matching
// difuso). Isso causava um ciclo sem saída: uma linha já corretamente ligada
// a um documento TOConline (ex.: corrigida à mão por SQL depois de uma
// sincronização incompleta anterior) voltava a cair em "novos" em TODO
// dry-run seguinte, bastando o nome/data normalizados já não baterem byte a
// byte com o que o TOConline devolve agora. "Correr dry-run" de novo nunca
// resolvia nada, porque o problema não era cache — era o próprio matching.
// A escrita real então abortava sempre no mesmo "já existe" (duplicado por
// _tocoId, verificado em sincFinExecutarEscritaReal), em loop.
//
// Reportado pela Edna (via Claude, auditoria overnight de 13-14/11/2026):
// o mesmo erro de duplicado, com os mesmos 2 documentos (_tocoId=12646570 e
// 12646729), recorrente 3 vezes mesmo depois de "Correr dry-run" fresco e de
// confirmar por SQL direta que os dados desses 2 documentos estavam corretos.
//
// Corre com: node tests/regressao-2026-11-14-sincfin-reconciliar-por-tocoid.js
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

function extrairVar(nome) {
  const marcador = 'var ' + nome + ' = ';
  const inicio = html.indexOf(marcador);
  if (inicio === -1) throw new Error('variável "' + nome + '" não encontrada em index.html');
  const fimLinha = html.indexOf(';\n', inicio);
  if (fimLinha === -1) throw new Error('não encontrou o fim de "' + nome + '"');
  return html.slice(inicio, fimLinha + 1);
}

const SRC = [
  extrairVar('SINC_FIN_NIF_GENERICO'),
  extrairFuncao('sincFinNomeNorm'),
  extrairFuncao('sincFinDataISO'),
  extrairFuncao('sincFinEhPlaceholder'),
  extrairFuncao('sincFinReconciliar'),
].join('\n');

function correr(chamada, globals) {
  const ctx = Object.assign({ console }, globals);
  vm.createContext(ctx);
  vm.runInContext(SRC + '\n_RESULT = (' + chamada + ');', ctx);
  return ctx._RESULT;
}

console.log('\n[A] sincFinReconciliar() liga por _tocoId antes de qualquer matching difuso por nome+data+valor');

teste('documento já ligado por _tocoId é MATCH mesmo que a data normalizada já não bata (foi corrigida à mão por SQL depois)', () => {
  // Cenário real: FITOUTICON tinha dataEmissao=null (sincronização incompleta),
  // corrigido à mão para "13/08/2026" por SQL — mas o TOConline continua a
  // devolver uma data ligeiramente diferente para esse mesmo documento.
  const existentes = [
    { id: 'TOC-FT-12646570', tipo: 'FT', _tocoId: '12646570', cliente: 'FITOUTICON, LDA', dataEmissao: '13/08/2026', total: 300 },
  ];
  const tocDocs = [
    { id: '12646570', document_no: 'FT 2026/555', customer_business_name: 'FITOUTICON, LDA', date: '2026-08-20', gross_total: 300 },
  ];
  const r = correr('sincFinReconciliar("FT", _EXISTENTES, _TOC)', { _EXISTENTES: existentes, _TOC: tocDocs });
  assert.strictEqual(r.novos.length, 0, 'não pode cair em "novos" — já está ligado por _tocoId, isso causava o ciclo sem saída');
  assert.strictEqual(r.matches.length, 1, 'tem de ser reconhecido como match por _tocoId');
  assert.strictEqual(r.matches[0].linha_existente.id, 'TOC-FT-12646570');
  assert.strictEqual(r.ambiguidades.length, 0);
});

teste('o mesmo acontece quando o NOME do cliente também já não bate byte a byte (acentuação/maiúsculas diferentes)', () => {
  const existentes = [
    { id: 'TOC-FT-12646729', tipo: 'FT', _tocoId: '12646729', cliente: 'RICARDO FILIPE TRAVASSOS - PUBLICIDADE E DECORAÇÃO UNIPESSOAL LDA', dataEmissao: '04/09/2026', total: 1070.1 },
  ];
  const tocDocs = [
    { id: '12646729', document_no: 'FT 2026/777', customer_business_name: 'Ricardo Filipe Travassos — Publicidade e Decoração, Unip. Lda.', date: '2026-09-08', gross_total: 1070.1 },
  ];
  const r = correr('sincFinReconciliar("FT", _EXISTENTES, _TOC)', { _EXISTENTES: existentes, _TOC: tocDocs });
  assert.strictEqual(r.novos.length, 0);
  assert.strictEqual(r.matches.length, 1);
});

teste('documento SEM ligação prévia por _tocoId continua a usar o matching difuso de sempre (nome+data+valor) — sem regressão', () => {
  const existentes = [
    { id: 'EXIST-1', tipo: 'FT', cliente: 'Cliente Normal, Lda', dataEmissao: '10/09/2026', total: 500 },
  ];
  const tocDocs = [
    { id: '999', document_no: 'FT 2026/900', customer_business_name: 'Cliente Normal, Lda', date: '2026-09-10', gross_total: 500 },
  ];
  const r = correr('sincFinReconciliar("FT", _EXISTENTES, _TOC)', { _EXISTENTES: existentes, _TOC: tocDocs });
  assert.strictEqual(r.matches.length, 1, 'continua a casar por nome+data+valor quando não há _tocoId prévio');
  assert.strictEqual(r.novos.length, 0);
});

teste('documento genuinamente novo (sem _tocoId prévio nem correspondência difusa) continua "novo" — sem regressão', () => {
  const existentes = [
    { id: 'TOC-FT-12646570', tipo: 'FT', _tocoId: '12646570', cliente: 'FITOUTICON, LDA', dataEmissao: '13/08/2026', total: 300 },
  ];
  const tocDocs = [
    { id: '99999999', document_no: 'FT 2026/999', customer_business_name: 'Cliente Totalmente Novo, Lda', date: '2026-10-01', gross_total: 50 },
  ];
  const r = correr('sincFinReconciliar("FT", _EXISTENTES, _TOC)', { _EXISTENTES: existentes, _TOC: tocDocs });
  assert.strictEqual(r.novos.length, 1);
  assert.strictEqual(r.matches.length, 0);
});

teste('_tocoId só liga dentro do mesmo tipo (FT nunca casa com um _tocoId gravado como NC)', () => {
  const existentes = [
    { id: 'TOC-NC-555', tipo: 'NC', _tocoId: '555', cliente: 'Cliente X, Lda', dataEmissao: '01/09/2026', total: -100 },
  ];
  const tocDocs = [
    { id: '555', document_no: 'FT 2026/1', customer_business_name: 'Outro Cliente Qualquer, Lda', date: '2026-09-01', gross_total: 100 },
  ];
  const r = correr('sincFinReconciliar("FT", _EXISTENTES, _TOC)', { _EXISTENTES: existentes, _TOC: tocDocs });
  assert.strictEqual(r.matches.length, 0, 'o _tocoId=555 só existe do lado NC — não pode "vazar" para a reconciliação de FT');
  assert.strictEqual(r.novos.length, 1);
});

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou ? 1 : 0);
