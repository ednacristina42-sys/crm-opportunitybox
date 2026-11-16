// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — obSbIniciarRealtimeLeads() subscrevia com
// filter:'chave=eq.ob-leads' / filter:'chave=eq.ob-crm-atividades', que o
// Supabase Realtime rejeitava em produção ("invalid column for filter
// chave", visto repetidamente nos logs do Postgres do projeto ao longo de
// várias horas em 13/11/2026 — auditoria overnight pedida pela Edna:
// "verificando todo o crm e veja se tem erros"). O evento nunca chegava ao
// browser, por isso a sincronização em tempo real de leads/atividades
// entre dispositivos estava sempre silenciosamente partida.
//
// Correção: ouvir todas as alterações da tabela 'ob_crm_dados', sem filter
// (o handler já ignora qual chave mudou - mescla sempre leads+atividades+
// follow-ups).
//
// Corre com: node tests/regressao-2026-11-13-obsb-realtime-sem-filtro.js
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

const SRC = extrairFuncao('obSbIniciarRealtimeLeads');

function montarCtx() {
  var chamadasOn = [];
  var chamouSubscribe = false;
  var canalFalso = {
    on: function (tipo, opts, cb) { chamadasOn.push({ tipo: tipo, opts: opts, cb: cb }); return canalFalso; },
    subscribe: function () { chamouSubscribe = true; return canalFalso; },
  };
  var sbFalso = {
    channel: function (nome) { this._nomeCanal = nome; return canalFalso; },
  };
  const ctx = {
    console,
    crmSBClient: function () { return sbFalso; },
    obSbMesclarRemotoAntesDoBackup: function () {},
    _obSbRealtimeCh: null,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx: ctx, chamadasOn: function () { return chamadasOn; }, subscreveu: function () { return chamouSubscribe; } };
}

console.log('\n[A] obSbIniciarRealtimeLeads() não usa mais filter (causa do "invalid column for filter chave")');

teste('subscreve postgres_changes na tabela ob_crm_dados, sem a chave "filter" nas opções', () => {
  const r = montarCtx();
  r.ctx.obSbIniciarRealtimeLeads();
  const chamadas = r.chamadasOn();
  assert.ok(chamadas.length >= 1, 'tinha de registar pelo menos um handler postgres_changes');
  chamadas.forEach(function (c) {
    assert.strictEqual(c.tipo, 'postgres_changes');
    assert.strictEqual(c.opts.table, 'ob_crm_dados');
    assert.ok(!('filter' in c.opts), 'não pode ter "filter" nas opções — era isso que o Realtime rejeitava em produção');
  });
});

teste('chama subscribe() no canal', () => {
  const r = montarCtx();
  r.ctx.obSbIniciarRealtimeLeads();
  assert.strictEqual(r.subscreveu(), true);
});

teste('o handler continua a chamar obSbMesclarRemotoAntesDoBackup() quando o evento chega', () => {
  const r = montarCtx();
  var chamouMerge = false;
  r.ctx.obSbMesclarRemotoAntesDoBackup = function () { chamouMerge = true; };
  r.ctx.obSbIniciarRealtimeLeads();
  r.chamadasOn()[0].cb();
  assert.strictEqual(chamouMerge, true, 'o handler tem de continuar a mesclar leads/atividades/follow-ups, tal como antes');
});

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou ? 1 : 0);
