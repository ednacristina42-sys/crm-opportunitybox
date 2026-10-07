// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — "Gerar Contrato" em RH → Colaboradores (07/10/2026).
// A Edna enviou o texto real de um contrato ("A termo incerto") assinado
// com a Suyenne; rhGerarContrato() usa esse texto tal e qual, só com os
// campos variáveis (nome, documento, morada, cargo, admissão, salário,
// motivo) substituídos — nunca inventa texto legal para outros tipos de
// contrato (só há modelo real para "A termo incerto").
//
// Cobre as partes puras/testáveis (o resto é DOM: window.open/print):
//   (a) rhDataExtenso()/rhDataPT() — formatação de datas ISO.
//   (b) rhDocTipoFrase() — minúsculas, nunca rebenta com valor vazio.
//   (c) rhGerarContrato() recusa gerar para qualquer tipo que não seja
//       "A termo incerto" — nunca inventa outro modelo.
//   (d) rhGerarContrato() recusa gerar com campos legais em falta — nunca
//       produz um contrato com dados incompletos/inventados.
//   (e) com tudo preenchido, chama window.open/print (gera o documento).
//
// Corre com: node tests/regressao-2026-10-07-gerar-contrato.js
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

// Um documento/janela falsos minimalistas — só o que rhGerarContrato() lê/usa.
function fakeDoc(values) {
  const els = {};
  Object.keys(values).forEach(function (id) { els[id] = { value: values[id] }; });
  return { getElementById: function (id) { return els[id] || { value: '' }; } };
}

console.log('\n[a] rhDataExtenso()/rhDataPT() — formatação de datas ISO');
{
  const SRC = extrairVar('RH_MESES_EXTENSO') + extrairFuncao('rhDataExtenso') + '\n' + extrairFuncao('rhDataPT');
  function correr(chamada, globals) {
    const ctx = Object.assign({ console }, globals);
    vm.createContext(ctx);
    vm.runInContext(SRC + '\n_RESULT = ' + chamada + ';', ctx);
    return ctx._RESULT;
  }
  teste('rhDataExtenso("2026-03-09") -> "09 de março de 2026"', () => {
    assert.strictEqual(correr('rhDataExtenso(_D)', { _D: '2026-03-09' }), '09 de março de 2026');
  });
  teste('rhDataExtenso("") -> string vazia, nunca rebenta', () => {
    assert.strictEqual(correr('rhDataExtenso(_D)', { _D: '' }), '');
  });
  teste('rhDataPT("2027-06-03") -> "03/06/2027"', () => {
    assert.strictEqual(correr('rhDataPT(_D)', { _D: '2027-06-03' }), '03/06/2027');
  });
}

console.log('\n[b] rhDocTipoFrase() — minúsculas, nunca rebenta');
{
  const SRC = extrairFuncao('rhDocTipoFrase');
  function correr(tipo) {
    const ctx = { console, _T: tipo };
    vm.createContext(ctx);
    vm.runInContext(SRC + '\n_RESULT = rhDocTipoFrase(_T);', ctx);
    return ctx._RESULT;
  }
  teste('"Cartão de Residência" -> "cartão de residência"', () => {
    assert.strictEqual(correr('Cartão de Residência'), 'cartão de residência');
  });
  teste('undefined -> cai no padrão "cartão de cidadão", nunca "undefined"', () => {
    assert.strictEqual(correr(undefined), 'cartão de cidadão');
  });
}

