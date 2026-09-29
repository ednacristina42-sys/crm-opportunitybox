// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — Compras e Fornecedores (Fase 3 CFO, 29/09/2026):
// ecrã único e filtrável (mês, ano, fornecedor, categoria, estado) com TODOS
// os documentos de compra do TOConline — combina TES_COMPRAS_TOCO.aPagar[] +
// .pagas[] + .creditos[] numa única lista, cada linha já com o seu estado
// real calculado (Pendente/Vencido/Pago/Crédito). Cobre, sem tocar em rede
// nem no Supabase real:
//
//   1. cfCombinarCompras() — a lista combinada tem a contagem certa e cada
//      linha tem o `estado` derivado correctamente, incluindo o caso Vencido
//      (item de aPagar[] com vencimento no passado).
//   2. cfFiltrarCompras() — filtro de mês+ano devolve só as linhas do
//      período certo (usa _dataRef: dataEmissao para aPagar[]/creditos[],
//      dataPagamento para pagas[] — pagas[] não traz dataEmissao).
//   3. cfFiltrarCompras() — filtro de categoria inclui correctamente o
//      balde "Não categorizado" (fornecedor sem entrada em
//      FORNECEDOR_CATEGORIAS).
//   4. cfTotais() — soma correctamente os totais (contagem, sem IVA, IVA,
//      total) para uma combinação de filtros específica, tratando "sem
//      IVA"/"IVA" em falta (aPagar[]/creditos[]) como ausentes na soma, nunca
//      como zero fabricado a mais nem a menos do que o que existe.
//
// Corre com: node tests/regressao-2026-09-29-compras-fornecedores.js
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
// por contagem de chavetas (mesma técnica já usada nos outros testes desta
// suite — tests/regressao-2026-09-24.js, -cfo-fase1.js, -categorias-fornecedores.js).
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

// cfCombinarCompras()/cfFiltrarCompras()/cfTotais() dependem de
// fornCategoriaDe() (categoria por fornecedor) e de cfRound2() — mesma
// composição já usada para as outras funções desta família (Fase 2/3).
const SRC_CF = [
  extrairVar('FORN_CATEGORIAS_LISTA'),
  extrairFuncao('fornCategoriaDe'),
  extrairFuncao('cfRound2'),
  extrairFuncao('cfCombinarCompras'),
  extrairFuncao('cfFiltrarCompras'),
  extrairFuncao('cfTotais'),
].join('\n');

function correr(chamada, globals) {
  const ctx = Object.assign({ console }, globals);
  vm.createContext(ctx);
  vm.runInContext(SRC_CF + '\n_RESULT = (' + chamada + ');', ctx);
  return ctx._RESULT;
}

// ── Dados mock: 2 meses (Agosto e Setembro 2026), 2 fornecedores (um
// categorizado, um não), abrangendo os 3 buckets (aPagar/pagas/creditos).
const HOJE_FIXA = '2026-09-29'; // "hoje" real da sessão, usado só para calcular Vencido nos comentários abaixo
const FORNECEDOR_CATEGORIAS = {
  'Alumínios do Norte, Lda': 'Matéria-prima / Fornecedores',
  // 'Fornecedor Novo, Lda' fica SEM entrada — deve cair em "Não categorizado"
};
const TES_COMPRAS_TOCO_MOCK = {
  aPagar: [
    // Setembro 2026, vencimento no FUTURO (2026-10-15) -> Pendente
    { tocoId: 'd1', documento: 'FC 2026/100', tipo: 'FC', fornecedor: 'Alumínios do Norte, Lda',
      referencia: null, dataEmissao: '2026-09-10', vencimento: '2026-10-15', total: 1000, pendente: 1000, estado: 'pending' },
    // Agosto 2026, vencimento no PASSADO (2026-08-20, antes de "hoje" 2026-09-29) -> Vencido
    { tocoId: 'd2', documento: 'FC 2026/090', tipo: 'FC', fornecedor: 'Fornecedor Novo, Lda',
      referencia: null, dataEmissao: '2026-08-05', vencimento: '2026-08-20', total: 300, pendente: 300, estado: 'pending' },
  ],
  pagas: [
    // Setembro 2026 (data de pagamento) — com ivaDocumento (proporcional)
    { pagamentoId: 'p1', numeroPagamento: 'PAG-1', documentoAssociadoId: 'x1', documentoNumero: 'FC 2026/050',
      fornecedor: 'Alumínios do Norte, Lda', dataPagamento: '2026-09-12T10:00:00Z', valorPago: 615,
      valorOriginal: 615, saldoRestante: 0, formaPagamento: 'transferência', ivaDocumento: 115 },
    // Agosto 2026 (data de pagamento), ivaDocumento null (documento sem gross_total>0) -> sem IVA/IVA ficam "—"
    { pagamentoId: 'p2', numeroPagamento: 'PAG-2', documentoAssociadoId: 'x2', documentoNumero: 'FC 2026/040',
      fornecedor: 'Fornecedor Novo, Lda', dataPagamento: '2026-08-03T10:00:00Z', valorPago: 200,
      valorOriginal: 200, saldoRestante: 0, formaPagamento: 'numerário', ivaDocumento: null },
  ],
  creditos: [
    // Setembro 2026
    { tocoId: 'c1', documento: 'NCF 2026/010', fornecedor: 'Alumínios do Norte, Lda',
      dataEmissao: '2026-09-20', valor: 50, referencia: null, estado: 'active' },
  ],
};

