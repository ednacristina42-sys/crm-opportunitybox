// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — Categorização de Fornecedores (Fase 2 CFO,
// 29/09/2026): quebra de "Compras TOConline" por categoria de despesa,
// atribuída UMA VEZ por fornecedor (fornCategoriaDe/FORNECEDOR_CATEGORIAS),
// nunca lançada manualmente transação a transação (constraint explícita da
// Edna — TOConline continua a ser a única fonte das compras em si).
// Cobre, sem tocar em rede nem no Supabase real:
//
//   1. fornCategoriaDe() — devolve a categoria atribuída quando existe uma
//      entrada válida em FORNECEDOR_CATEGORIAS; 'Não categorizado' explícito
//      quando o fornecedor não tem entrada nenhuma (nem chave presente no
//      mapa), quando a categoria gravada é vazia, ou quando é um valor que
//      já não existe na lista fixa — NUNCA cai silenciosamente em 'Outros'.
//   2. finComprasPorCategoriaMes(ano, mes) — agrupa TES_COMPRAS_TOCO.pagas[]
//      do mês alvo por categoria (via fornCategoriaDe), com 3 fornecedores
//      (Matéria-prima, Veículos & Combustível, um sem categoria nenhuma
//      atribuída) todos no mesmo mês — cada um cai no bucket certo.
//   3. INVARIANTE — a soma de todos os buckets devolvidos por
//      finComprasPorCategoriaMes(ano,mes) é EXACTAMENTE igual a
//      finTotaisMesReal(ano,mes).custoCompras para o mesmo mês/mesmos dados
//      (mesma fonte, só agrupamento diferente — nunca perde nem duplica
//      valor).
//   4. Documentos fora do mês alvo (dataPagamento de outro mês) nunca
//      entram em nenhum bucket.
//
// Corre com: node tests/regressao-2026-09-29-categorias-fornecedores.js
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

// ── Extrai o corpo de uma função "function NOME(...) { ... }" do index.html
// por contagem de chavetas (mesma técnica de tests/regressao-2026-09-24.js
// e tests/regressao-2026-09-29-cfo-fase1.js).
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

// Extrai "var NOME = [...]" (declaração de array/objecto de nível de
// módulo) — usada aqui só para FORN_CATEGORIAS_LISTA, a lista fixa de
// categorias válidas que fornCategoriaDe() usa para rejeitar valores
// obsoletos/inválidos.
function extrairVar(nome) {
  const marcador = 'var ' + nome + ' = ';
  const inicio = html.indexOf(marcador);
  if (inicio === -1) throw new Error('variável "' + nome + '" não encontrada em index.html');
  const fimLinha = html.indexOf(';\n', inicio);
  if (fimLinha === -1) throw new Error('não encontrou o fim de "' + nome + '"');
  return html.slice(inicio, fimLinha + 1);
}

// fornCategoriaDe() depende de FORN_CATEGORIAS_LISTA (global) e do próprio
// mapa FORNECEDOR_CATEGORIAS (passado como global mockado por teste).
const SRC_FORN_CATEGORIA_DE = [
  extrairVar('FORN_CATEGORIAS_LISTA'),
  extrairFuncao('fornCategoriaDe'),
].join('\n');

// finComprasPorCategoriaMes() depende de finParseVenc()/parseVencTes() (data
// parsing) e de fornCategoriaDe() (categoria por fornecedor) — mesma
// composição de dependências já usada em
// tests/regressao-2026-09-29-cfo-fase1.js para finTotaisMesReal().
const SRC_COMPRAS_CATEGORIA = [
  extrairVar('FORN_CATEGORIAS_LISTA'),
  extrairFuncao('fornCategoriaDe'),
  extrairFuncao('parseVencTes'),
  extrairFuncao('finParseVenc'),
  extrairFuncao('finComprasPorCategoriaMes'),
].join('\n');

// finTotaisMesReal() — mesma extração usada no teste da Fase 1, para
// verificar a invariante de soma (custoCompras) com EXACTAMENTE os mesmos
// dados mock usados em finComprasPorCategoriaMes().
const SRC_FIN_TOTAIS = [
  extrairFuncao('parseVencTes'),
  extrairFuncao('finParseVenc'),
  extrairFuncao('finTotaisMesReal'),
].join('\n');

function correFornCategoriaDe(nomeFornecedor, globals) {
  const ctx = Object.assign({ console }, globals);
  vm.createContext(ctx);
  vm.runInContext(SRC_FORN_CATEGORIA_DE + '\n_RESULT = fornCategoriaDe(_NOME);', Object.assign(ctx, { _NOME: nomeFornecedor }));
  return ctx._RESULT;
}

function correComprasPorCategoriaMes(ano, mes, globals) {
  const ctx = Object.assign({ console }, globals);
  vm.createContext(ctx);
  vm.runInContext(SRC_COMPRAS_CATEGORIA + '\n_RESULT = finComprasPorCategoriaMes(_ANO, _MES);', Object.assign(ctx, { _ANO: ano, _MES: mes }));
  return ctx._RESULT;
}