console.log('\n[c] rhGerarContrato() — só gera para "A termo incerto", nunca inventa outro modelo');
{
  const SRC = [
    extrairVar('RH_EMPRESA'),
    extrairVar('RH_SUBSIDIO_ALMOCO_PADRAO'),
    extrairVar('RH_MESES_EXTENSO'),
    extrairFuncao('rhDataExtenso'),
    extrairFuncao('rhDataPT'),
    extrairFuncao('rhDocTipoFrase'),
    extrairFuncao('rhGerarContrato'),
  ].join('\n');

  const CAMPOS_COMPLETOS = {
    'rh-c-contrato': 'A termo incerto',
    'rh-c-nome': 'Suyenne Carolina Machado Vieira de Albuquerque Martins',
    'rh-c-nif': '297549588',
    'rh-c-niss': '12081664489',
    'rh-c-morada': 'Bairro da Boa Vista 1 casa 5 - 2725-034 Algueirão',
    'rh-c-doc-tipo': 'Cartão de Residência',
    'rh-c-doc-num': '12798S33H',
    'rh-c-doc-validade': '2027-06-03',
    'rh-c-cargo': 'Assistente Administrativa',
    'rh-c-admissao': '2026-03-09',
    'rh-c-salario': '1250',
    'rh-c-motivo': 'execução de projeto específico de desenvolvimento, construção, implementação e operacionalização da loja online.',
  };

  function correr(valores) {
    const avisos = [];
    let printChamado = false;
    const ctx = {
      console,
      document: fakeDoc(valores),
      alert: function (msg) { avisos.push(msg); },
      window: { open: function () { return { document: { write: function () {}, close: function () {} }, print: function () { printChamado = true; } }; } },
      setTimeout: function (fn) { fn(); }, // corre já, sem esperar os 600ms
    };
    vm.createContext(ctx);
    vm.runInContext(SRC + '\nrhGerarContrato();', ctx);
    return { avisos: avisos, printChamado: printChamado };
  }

  teste('Tipo de Contrato = "A termo certo" — recusa gerar, nunca inventa texto legal', () => {
    const valores = Object.assign({}, CAMPOS_COMPLETOS, { 'rh-c-contrato': 'A termo certo' });
    const r = correr(valores);
    assert.strictEqual(r.avisos.length, 1);
    assert.ok(/único modelo real|ainda só há/i.test(r.avisos[0]));
    assert.strictEqual(r.printChamado, false);
  });

  teste('"Sem termo" — mesma recusa', () => {
    const valores = Object.assign({}, CAMPOS_COMPLETOS, { 'rh-c-contrato': 'Sem termo' });
    const r = correr(valores);
    assert.strictEqual(r.printChamado, false);
  });
}

console.log('\n[d] rhGerarContrato() — recusa com campos legais em falta, nunca gera incompleto');
{
  const SRC = [
    extrairVar('RH_EMPRESA'),
    extrairVar('RH_SUBSIDIO_ALMOCO_PADRAO'),
    extrairVar('RH_MESES_EXTENSO'),
    extrairFuncao('rhDataExtenso'),
    extrairFuncao('rhDataPT'),
    extrairFuncao('rhDocTipoFrase'),
    extrairFuncao('rhGerarContrato'),
  ].join('\n');

  function correr(valores) {
    const avisos = [];
    let printChamado = false;
    const ctx = {
      console, document: fakeDoc(valores),
      alert: function (msg) { avisos.push(msg); },
      window: { open: function () { return { document: { write: function () {}, close: function () {} }, print: function () { printChamado = true; } }; } },
      setTimeout: function (fn) { fn(); },
    };
    vm.createContext(ctx);
    vm.runInContext(SRC + '\nrhGerarContrato();', ctx);
    return { avisos: avisos, printChamado: printChamado };
  }

  teste('sem Motivo do termo incerto — recusa e diz exatamente o que falta', () => {
    const valores = {
      'rh-c-contrato': 'A termo incerto', 'rh-c-nome': 'Teste', 'rh-c-nif': '123456789', 'rh-c-niss': '12345678901',
      'rh-c-morada': 'Rua X', 'rh-c-doc-tipo': 'Cartão de Cidadão', 'rh-c-doc-num': 'ABC123', 'rh-c-doc-validade': '2030-01-01',
      'rh-c-cargo': 'Técnico', 'rh-c-admissao': '2026-01-01', 'rh-c-salario': '1000', 'rh-c-motivo': '',
    };
    const r = correr(valores);
    assert.strictEqual(r.printChamado, false);
    assert.ok(/Motivo do termo incerto/.test(r.avisos[0]));
  });

  teste('sem N.º do Documento nem Validade — recusa, lista ambos', () => {
    const valores = {
      'rh-c-contrato': 'A termo incerto', 'rh-c-nome': 'Teste', 'rh-c-nif': '123456789', 'rh-c-niss': '12345678901',
      'rh-c-morada': 'Rua X', 'rh-c-doc-tipo': 'Cartão de Cidadão', 'rh-c-doc-num': '', 'rh-c-doc-validade': '',
      'rh-c-cargo': 'Técnico', 'rh-c-admissao': '2026-01-01', 'rh-c-salario': '1000', 'rh-c-motivo': 'Substituição de trabalhador.',
    };
    const r = correr(valores);
    assert.strictEqual(r.printChamado, false);
    assert.ok(/N\.º do Documento/.test(r.avisos[0]));
    assert.ok(/Validade do Documento/.test(r.avisos[0]));
  });
}

