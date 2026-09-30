// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — Encargos de Folha manuais: Seguros e Bónus/Prémios
// (Fase 4 CFO, 30/09/2026). Único ponto do projeto CFO onde entrada manual
// é esperada e correta — nem o TOConline nem nenhuma outra integração
// existente expõem seguros de acidentes de trabalho ou bónus/prémios pagos
// aos colaboradores. Lançados em RH → Ordenados (foGuardarEncargosFolha(),
// ENCARGOS_FOLHA), lidos por finTotaisMesReal() e somados a custoFolha.
//
// Cobre, sem tocar em rede nem no Supabase real:
//
//   (a) mês com folhaBruto/folhaSSEmpresa (base) E seguros/bónus lançados —
//       custoFolha soma as TRÊS componentes; folhaIndisponivel=false,
//       folhaParcial=false.
//   (b) mês com APENAS seguros/bónus lançados (sem Fecho de Ordenados
//       enviado) — custoFolha = só o valor de seguros/bónus;
//       folhaParcial=true (sinal de "falta a folha base", nunca "sem
//       dados" — a UI não deve implicar €0 quando há custo real).
//   (c) mês sem NENHUM dos dois — custoFolha=0, folhaIndisponivel=true
//       (comportamento original, "sem dados", intacto).
//   (d) mês com base disponível mas SEM entrada em ENCARGOS_FOLHA para esse
//       mês (chave ausente) — custoSegurosBonus=0 de forma limpa, sem
//       NaN/crash, custoFolha = só a base.
//
// Corre com: node tests/regressao-2026-09-30-encargos-folha.js
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
// por contagem de chavetas (mesma técnica das outras suites de regressão).
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

const SRC_FIN_TOTAIS = [
  extrairFuncao('parseVencTes'),
  extrairFuncao('finParseVenc'),
  extrairFuncao('finTotaisMesReal'),
].join('\n');

