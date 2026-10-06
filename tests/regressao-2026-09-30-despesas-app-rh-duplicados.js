// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — dois bugs reportados pela Edna (doc "CRM - Parte 5",
// 30/09/2026, capturas de ecrã):
//
//   (A) Despesas e Reembolsos: o KPI "Aprovadas" ficava preso em €0/0 mesmo
//       com linhas reais marcadas "aprovada" na tabela. Causa: o app de
//       pontos (crm-expenses, outro projecto Supabase) devolve o estado em
//       português/com acentos, mas o código comparava `d.status==='approved'`
//       ao valor em bruto — nunca batia. despAppEstadoNorm() normaliza para
//       as 5 chaves inglesas antes de qualquer comparação/lookup.
//
//   (B) RH → Férias e RH → Turnos: "André Nolasco" (ficha local, rhColabs)
//       e "André Nolasco Lamas de Sousa e Silva" (nome completo do app de
//       pontos, mesma pessoa) apareciam como duas linhas — rhFtColabs()
//       deduplicava por igualdade EXACTA de nome, não por correspondência
//       difusa como rhRenderColabs() já fazia em RH → Colaboradores.
//       rhFtColabs() passa a usar rhMesmaPessoa() (mesma lógica), com o
//       registo local a vencer quando há correspondência.
//
// Corre com: node tests/regressao-2026-09-30-despesas-app-rh-duplicados.js
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

// ── (A) despAppEstadoNorm() ─────────────────────────────────────────────
const SRC_NORM = extrairFuncao('despAppEstadoNorm');

console.log('\n[A] despAppEstadoNorm() — normaliza estado do app de pontos antes de comparar');
{
  const casos = [
    ['approved', 'approved'],
    ['Aprovada', 'approved'],
    ['aprovada', 'approved'],
    ['APROVADA', 'approved'],
    ['Aprovado', 'approved'],
    ['rejected', 'rejected'],
    ['Rejeitada', 'rejected'],
    ['reimbursed', 'reimbursed'],
    ['Reembolsada', 'reimbursed'],
    ['submitted', 'submitted'],
    ['Submetida', 'submitted'],
    ['pending', 'pending'],
    ['Pendente', 'pending'],
  ];
  casos.forEach(([raw, esperado]) => {
    teste('"' + raw + '" -> "' + esperado + '"', () => {
      const r = correNumContexto(SRC_NORM, 'despAppEstadoNorm(_RAW)', { _RAW: raw });
      assert.strictEqual(r, esperado);
    });
  });
  teste('valor desconhecido — devolve normalizado, sem rebentar (nunca assume um estado)', () => {
    const r = correNumContexto(SRC_NORM, 'despAppEstadoNorm(_RAW)', { _RAW: 'XPTO' });
    assert.strictEqual(r, 'xpto');
  });
  teste('undefined/null/"" — nunca rebenta, devolve string vazia', () => {
    assert.strictEqual(correNumContexto(SRC_NORM, 'despAppEstadoNorm(_RAW)', { _RAW: undefined }), '');
    assert.strictEqual(correNumContexto(SRC_NORM, 'despAppEstadoNorm(_RAW)', { _RAW: null }), '');
    assert.strictEqual(correNumContexto(SRC_NORM, 'despAppEstadoNorm(_RAW)', { _RAW: '' }), '');
  });
}

console.log('\n[A2] Caso concreto da auditoria — contagem "Aprovadas" com status em português');
{
  teste('3 despesas "Aprovada"/"aprovada"/"approved" (mesma pessoa física, grafias diferentes) — todas contam', () => {
    const SRC = SRC_NORM + '\nfunction contarAprovadas(lista){ var n=0,v=0; lista.forEach(function(d){ if(despAppEstadoNorm(d.status)==="approved"){ n++; v+=d.amount_eur; } }); return {n:n,v:v}; }';
    const lista = [
      { status: 'Aprovada', amount_eur: 10 },
      { status: 'aprovada', amount_eur: 20 },
      { status: 'approved', amount_eur: 30 },
      { status: 'Pendente', amount_eur: 999 },
    ];
    const r = correNumContexto(SRC, 'contarAprovadas(_LISTA)', { _LISTA: lista });
    assert.strictEqual(r.n, 3, 'devia contar as 3 aprovadas, nunca a pendente');
    assert.strictEqual(r.v, 60);
  });
}

// ── (B) rhFtColabs() — dedup Férias/Turnos ──────────────────────────────
const SRC_FT = [
  extrairFuncao('rhNormalizarNome'),
  extrairFuncao('rhMesmaPessoa'),
  extrairFuncao('rhFtColabs'),
].join('\n');

console.log('\n[B] rhFtColabs() — reconciliação App×local por nome (Férias/Turnos)');
{
  teste('mesma pessoa em rhColabs (nome curto) e EC_FUNCIONARIOS (nome completo) — 1 só linha, vence o registo local', () => {
    const rhColabs = [{ id: 'local-1', nome: 'André Nolasco', cargo: 'comercial' }];
    const EC_FUNCIONARIOS = [{ ec_id: 'app-1', nome: 'André Nolasco Lamas de Sousa e Silva', cargo: 'comercial' }];
    const r = correNumContexto(SRC_FT, 'rhFtColabs()', { rhColabs, EC_FUNCIONARIOS });
    const andres = r.filter(c => /andr/i.test(c.nome));
    assert.strictEqual(andres.length, 1, 'devia aparecer uma única vez, não duas');
    assert.strictEqual(andres[0].id, 'local-1', 'o registo local é que deve vencer (tem ficha de RH completa)');
  });

  teste('caso real "Mota" — mesma pessoa, mesma reconciliação', () => {
    const rhColabs = [{ id: 'local-2', nome: 'Rui Mota', cargo: 'comercial' }];
    const EC_FUNCIONARIOS = [{ ec_id: 'app-2', nome: 'Rui Jorge Fausto Alves Mota', cargo: 'comercial' }];
    const r = correNumContexto(SRC_FT, 'rhFtColabs()', { rhColabs, EC_FUNCIONARIOS });
    const motas = r.filter(c => /mota/i.test(c.nome));
    assert.strictEqual(motas.length, 1);
    assert.strictEqual(motas[0].id, 'local-2');
  });

  teste('pessoas genuinamente diferentes — nunca fundidas', () => {
    const rhColabs = [{ id: 'local-1', nome: 'André Nolasco' }];
    const EC_FUNCIONARIOS = [{ ec_id: 'app-3', nome: 'Bruno Miguel Francisquinho Garcia' }];
    const r = correNumContexto(SRC_FT, 'rhFtColabs()', { rhColabs, EC_FUNCIONARIOS });
    assert.strictEqual(r.length, 2);
  });

  teste('só App, sem ficha local — continua a aparecer (nunca desaparece ninguém)', () => {
    const rhColabs = [];
    const EC_FUNCIONARIOS = [{ ec_id: 'app-4', nome: 'Carlos Manuel Neves Lopes' }];
    const r = correNumContexto(SRC_FT, 'rhFtColabs()', { rhColabs, EC_FUNCIONARIOS });
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].id, 'app-4');
  });

  teste('nem rhColabs nem EC_FUNCIONARIOS definidos — nunca rebenta, lista vazia', () => {
    const r = correNumContexto(SRC_FT, 'rhFtColabs()', {});
    assert.strictEqual(r.length, 0);
  });
}

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou ? 1 : 0);
