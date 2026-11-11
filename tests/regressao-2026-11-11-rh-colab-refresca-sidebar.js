// ══════════════════════════════════════════════════════════════════════════
// Teste de regressão — rhLoadColabsFromSB() (RH → Colaboradores, Supabase)
// tinha de refrescar também a barra lateral ("ESPAÇOS > Comercial") e o
// seletor "Ver como (comercial)" — não só a grelha de cartões do RH
// (11/11/2026, reportado pela Edna: desativou o Humberto em RH →
// Colaboradores e ele continuou na barra lateral/"Ver como", mostrou
// screenshots dos dois sítios exactos).
//
// Nota: este NÃO é o mesmo "Gestão Comerciais" (crmComerciais,
// localStorage) do Pipeline de Leads — é o sistema separado de RH →
// Colaboradores, ligado à tabela ob_colaboradores no Supabase, que
// alimenta a barra lateral e o "Ver como" através de window.rhColabs.
//
// Corre com: node tests/regressao-2026-11-11-rh-colab-refresca-sidebar.js
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

function extrairFuncaoAtribuida(marcadorInicio) {
  const inicio = html.indexOf(marcadorInicio);
  if (inicio === -1) throw new Error('marcador "' + marcadorInicio + '" não encontrado em index.html');
  const corpoInicio = html.indexOf('{', inicio);
  let i = corpoInicio, profundidade = 0, fim = -1;
  for (; i < html.length; i++) {
    if (html[i] === '{') profundidade++;
    else if (html[i] === '}') { profundidade--; if (profundidade === 0) { fim = i + 1; break; } }
  }
  if (fim === -1) throw new Error('não fechou as chavetas de "' + marcadorInicio + '"');
  return html.slice(inicio, fim);
}

// window.rhLoadColabsFromSB = async function(){ ... };
const SRC = extrairFuncaoAtribuida('window.rhLoadColabsFromSB = async function()');

function rowToColabStub(r){ return r; }

function fakeSBClient(linhasAtivas) {
  return {
    from: function () {
      return {
        select: function () { return this; },
        is: function () { return this; },
        order: function () { return Promise.resolve({ data: linhasAtivas, error: null }); },
      };
    },
  };
}

function rodar(linhasAtivas) {
  var chamouRenderColabs = false, chamouSidebar = false, chamouUserSwitcher = false;
  const localStorageStub = { _d: {}, setItem: function (k, v) { this._d[k] = v; }, getItem: function (k) { return this._d[k] || null; } };
  const ctx = {
    console,
    sb: function () { return fakeSBClient(linhasAtivas); },
    TABLE: 'ob_colaboradores',
    rowToColab: rowToColabStub,
    localStorage: localStorageStub,
    rhRenderColabs: function () { chamouRenderColabs = true; },
    ensureToolbar: function () {},
    setStatus: function () {},
    rhRenderInativos: function () {},
    rhColabs: null,
    obRenderComerciaisSidebar: function () { chamouSidebar = true; },
    renderUserSwitcher: function () { chamouUserSwitcher = true; },
  };
  ctx.window = ctx; // no browser real, "window" É o global — bare rhColabs e window.rhColabs são a mesma variável
  ctx._rhShowInativos = false;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx); // avalia e grava em ctx.window.rhLoadColabsFromSB
  return { ctx: ctx, chamadas: function () { return { renderColabs: chamouRenderColabs, sidebar: chamouSidebar, userSwitcher: chamouUserSwitcher }; } };
}

(async () => {
  console.log('\n[A] rhLoadColabsFromSB() refresca RH + barra lateral + "Ver como", sempre que recarrega de Supabase');

  await teste('depois de carregar, chama obRenderComerciaisSidebar() e renderUserSwitcher() — não só rhRenderColabs()', async () => {
    const r = rodar([{ id: '1', nome: 'Rui Mota', dept: 'Dep. Comercial', ativo: true }]);
    await r.ctx.window.rhLoadColabsFromSB();
    const c = r.chamadas();
    assert.strictEqual(c.renderColabs, true, 'tinha de continuar a refrescar a grelha do RH, como já fazia');
    assert.strictEqual(c.sidebar, true, 'tinha de refrescar a barra lateral — senão um colaborador desativado continua lá até F5');
    assert.strictEqual(c.userSwitcher, true, 'tinha de refrescar o dropdown "Ver como (comercial)" — mesmo problema');
  });

  console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
  process.exit(falhou ? 1 : 0);
})();
