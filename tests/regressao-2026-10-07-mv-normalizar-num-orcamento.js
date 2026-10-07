// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — Mapa de Vendas: mvNormalizarNumOrcamento() não
// reconhecia o formato novo da folha "Orçamentos" (07/10/2026).
//
// Causa raiz confirmada em produção (tabela ob_orcamentos): existe uma
// única linha com id='ORC-2026OB-2026' (cliente NextFitout, criada em
// 21/09/2026 — o dia em que mvSincronizarGoogleSheet() nasceu). Desde
// então a folha passou a usar o formato "OB-2026.10.830.RM"
// (ano.mês.sequência.iniciais), e a versão antiga da função fazia
// /(\d+)/.exec(bruto), que apanha sempre o PRIMEIRO grupo de dígitos — o
// ANO — gerando sempre o mesmo ID fabricado "ORC-2026OB-2026" para
// qualquer linha da folha. Como esse ID já existe desde 21/09, a
// sincronização ficava presa a reportar "0 orçamentos novos" para
// sempre, por mais linhas novas que a folha tivesse.
//
// Corre com: node tests/regressao-2026-10-07-mv-normalizar-num-orcamento.js
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

const SRC = extrairFuncao('mvNormalizarNumOrcamento');

function rodar(bruto) {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(SRC + '\nthis._r = mvNormalizarNumOrcamento(' + JSON.stringify(bruto) + ');', ctx);
  return ctx._r;
}

console.log('\n[A] mvNormalizarNumOrcamento() reconhece o formato novo "OB-ANO.MÊS.SEQ.INICIAIS" sem colapsar todas as linhas no mesmo ID');

teste('"OB-2026.10.830.RM" → ID único baseado na string toda, não no ano', () => {
  assert.strictEqual(rodar('OB-2026.10.830.RM'), 'ORC-OB-2026.10.830.RM');
});

teste('duas linhas diferentes da folha geram IDs diferentes (não colapsam no "ano")', () => {
  const a = rodar('OB-2026.10.1.RM');
  const b = rodar('OB-2026.10.830.RM');
  assert.notStrictEqual(a, b, 'duas linhas reais da folha nunca podem gerar o mesmo ID fabricado');
});

teste('duas linhas com o mesmo ano e mês, sequências diferentes, geram IDs diferentes (bug antigo: ambas davam "ORC-2026OB-2026")', () => {
  const a = rodar('OB-2026.09.821.PF');
  const b = rodar('OB-2026.10.822.PF');
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(a, 'ORC-2026OB-2026');
  assert.notStrictEqual(b, 'ORC-2026OB-2026');
});

teste('caracter invisível (espaço de largura zero \\u200B) junto às iniciais não cria um ID diferente do mesmo orçamento real', () => {
  // Confirmado em produção (07/10/2026): a mesma linha real "2026.09.804.RM"
  // apareceu na folha ora sem, ora com um ​ a seguir a "RM" — \s não
  // apanha este caracter, por isso gerava dois IDs fabricados diferentes
  // para a MESMA linha, criando um duplicado verdadeiro no Supabase.
  const semInvisivel = rodar('OB-2026.09.804.RM');
  const comInvisivel = rodar('OB-2026.09.804.RM​');
  assert.strictEqual(semInvisivel, comInvisivel, 'o mesmo orçamento real, com ou sem o caracter invisível, tem de gerar o MESMO ID');
});

teste('BOM (\\uFEFF) e outros espaços de largura zero (\\u200C, \\u200D) também são ignorados', () => {
  const base = rodar('OB-2026.10.1.RM');
  assert.strictEqual(rodar('﻿OB-2026.10.1.RM'), base);
  assert.strictEqual(rodar('OB-2026.10.1.RM‌'), base);
  assert.strictEqual(rodar('OB-2026.10.1.RM‍'), base);
});

teste('formato antigo (só número, ex.: "786") mantém o comportamento histórico — não duplica orçamentos já sincronizados', () => {
  assert.strictEqual(rodar('786'), 'ORC-2026OB-786');
});

teste('vazio/nulo continua a devolver null (linha ignorada, nunca gera ID falso)', () => {
  assert.strictEqual(rodar(''), null);
  assert.strictEqual(rodar(null), null);
});

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou ? 1 : 0);