function correFinTotaisMesReal(ano, mes, globals) {
  const ctx = Object.assign({ console, FIN_MESES: ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'] }, globals);
  vm.createContext(ctx);
  vm.runInContext(SRC_FIN_TOTAIS + '\n_RESULT = finTotaisMesReal(_ANO, _MES);', Object.assign(ctx, { _ANO: ano, _MES: mes }));
  return ctx._RESULT;
}

console.log('\n[1] fornCategoriaDe() — categoria atribuída vs. "Não categorizado" explícito');
{
  teste('fornecedor com categoria válida atribuída — devolve essa categoria', () => {
    const FORNECEDOR_CATEGORIAS = { 'Alumínios do Norte, Lda': 'Matéria-prima / Fornecedores' };
    const r = correFornCategoriaDe('Alumínios do Norte, Lda', { FORNECEDOR_CATEGORIAS });
    assert.strictEqual(r, 'Matéria-prima / Fornecedores');
  });
  teste('fornecedor SEM nenhuma entrada no mapa — "Não categorizado" (nunca "Outros")', () => {
    const FORNECEDOR_CATEGORIAS = { 'Alumínios do Norte, Lda': 'Matéria-prima / Fornecedores' };
    const r = correFornCategoriaDe('Fornecedor Desconhecido, Lda', { FORNECEDOR_CATEGORIAS });
    assert.strictEqual(r, 'Não categorizado');
    assert.notStrictEqual(r, 'Outros');
  });
  teste('categoria gravada vazia ("") — "Não categorizado"', () => {
    const FORNECEDOR_CATEGORIAS = { 'X, Lda': '' };
    const r = correFornCategoriaDe('X, Lda', { FORNECEDOR_CATEGORIAS });
    assert.strictEqual(r, 'Não categorizado');
  });
  teste('categoria gravada que já não existe na lista fixa — "Não categorizado" (nunca rebenta)', () => {
    const FORNECEDOR_CATEGORIAS = { 'X, Lda': 'Categoria Obsoleta Que Já Não Existe' };
    const r = correFornCategoriaDe('X, Lda', { FORNECEDOR_CATEGORIAS });
    assert.strictEqual(r, 'Não categorizado');
  });
  teste('mapa vazio ({}) — "Não categorizado" para qualquer fornecedor', () => {
    const r = correFornCategoriaDe('Qualquer, Lda', { FORNECEDOR_CATEGORIAS: {} });
    assert.strictEqual(r, 'Não categorizado');
  });
}

console.log('\n[2] finComprasPorCategoriaMes() — agrupa pagas[] do mês alvo por categoria');
{
  // 3 fornecedores, todos com um pagamento no mesmo mês (Setembro 2026):
  //   - "Alumínios do Norte, Lda"  -> Matéria-prima / Fornecedores (600)
  //   - "Posto BP Norte"            -> Veículos & Combustível        (150)
  //   - "Fornecedor Novo, Lda"      -> SEM categoria atribuída        (80)
  const FORNECEDOR_CATEGORIAS = {
    'Alumínios do Norte, Lda': 'Matéria-prima / Fornecedores',
    'Posto BP Norte': 'Veículos & Combustível',
  };
  const TES_COMPRAS_TOCO = {
    pagas: [
      { fornecedor: 'Alumínios do Norte, Lda', dataPagamento: '2026-09-05T10:00:00Z', valorPago: 600 },
      { fornecedor: 'Posto BP Norte', dataPagamento: '2026-09-12T10:00:00Z', valorPago: 150 },
      { fornecedor: 'Fornecedor Novo, Lda', dataPagamento: '2026-09-20T10:00:00Z', valorPago: 80 },
    ],
  };

  teste('cada fornecedor cai no bucket certo; o sem categoria cai em "Não categorizado"', () => {
    const r = correComprasPorCategoriaMes(2026, 9, { FORNECEDOR_CATEGORIAS, TES_COMPRAS_TOCO });
    assert.strictEqual(r['Matéria-prima / Fornecedores'], 600);
    assert.strictEqual(r['Veículos & Combustível'], 150);
    assert.strictEqual(r['Não categorizado'], 80);
    assert.strictEqual(r['Outros'], undefined, 'o fornecedor sem categoria nunca deve ser lançado em "Outros"');
  });

  teste('INVARIANTE — soma de todos os buckets === finTotaisMesReal(ano,mes).custoCompras (mesmos dados)', () => {
    const porCategoria = correComprasPorCategoriaMes(2026, 9, { FORNECEDOR_CATEGORIAS, TES_COMPRAS_TOCO });
    const somaCategorias = Object.keys(porCategoria).reduce((s, k) => s + porCategoria[k], 0);

    const totais = correFinTotaisMesReal(2026, 9, { TES_RECEBER: [], TES_CONTAS: [], FIN_DESPESAS: [], EC_DESPESAS_APP: [], TES_COMPRAS_TOCO });

    assert.strictEqual(somaCategorias, 600 + 150 + 80);
    assert.strictEqual(somaCategorias, totais.custoCompras, 'a soma das categorias tem de bater exactamente com custoCompras (mesma fonte, só agrupamento diferente)');
  });

  teste('documentos de OUTRO mês nunca entram em nenhum bucket', () => {
    const tocoComOutroMes = {
      pagas: TES_COMPRAS_TOCO.pagas.concat([
        { fornecedor: 'Alumínios do Norte, Lda', dataPagamento: '2026-08-15T10:00:00Z', valorPago: 9999 },
      ]),
    };
    const r = correComprasPorCategoriaMes(2026, 9, { FORNECEDOR_CATEGORIAS, TES_COMPRAS_TOCO: tocoComOutroMes });
    assert.strictEqual(r['Matéria-prima / Fornecedores'], 600, 'o pagamento de Agosto (9999) não pode contaminar Setembro');
    const soma = Object.keys(r).reduce((s, k) => s + r[k], 0);
    assert.strictEqual(soma, 600 + 150 + 80);
  });

  teste('sem NENHUM fornecedor classificado (FORNECEDOR_CATEGORIAS={}) — tudo em "Não categorizado", soma continua a bater', () => {
    const r = correComprasPorCategoriaMes(2026, 9, { FORNECEDOR_CATEGORIAS: {}, TES_COMPRAS_TOCO });
    assert.strictEqual(Object.keys(r).length, 1);
    assert.strictEqual(r['Não categorizado'], 600 + 150 + 80);
  });
}

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou > 0 ? 1 : 0);