function correFinTotaisMesReal(ano, mes, globals) {
  const ctx = Object.assign({ console, FIN_MESES: ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'] }, globals);
  vm.createContext(ctx);
  vm.runInContext(SRC_FIN_TOTAIS + '\n_RESULT = finTotaisMesReal(_ANO, _MES);', Object.assign(ctx, { _ANO: ano, _MES: mes }));
  return ctx._RESULT;
}

console.log('\n(a) Mês com base (folhaBruto/folhaSSEmpresa) E seguros/bónus lançados — soma as três componentes');
{
  teste('custoFolha = folhaBruto + folhaSSEmpresa + seguros + bonus; nem indisponível nem parcial', () => {
    const TES_CONTAS = [
      { id: 'sal-1', descricao: 'Salários — Setembro 2026', categoria: 'Salários', estado: 'Pendente', data: '29/09/2026', dataPagamento: null, valor: 8000, folhaBruto: 10500, folhaSSEmpresa: 2493.75 },
    ];
    const ENCARGOS_FOLHA = { '2026-09': { seguros: 450, bonus: 1200, nota: 'Tranquilidade + prémio Q3' } };
    const r = correFinTotaisMesReal(2026, 9, { TES_RECEBER: [], TES_CONTAS, FIN_DESPESAS: [], EC_DESPESAS_APP: [], TES_COMPRAS_TOCO: null, ENCARGOS_FOLHA });
    assert.strictEqual(r.folhaIndisponivel, false);
    assert.strictEqual(r.folhaParcial, false);
    assert.strictEqual(r.custoSegurosBonus, 450 + 1200);
    assert.strictEqual(r.custoFolha, 10500 + 2493.75 + 450 + 1200);
  });
}

console.log('\n(b) Mês com APENAS seguros/bónus lançados (sem Fecho de Ordenados enviado) — custoFolha parcial, nunca "sem dados"');
{
  teste('sem entrada "Salários" mas COM ENCARGOS_FOLHA do mês — custoFolha = só seguros+bonus; folhaParcial=true, folhaIndisponivel=false', () => {
    const ENCARGOS_FOLHA = { '2026-09': { seguros: 300, bonus: 0, nota: '' } };
    const r = correFinTotaisMesReal(2026, 9, { TES_RECEBER: [], TES_CONTAS: [], FIN_DESPESAS: [], EC_DESPESAS_APP: [], TES_COMPRAS_TOCO: null, ENCARGOS_FOLHA });
    assert.strictEqual(r.custoSegurosBonus, 300);
    assert.strictEqual(r.custoFolha, 300);
    assert.strictEqual(r.folhaParcial, true, 'deve sinalizar "parcial" — há custo real (seguros), não é um mês sem dados');
    assert.strictEqual(r.folhaIndisponivel, false, 'NUNCA "sem dados" quando há €300 reais de seguros lançados');
  });
  teste('entrada "Salários" anterior à funcionalidade (sem folhaBruto/folhaSSEmpresa) + ENCARGOS_FOLHA do mês — mesmo comportamento parcial', () => {
    const TES_CONTAS = [
      { id: 'sal-old', descricao: 'Salários — Setembro 2026', categoria: 'Salários', estado: 'Paga', dataPagamento: '05/09/2026', valor: 8000 },
    ];
    const ENCARGOS_FOLHA = { '2026-09': { seguros: 0, bonus: 500, nota: 'prémio pontual' } };
    const r = correFinTotaisMesReal(2026, 9, { TES_RECEBER: [], TES_CONTAS, FIN_DESPESAS: [], EC_DESPESAS_APP: [], TES_COMPRAS_TOCO: null, ENCARGOS_FOLHA });
    assert.strictEqual(r.custoSegurosBonus, 500);
    assert.strictEqual(r.custoFolha, 500);
    assert.strictEqual(r.folhaParcial, true);
    assert.strictEqual(r.folhaIndisponivel, false);
  });
}

console.log('\n(c) Mês sem NENHUM dos dois — custoFolha=0, folhaIndisponivel=true (comportamento original intacto)');
{
  teste('sem TES_CONTAS "Salários" e sem ENCARGOS_FOLHA do mês — "sem dados" genuíno', () => {
    const ENCARGOS_FOLHA = {}; // nenhuma chave — nem para este mês, nem para nenhum
    const r = correFinTotaisMesReal(2026, 9, { TES_RECEBER: [], TES_CONTAS: [], FIN_DESPESAS: [], EC_DESPESAS_APP: [], TES_COMPRAS_TOCO: null, ENCARGOS_FOLHA });
    assert.strictEqual(r.custoFolha, 0);
    assert.strictEqual(r.custoSegurosBonus, 0);
    assert.strictEqual(r.folhaIndisponivel, true);
    assert.strictEqual(r.folhaParcial, false);
  });
  teste('ENCARGOS_FOLHA existe mas só com seguros=0/bonus=0 explícitos para o mês alvo — continua "sem dados", nunca "parcial"', () => {
    const ENCARGOS_FOLHA = { '2026-09': { seguros: 0, bonus: 0, nota: '' } };
    const r = correFinTotaisMesReal(2026, 9, { TES_RECEBER: [], TES_CONTAS: [], FIN_DESPESAS: [], EC_DESPESAS_APP: [], TES_COMPRAS_TOCO: null, ENCARGOS_FOLHA });
    assert.strictEqual(r.custoFolha, 0);
    assert.strictEqual(r.folhaIndisponivel, true);
    assert.strictEqual(r.folhaParcial, false);
  });
  teste('ENCARGOS_FOLHA global nem sequer definido (typeof undefined) — nunca rebenta, custoSegurosBonus=0', () => {
    const r = correFinTotaisMesReal(2026, 9, { TES_RECEBER: [], TES_CONTAS: [], FIN_DESPESAS: [], EC_DESPESAS_APP: [], TES_COMPRAS_TOCO: null });
    assert.strictEqual(r.custoFolha, 0);
    assert.strictEqual(r.custoSegurosBonus, 0);
    assert.strictEqual(r.folhaIndisponivel, true);
  });
}

console.log('\n(d) Mês com base disponível mas SEM entrada em ENCARGOS_FOLHA para esse mês (chave ausente) — custoSegurosBonus=0 limpo, sem NaN');
{
  teste('base presente, ENCARGOS_FOLHA tem dados de OUTRO mês só — custoSegurosBonus=0, custoFolha=só a base, nunca NaN', () => {
    const TES_CONTAS = [
      { id: 'sal-1', descricao: 'Salários — Setembro 2026', categoria: 'Salários', estado: 'Pendente', data: '29/09/2026', dataPagamento: null, valor: 8000, folhaBruto: 10500, folhaSSEmpresa: 2493.75 },
    ];
    const ENCARGOS_FOLHA = { '2026-08': { seguros: 999, bonus: 999, nota: 'mês errado — não deve contar' } };
    const r = correFinTotaisMesReal(2026, 9, { TES_RECEBER: [], TES_CONTAS, FIN_DESPESAS: [], EC_DESPESAS_APP: [], TES_COMPRAS_TOCO: null, ENCARGOS_FOLHA });
    assert.strictEqual(r.custoSegurosBonus, 0);
    assert.strictEqual(r.custoFolha, 10500 + 2493.75);
    assert.strictEqual(Number.isNaN(r.custoFolha), false);
    assert.strictEqual(r.folhaIndisponivel, false);
    assert.strictEqual(r.folhaParcial, false);
  });
  teste('base presente, ENCARGOS_FOLHA totalmente vazio ({}) — mesmo resultado limpo', () => {
    const TES_CONTAS = [
      { id: 'sal-1', descricao: 'Salários — Setembro 2026', categoria: 'Salários', estado: 'Pendente', data: '29/09/2026', dataPagamento: null, valor: 8000, folhaBruto: 10500, folhaSSEmpresa: 2493.75 },
    ];
    const r = correFinTotaisMesReal(2026, 9, { TES_RECEBER: [], TES_CONTAS, FIN_DESPESAS: [], EC_DESPESAS_APP: [], TES_COMPRAS_TOCO: null, ENCARGOS_FOLHA: {} });
    assert.strictEqual(r.custoSegurosBonus, 0);
    assert.strictEqual(r.custoFolha, 10500 + 2493.75);
  });
}

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou > 0 ? 1 : 0);
