// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — Follow-up: quadros por comercial (07/10/2026).
// A Edna reportou, com screenshot: "meu nome não deve estar aí, não sou
// comercial, falta o nome do André". Duas causas raiz:
//
//   (A) crmComerciais (lista usada por fuAgruparKanban() e outros
//       dropdowns) nunca tinha o André Nolasco, apesar de ele já ser
//       reconhecido como comercial noutros sítios do CRM
//       (MV_COMERCIAIS_ROSTER, ob_colaboradores · Dep. Comercial) — por
//       isso nunca tinha quadro próprio no Follow-up.
//   (B) orcGetData() grava sempre o.vendedor = CU.name (quem está
//       logado), nunca um comercial à escolha — por isso um orçamento
//       criado/editado pela Edna (admin) ficava com o nome dela como
//       "comercial", e fuAgruparKanban() criava-lhe um quadro próprio
//       como se ela fosse uma vendedora. Corrigido no fuAgruparKanban():
//       só cria quadro com o nome de alguém do roster real
//       (crmComerciais, activos); qualquer outro nome cai num grupo
//       neutro "Sem comercial atribuído" — nunca desaparece o
//       orçamento, só deixa de usar o nome de quem não é comercial.
//
// Corre com: node tests/regressao-2026-10-07-followup-comerciais-roster.js
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
  const re = new RegExp('var\\s+' + nome + '\\s*=[\\s\\S]*?;\\n');
  const m = html.match(re);
  if (!m) throw new Error('variável "' + nome + '" não encontrada em index.html');
  return m[0];
}

console.log('\n[A] crmComerciais (default de fábrica) já inclui o André Nolasco');
{
  teste('default embutido em index.html tem "André Nolasco" como activo', () => {
    const bloco = html.slice(html.indexOf('var crmComerciais;'), html.indexOf('var crmComerciais;') + 1200);
    assert.ok(/nome:'André Nolasco'[^}]*ativo:true/.test(bloco), 'André Nolasco tem de estar no default, activo');
  });
}

console.log('\n[B] fuAgruparKanban() — só cria quadro próprio para comerciais reais; resto cai em "Sem comercial atribuído"');
{
  const SRC = [
    extrairFuncao('crmVeTudo'),
    extrairVar('FU_ESTADOS_ORC_TERMINAIS'),
    'var FU_CUTOFF_ATIVO = new Date(2026,6,1);',
    extrairFuncao('fuClassificarOrc'),
    extrairFuncao('fuOrcamentosAtivos'),
    extrairFuncao('fuMinhasOrc'),
    extrairFuncao('fuColunaDoOrc'),
    extrairVar('FU_SEM_COMERCIAL'),
    extrairFuncao('fuComercialReconhecido'),
    extrairFuncao('fuAgruparKanban'),
  ].join('\n');

  function correr(orcData, crmComerciais, CU, extra) {
    const ctx = Object.assign({
      console,
      orcData: orcData || [],
      crmComerciais: crmComerciais || [],
      crmAtividades: [],
      crmLeads: [],
      _fuTriagemPorOrc: {},
      CU: CU,
      obDiasEntre: function () { return 0; },
      obOrcUltimaAtividade: function () { return null; },
      orcGetValorTotal: function (o) { return o.val || 0; },
    }, extra || {});
    vm.createContext(ctx);
    vm.runInContext(SRC + '\n_RESULT = fuAgruparKanban();', ctx);
    return ctx._RESULT;
  }

  const ROSTER = [
    { id: 1, nome: 'Paulo Faria', ativo: true },
    { id: 2, nome: 'Rui Mota', ativo: true },
    { id: 3, nome: 'Humberto Estrelinha', ativo: true },
    { id: 4, nome: 'André Nolasco', ativo: true },
  ];
  const ADMIN = { admin: true, role: 'administrativo', name: 'Edna Faria' };

  teste('orçamento com vendedor="Edna Faria" (não é comercial) — nunca cria um quadro com o nome dela', () => {
    const orcData = [{ num: '1', cli: 'Tributo Pictórico Lda', st: 'Pendente', dt: '01/09/2026', vendedor: 'Edna Faria', val: 0 }];
    const grupos = correr(orcData, ROSTER, ADMIN);
    assert.ok(!('Edna Faria' in grupos), 'nunca deve existir um grupo "Edna Faria"');
    assert.ok('Sem comercial atribuído' in grupos, 'o orçamento tem de aparecer algures, só que num grupo neutro');
    assert.strictEqual(grupos['Sem comercial atribuído'].a_contactar.length, 1);
  });

  teste('orçamento com vendedor="André Nolasco" — cria o quadro dele normalmente (já no roster)', () => {
    const orcData = [{ num: '2', cli: 'JF Peniche', st: 'Pendente', dt: '01/09/2026', vendedor: 'André Nolasco', val: 480 }];
    const grupos = correr(orcData, ROSTER, ADMIN);
    assert.ok('André Nolasco' in grupos);
    assert.strictEqual(grupos['André Nolasco'].a_contactar.length, 1);
  });

  teste('vista admin (vê tudo) — André aparece com quadro vazio mesmo SEM nenhum orçamento ainda', () => {
    const grupos = correr([], ROSTER, ADMIN);
    assert.ok('André Nolasco' in grupos, 'o quadro do André tem de aparecer mesmo vazio, como os outros comerciais');
    assert.strictEqual(grupos['André Nolasco'].a_contactar.length, 0);
  });

  teste('vista de um comercial normal (não admin) — não pré-cria os quadros todos, só o que lhe pertence', () => {
    const comercialReal = { admin: false, role: 'comercial', name: 'Rui Mota', id: 'rui-uuid' };
    const orcData = [{ num: '3', cli: 'X', st: 'Pendente', dt: '01/09/2026', vendedor: 'Rui Mota', val: 100, owner_id: 'rui-uuid' }];
    const grupos = correr(orcData, ROSTER, comercialReal);
    assert.ok(!('André Nolasco' in grupos), 'não deve pré-criar quadros de outros comerciais na vista pessoal');
    assert.ok('Rui Mota' in grupos);
  });

  teste('roster vazio (crmComerciais indisponível) — nunca rebenta, mostra o vendedor tal como vem', () => {
    const orcData = [{ num: '4', cli: 'Y', st: 'Pendente', dt: '01/09/2026', vendedor: 'Qualquer Nome', val: 50 }];
    const grupos = correr(orcData, [], ADMIN);
    assert.ok('Qualquer Nome' in grupos, 'sem roster para comparar, nunca esconde nem reclassifica às cegas');
  });
}

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou ? 1 : 0);