console.log('\n[1] cfCombinarCompras() — contagem e estado derivado de cada linha');
{
  const globals = { FORNECEDOR_CATEGORIAS, TES_COMPRAS_TOCO: TES_COMPRAS_TOCO_MOCK };
  teste('combina os 3 buckets — 2 aPagar + 2 pagas + 1 creditos = 5 linhas', () => {
    const r = correr('cfCombinarCompras(TES_COMPRAS_TOCO)', globals);
    assert.strictEqual(r.length, 5);
  });
  teste('item de aPagar[] com vencimento no passado -> estado "Vencido"', () => {
    const r = correr('cfCombinarCompras(TES_COMPRAS_TOCO)', globals);
    const linha = r.find(l => l.documento === 'FC 2026/090');
    assert.ok(linha, 'linha FC 2026/090 devia existir');
    assert.strictEqual(linha.estado, 'Vencido');
  });
  teste('item de aPagar[] com vencimento no futuro -> estado "Pendente"', () => {
    const r = correr('cfCombinarCompras(TES_COMPRAS_TOCO)', globals);
    const linha = r.find(l => l.documento === 'FC 2026/100');
    assert.strictEqual(linha.estado, 'Pendente');
  });
  teste('item de pagas[] -> estado "Pago"', () => {
    const r = correr('cfCombinarCompras(TES_COMPRAS_TOCO)', globals);
    const linha = r.find(l => l.documento === 'FC 2026/050');
    assert.strictEqual(linha.estado, 'Pago');
  });
  teste('item de creditos[] -> estado "Crédito"', () => {
    const r = correr('cfCombinarCompras(TES_COMPRAS_TOCO)', globals);
    const linha = r.find(l => l.documento === 'NCF 2026/010');
    assert.strictEqual(linha.estado, 'Crédito');
  });
  teste('pagas[] com ivaDocumento presente -> semIva/iva calculados (615 = 500 sem IVA + 115 IVA)', () => {
    const r = correr('cfCombinarCompras(TES_COMPRAS_TOCO)', globals);
    const linha = r.find(l => l.documento === 'FC 2026/050');
    assert.strictEqual(linha.iva, 115);
    assert.strictEqual(linha.semIva, 500);
  });
  teste('pagas[] com ivaDocumento null -> semIva/iva ficam null (nunca fabricados)', () => {
    const r = correr('cfCombinarCompras(TES_COMPRAS_TOCO)', globals);
    const linha = r.find(l => l.documento === 'FC 2026/040');
    assert.strictEqual(linha.iva, null);
    assert.strictEqual(linha.semIva, null);
  });
  teste('aPagar[]/creditos[] nunca trazem semIva/iva (dado não existe na origem) -> null', () => {
    const r = correr('cfCombinarCompras(TES_COMPRAS_TOCO)', globals);
    r.filter(l => l._origem === 'aPagar' || l._origem === 'creditos').forEach(l => {
      assert.strictEqual(l.iva, null);
      assert.strictEqual(l.semIva, null);
    });
  });
}

console.log('\n[2] cfFiltrarCompras() — filtro mês+ano');
{
  const globals = { FORNECEDOR_CATEGORIAS, TES_COMPRAS_TOCO: TES_COMPRAS_TOCO_MOCK };
  // Nota: os arrays devolvidos vêm de um vm.createContext() (realm
  // diferente) — assert.deepStrictEqual falha em arrays cross-realm por
  // prototype mismatch mesmo com o mesmo conteúdo; comparamos via
  // JSON.stringify (mesmo padrão de contorno usado nos outros testes desta
  // suite sempre que o valor sai da vm).
  teste('mês=9, ano=2026 -> só as 3 linhas de Setembro (2 aPagar/creditos + 1 pagas)', () => {
    const todas = correr('cfCombinarCompras(TES_COMPRAS_TOCO)', globals);
    const r = correr('cfFiltrarCompras(_TODAS, {mes:"9", ano:"2026"})', Object.assign({}, globals, { _TODAS: todas }));
    assert.strictEqual(r.length, 3);
    const documentos = Array.from(r).map(l => l.documento).sort();
    assert.strictEqual(JSON.stringify(documentos), JSON.stringify(['FC 2026/050', 'FC 2026/100', 'NCF 2026/010']));
  });
  teste('mês=8, ano=2026 -> só as 2 linhas de Agosto', () => {
    const todas = correr('cfCombinarCompras(TES_COMPRAS_TOCO)', globals);
    const r = correr('cfFiltrarCompras(_TODAS, {mes:"8", ano:"2026"})', Object.assign({}, globals, { _TODAS: todas }));
    assert.strictEqual(r.length, 2);
    const documentos = Array.from(r).map(l => l.documento).sort();
    assert.strictEqual(JSON.stringify(documentos), JSON.stringify(['FC 2026/040', 'FC 2026/090']));
  });
  teste('ano="todos" (sem mês) -> devolve tudo (5 linhas)', () => {
    const todas = correr('cfCombinarCompras(TES_COMPRAS_TOCO)', globals);
    const r = correr('cfFiltrarCompras(_TODAS, {mes:"", ano:"todos"})', Object.assign({}, globals, { _TODAS: todas }));
    assert.strictEqual(r.length, 5);
  });
}