console.log('\n[e] rhGerarContrato() — com tudo preenchido, gera o documento (window.open + print)');
{
  const SRC = [
    extrairVar('RH_EMPRESA'),
    extrairVar('RH_SUBSIDIO_ALMOCO_PADRAO'),
    extrairVar('RH_MESES_EXTENSO'),
    extrairFuncao('rhDataExtenso'),
    extrairFuncao('rhDataPT'),
    extrairFuncao('rhDocTipoFrase'),
    extrairFuncao('rhGerarContrato'),
  ].join('\n');

  const CAMPOS_COMPLETOS = {
    'rh-c-contrato': 'A termo incerto',
    'rh-c-nome': 'Suyenne Carolina Machado Vieira de Albuquerque Martins',
    'rh-c-nif': '297549588',
    'rh-c-niss': '12081664489',
    'rh-c-morada': 'Bairro da Boa Vista 1 casa 5 - 2725-034 Algueirão',
    'rh-c-doc-tipo': 'Cartão de Residência',
    'rh-c-doc-num': '12798S33H',
    'rh-c-doc-validade': '2027-06-03',
    'rh-c-cargo': 'Assistente Administrativa',
    'rh-c-admissao': '2026-03-09',
    'rh-c-salario': '1250',
    'rh-c-motivo': 'execução de projeto específico de desenvolvimento, construção, implementação e operacionalização da loja online.',
  };

  teste('campos todos preenchidos — abre a janela e chama print(), sem nenhum alerta', () => {
    const avisos = [];
    let printChamado = false, htmlEscrito = '';
    const ctx = {
      console, document: fakeDoc(CAMPOS_COMPLETOS),
      alert: function (msg) { avisos.push(msg); },
      window: { open: function () { return { document: { write: function (h) { htmlEscrito = h; }, close: function () {} }, print: function () { printChamado = true; } }; } },
      setTimeout: function (fn) { fn(); },
    };
    vm.createContext(ctx);
    vm.runInContext(SRC + '\nrhGerarContrato();', ctx);
    assert.strictEqual(avisos.length, 0, 'não devia haver nenhum alerta de campos em falta');
    assert.strictEqual(printChamado, true);
    assert.ok(htmlEscrito.indexOf('SUYENNE CAROLINA MACHADO VIEIRA DE ALBUQUERQUE MARTINS') !== -1, 'o nome tem de aparecer no documento gerado');
    assert.ok(htmlEscrito.indexOf('1 250,00 Euros') !== -1 || htmlEscrito.indexOf('1.250,00 Euros') !== -1 || htmlEscrito.indexOf('1250,00 Euros') !== -1, 'o salário formatado tem de aparecer');
    assert.ok(htmlEscrito.indexOf('CLÁUSULA PRIMEIRA') !== -1 && htmlEscrito.indexOf('CLÁUSULA NONA') !== -1, 'todas as cláusulas do modelo real têm de estar presentes');
  });
}

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou ? 1 : 0);
