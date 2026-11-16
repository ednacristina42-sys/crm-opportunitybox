// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — tocoSincronizarFaturas() escondia uma falha total de
// sincronização atrás de "ℹ️ Sem documentos", a mesma mensagem usada quando
// o TOConline genuinamente não tem documentos nenhuns. Cada recurso
// (invoices/credit_notes/receipts) tinha o seu próprio try/catch que só
// fazia console.error — se os 3 falhassem (ex.: TOConline desligado/token
// expirado), `todos` ficava vazio e a função seguia em frente, mostrando
// "Sem documentos" como se tivesse corrido bem.
//
// Reportado pela Edna via revisão externa (documento "Novas correções -
// CRM", 16/11/2026): "o botão de sincronizar do TOConline vai para a tela
// de Tesouraria, e aqui não tem nenhum dado!" — exactamente este cenário:
// parecia um resultado vazio normal, não uma falha a investigar.
//
// Corre com: node tests/regressao-2026-11-16-toco-sincronizar-faturas-falha-visivel.js
// Sem dependências externas — só Node core (fs, vm, assert).
// ══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

let passou = 0, falhou = 0;
async function teste(nome, fn) {
  try { await fn(); console.log('  ok  — ' + nome); passou++; }
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

const SRC = 'async ' + extrairFuncao('tocoSincronizarFaturas');

function elFalso() { return { textContent: '', style: {}, classList: { add: function(){}, remove: function(){} }, innerHTML: '', value: '' }; }

function montarCtx(sincFinBuscarRecursoCompletoFake) {
  var elementos = {};
  var ctx = {
    console,
    document: { getElementById: function(id){ if(!elementos[id]) elementos[id] = elFalso(); return elementos[id]; } },
    localStorage: { setItem: function(){}, getItem: function(){ return null; } },
    Date: Date,
    TOCO_FAT_KEY: 'toco-fat-cache',
    _tocoFatCache: [],
    sincFinBuscarRecursoCompleto: sincFinBuscarRecursoCompletoFake,
    tocoRenderFaturas: function(){},
    tocoUpdateVencidasBadge: function(){},
    tocoUpdateConexaoUI: function(){},
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx: ctx, el: function(id){ return elementos[id]; } };
}

(async () => {
  console.log('\n[A] tocoSincronizarFaturas() nunca mostra "Sem documentos" quando a falha é total');

  await teste('as 3 fontes falham -> lança erro (nunca "Sem documentos"), status fica "❌ Erro"', async () => {
    const r = montarCtx(function(tipo){ return Promise.reject(new Error('TOConline: não autorizado (' + tipo + ')')); });
    await r.ctx.tocoSincronizarFaturas(false);
    const status = r.el('toco-sync-status').textContent;
    assert.ok(status.indexOf('❌ Erro') === 0, 'esperava uma mensagem de erro visível, veio: "' + status + '"');
    assert.ok(status.toLowerCase().indexOf('sem documentos') === -1, 'nunca pode parecer um resultado vazio normal');
  });

  await teste('as 3 fontes têm sucesso mas devolvem 0 documentos reais -> "Sem documentos" continua correto (sem regressão)', async () => {
    const r = montarCtx(function(tipo){ return Promise.resolve({ dados: [], completo: true }); });
    await r.ctx.tocoSincronizarFaturas(false);
    const status = r.el('toco-sync-status').textContent;
    assert.ok(status.indexOf('ℹ️ Sem documentos') === 0, 'um resultado genuinamente vazio continua a mostrar "Sem documentos"');
  });

  await teste('1 fonte falha mas as outras têm documentos -> sincroniza com sucesso, mas avisa da falha parcial (nunca escondida)', async () => {
    const r = montarCtx(function(tipo){
      if(tipo === 'credit_notes') return Promise.reject(new Error('timeout'));
      return Promise.resolve({ dados: [{ id: '1', attributes: { document_no: 'FT 1', customer_business_name: 'Cliente X', date: '2026-11-01', gross_total: 100 } }], completo: true });
    });
    await r.ctx.tocoSincronizarFaturas(false);
    const status = r.el('toco-sync-status').textContent;
    assert.ok(status.indexOf('✅ Sincronizado') === 0, 'com documentos reais, continua a reportar sucesso');
    assert.ok(status.indexOf('credit_notes') !== -1, 'a falha parcial de credit_notes tem de aparecer no texto, nunca escondida');
  });

  console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
  process.exit(falhou ? 1 : 0);
})();