console.log('\n[3] cfFiltrarCompras() — filtro de categoria inclui "Não categorizado"');
{
  const globals = { FORNECEDOR_CATEGORIAS, TES_COMPRAS_TOCO: TES_COMPRAS_TOCO_MOCK };
  teste('categoria="Matéria-prima / Fornecedores" -> só linhas de Alumínios do Norte', () => {
    const todas = correr('cfCombinarCompras(TES_COMPRAS_TOCO)', globals);
    const r = correr('cfFiltrarCompras(_TODAS, {categoria:"Matéria-prima / Fornecedores"})', Object.assign({}, globals, { _TODAS: todas }));
    assert.strictEqual(r.length, 3); // FC 2026/100, FC 2026/050, NCF 2026/010
    r.forEach(l => assert.strictEqual(l.fornecedor, 'Alumínios do Norte, Lda'));
  });
  teste('categoria="Não categorizado" -> as 2 linhas de "Fornecedor Novo, Lda" (sem entrada no mapa)', () => {
    const todas = correr('cfCombinarCompras(TES_COMPRAS_TOCO)', globals);
    const r = correr('cfFiltrarCompras(_TODAS, {categoria:"Não categorizado"})', Object.assign({}, globals, { _TODAS: todas }));
    assert.strictEqual(r.length, 2);
    r.forEach(l => assert.strictEqual(l.fornecedor, 'Fornecedor Novo, Lda'));
  });
  teste('categoria="" (Todas) -> devolve tudo, sem filtrar', () => {
    const todas = correr('cfCombinarCompras(TES_COMPRAS_TOCO)', globals);
    const r = correr('cfFiltrarCompras(_TODAS, {categoria:""})', Object.assign({}, globals, { _TODAS: todas }));
    assert.strictEqual(r.length, 5);
  });
}

console.log('\n[4] cfTotais() — soma correcta para uma combinação de filtros específica');
{
  const globals = { FORNECEDOR_CATEGORIAS, TES_COMPRAS_TOCO: TES_COMPRAS_TOCO_MOCK };
  teste('mês=9,ano=2026 + categoria="Matéria-prima / Fornecedores": 3 docs, total=1000+615+50=1665, IVA=115 (só a linha paga traz IVA), semIVA=500 (só essa linha traz)', () => {
    const todas = correr('cfCombinarCompras(TES_COMPRAS_TOCO)', globals);
    const filtradas = correr('cfFiltrarCompras(_TODAS, {mes:"9", ano:"2026", categoria:"Matéria-prima / Fornecedores"})', Object.assign({}, globals, { _TODAS: todas }));
    const t = correr('cfTotais(_FILTRADAS)', Object.assign({}, globals, { _FILTRADAS: filtradas }));
    assert.strictEqual(t.count, 3);
    assert.strictEqual(t.total, 1000 + 615 + 50);
    assert.strictEqual(t.iva, 115);
    assert.strictEqual(t.semIva, 500);
  });
  teste('filtro por estado="Pendente" + mês=9: só FC 2026/100 (1 doc, total=1000, sem IVA/IVA ausentes -> soma 0)', () => {
    const todas = correr('cfCombinarCompras(TES_COMPRAS_TOCO)', globals);
    const filtradas = correr('cfFiltrarCompras(_TODAS, {mes:"9", ano:"2026", estado:"Pendente"})', Object.assign({}, globals, { _TODAS: todas }));
    const t = correr('cfTotais(_FILTRADAS)', Object.assign({}, globals, { _FILTRADAS: filtradas }));
    assert.strictEqual(t.count, 1);
    assert.strictEqual(t.total, 1000);
    assert.strictEqual(t.iva, 0, 'nenhuma linha do conjunto filtrado traz IVA -> soma fica 0 (nunca null nem NaN)');
    assert.strictEqual(t.semIva, 0);
  });
  teste('filtro que não bate com nada -> cfTotais([]) devolve tudo a zero, sem rebentar', () => {
    const todas = correr('cfCombinarCompras(TES_COMPRAS_TOCO)', globals);
    const filtradas = correr('cfFiltrarCompras(_TODAS, {fornecedor:"inexistente xyz"})', Object.assign({}, globals, { _TODAS: todas }));
    const t = correr('cfTotais(_FILTRADAS)', Object.assign({}, globals, { _FILTRADAS: filtradas }));
    assert.strictEqual(t.count, 0);
    assert.strictEqual(t.total, 0);
  });
}

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou > 0 ? 1 : 0);
