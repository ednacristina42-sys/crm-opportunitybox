// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — o cartão "✗ Escrita real PAROU" em
// sincFinRenderPainel() mostra sempre o registo da ÚLTIMA tentativa de
// escrita real (localStorage, SINC_FIN_ESCRITA_ULT_KEY), que só muda quando
// se clica "Confirmar escrita real" de novo — nunca só por correr um
// dry-run. Sem nenhum aviso, uma tentativa falhada de há semanas/meses
// parecia sempre um erro que tinha acabado de acontecer agora.
//
// Confundiu a Edna duas vezes em 16/11/2026 (tentativas de 24/09 e de 29/09
// reportadas como se fossem do momento), a segunda com "de logo solução a
// isto". Corrigido: um aviso claro aparece sempre que a tentativa mostrada
// tem mais de 10 minutos.
//
// Corre com: node tests/regressao-2026-11-16-sincfin-aviso-tentativa-antiga.js
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

const SRC = extrairFuncao('sincFinRenderPainel');

const AGORA_ISO = '2026-11-16T15:00:00.000Z';

function montarCtx(){
  var innerHTML = '';
  const RealDate = Date;
  const ctx = {
    console,
    document: {
      getElementById: function(id){
        if(id !== 'sinc-fin-corpo') return null;
        return {
          get innerHTML(){ return innerHTML; },
          set innerHTML(v){ innerHTML = v; },
        };
      },
    },
    Date: class extends RealDate {
      constructor(...args){ if(args.length === 0){ super(AGORA_ISO); } else { super(...args); } }
      static now(){ return new RealDate(AGORA_ISO).getTime(); }
    },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx: ctx, html: function(){ return innerHTML; } };
}

console.log('\n[A] sincFinRenderPainel() avisa quando o cartão de escrita real é de uma tentativa antiga');

teste('tentativa de há 2 meses -> mostra o aviso "tentativa ANTERIOR"', () => {
  const r = montarCtx();
  r.ctx.sincFinRenderPainel({ resumo: {}, resultado_escrita: {
    ts: '2026-09-29T12:20:31.000Z', ok: false, etapa: 'verificacao_duplicados',
    backup_gerado: true, total_antes: 571, esperado_inserir_sheet: 32, esperado_inserir_ft: 2, esperado_inserir_nc: 1, esperado_inserir_total: 35,
    sheet_inseridas_confirmadas: 0, ft_inseridas_confirmadas: 0, nc_inseridas_confirmadas: 0, updates_confirmados: 0, deletes_confirmados: 0,
    erros: ['[verificacao_duplicados] 1 das linhas novas já existem na base atual'],
  }});
  const out = r.html();
  assert.ok(out.indexOf('tentativa ANTERIOR') !== -1, 'tinha de avisar claramente que não é de agora');
});

teste('tentativa de agora mesmo (1 minuto) -> sem aviso de "antiga"', () => {
  const r = montarCtx();
  r.ctx.sincFinRenderPainel({ resumo: {}, resultado_escrita: {
    ts: '2026-11-16T14:59:00.000Z', ok: false, etapa: 'verificacao_duplicados',
    backup_gerado: true, total_antes: 571, esperado_inserir_sheet: 32, esperado_inserir_ft: 2, esperado_inserir_nc: 1, esperado_inserir_total: 35,
    sheet_inseridas_confirmadas: 0, ft_inseridas_confirmadas: 0, nc_inseridas_confirmadas: 0, updates_confirmados: 0, deletes_confirmados: 0,
    erros: ['falhou agora mesmo'],
  }});
  const out = r.html();
  assert.ok(out.indexOf('tentativa ANTERIOR') === -1, 'uma falha que acabou de acontecer não precisa do aviso de "antiga"');
});

teste('escrita bem sucedida e antiga também recebe o aviso (vale para sucesso e falha)', () => {
  const r = montarCtx();
  r.ctx.sincFinRenderPainel({ resumo: {}, resultado_escrita: {
    ts: '2026-10-01T09:00:00.000Z', ok: true, etapa: null,
    backup_gerado: true, total_antes: 500, total_depois_real: 535,
    esperado_inserir_sheet: 30, esperado_inserir_ft: 4, esperado_inserir_nc: 1, esperado_inserir_total: 35,
    sheet_inseridas_confirmadas: 30, ft_inseridas_confirmadas: 4, nc_inseridas_confirmadas: 1, updates_confirmados: 0, deletes_confirmados: 0,
    erros: [],
  }});
  const out = r.html();
  assert.ok(out.indexOf('tentativa ANTERIOR') !== -1);
  assert.ok(out.indexOf('Escrita real concluída e confirmada') !== -1);
});

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou ? 1 : 0);
