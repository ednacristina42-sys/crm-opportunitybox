// ══════════════════════════════════════════════════════════════════════════
// Testes de regressão — correção 24/09/2026 (Bloco 1 Financeiro/TOConline)
//
// Cobre, sem tocar em rede nem no Supabase real:
//   1. Erro 403 em loop no Agente Financeiro — papel não autorizado nunca
//      chama o TOConline (_finPapelAutorizado / crmVeTudo).
//   2. Retomada do checkpoint de compras — sync_purchases_snapshot() na
//      Edge Function nunca reinicia sozinho, só quando ?reiniciar=1
//      (verificação estrutural do código fonte, não execução — a Edge
//      Function chama a API real do TOConline, não é isolável em Node).
//   3. Contas a Receber — tocoBaixarRecebidosPorTocoId() nunca insere
//      linhas novas, só atualiza por _tocoId (identificador estável),
//      nunca reverte "Recebido" sozinho, e é idempotente (correr duas
//      vezes dá o mesmo resultado da primeira).
//
// Corre com: node tests/regressao-2026-09-24.js
// Sem dependências externas — só Node core (fs, vm, assert).
// ══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', 'index.html');
const EF_PATH = path.join(__dirname, '..', 'supabase', 'functions', 'crm-toconline', 'index.ts');
const html = fs.readFileSync(HTML_PATH, 'utf8');

let passou = 0, falhou = 0;
function teste(nome, fn) {
  try { fn(); console.log('  ok  — ' + nome); passou++; }
  catch (e) { console.log('FALHA — ' + nome + '\n        ' + (e && e.message)); falhou++; }
}

// ── Extrai o corpo de uma função "function NOME(...) { ... }" do index.html
// por contagem de chavetas (não é uma gramática JS completa, mas é
// suficiente para funções simples sem template strings com chavetas
// desequilibradas, que é o caso de todas as testadas aqui).
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

// ══════════════════════════════════════════════════════════════════════════
// 1. Erro 403 em loop — _finPapelAutorizado()
// ══════════════════════════════════════════════════════════════════════════
console.log('\n[1] Agente Financeiro — não chama o TOConline com papel não autorizado');
{
  const src = extrairFuncao('_finPapelAutorizado');
  function corre(cu) {
    const ctx = { CU: cu, console };
    vm.createContext(ctx);
    vm.runInContext(src + '\n_finPapelAutorizado_RESULT = _finPapelAutorizado();', ctx);
    return ctx._finPapelAutorizado_RESULT;
  }

  teste('sem sessão (CU=null) — não autorizado', () => {
    assert.strictEqual(corre(null), false);
  });
  teste('papel administrativo — NÃO autorizado (é o bug confirmado na auditoria)', () => {
    assert.strictEqual(corre({ admin: false, role: 'administrativo' }), false);
  });
  teste('papel design — não autorizado', () => {
    assert.strictEqual(corre({ admin: false, role: 'design' }), false);
  });
  teste('papel producao — não autorizado', () => {
    assert.strictEqual(corre({ admin: false, role: 'producao' }), false);
  });
  teste('papel comercial — autorizado', () => {
    assert.strictEqual(corre({ admin: false, role: 'comercial' }), true);
  });
  teste('papel financeiro — autorizado', () => {
    assert.strictEqual(corre({ admin: false, role: 'financeiro' }), true);
  });
  teste('papel manager — autorizado', () => {
    assert.strictEqual(corre({ admin: false, role: 'manager' }), true);
  });
  teste('admin (independente do role) — autorizado', () => {
    assert.strictEqual(corre({ admin: true, role: 'qualquer coisa' }), true);
  });
}

console.log('\n[1b] crmVeTudo() — vê tudo (admin ou administrativo), nunca por nome/email');
{
  const src = extrairFuncao('crmVeTudo');
  function corre(cu) {
    const ctx = { CU: cu, console };
    vm.createContext(ctx);
    vm.runInContext(src + '\n_RESULT = crmVeTudo();', ctx);
    return ctx._RESULT;
  }
  teste('administrativo vê tudo', () => assert.strictEqual(corre({ admin: false, role: 'administrativo' }), true));
  teste('comercial NÃO vê tudo (só a sua carteira)', () => assert.strictEqual(corre({ admin: false, role: 'comercial' }), false));
  teste('admin vê tudo', () => assert.strictEqual(corre({ admin: true, role: 'admin' }), true));
  teste('sem sessão não vê tudo', () => assert.strictEqual(corre(null), false));
}

// ══════════════════════════════════════════════════════════════════════════
// 2. Checkpoint de compras nunca reinicia sozinho (verificação estrutural)
// ══════════════════════════════════════════════════════════════════════════
console.log('\n[2] sync_purchases_snapshot — nunca reinicia o checkpoint sem ?reiniciar=1');
{
  const ef = fs.readFileSync(EF_PATH, 'utf8');
  teste('sincComprasSnapshotLote só usa checkpoint vazio quando reiniciar===true ou o checkpoint não existe', () => {
    const m = ef.match(/let ckpt = reiniciar \? null : \(await lerDaBase\(CHAVE_COMPRAS_CKPT\)\)[^;]*;\s*\n\s*if \(!ckpt \|\| !ckpt\.fase\) ckpt = checkpointComprasVazio\(\);/);
    assert.ok(m, 'padrão de retoma (ler checkpoint existente antes de decidir reiniciar) não encontrado — pode ter sido alterado');
  });
  teste('o handler HTTP só passa reiniciar=true quando ?reiniciar=1 explícito na URL', () => {
    const m = ef.match(/const reiniciarS = url\.searchParams\.get\("reiniciar"\) === "1";/);
    assert.ok(m, 'a rota sync_purchases_snapshot deixou de exigir ?reiniciar=1 explícito para reiniciar — risco de apagar progresso sem querer');
  });
  teste('o checkpoint só é apagado (checkpointComprasVazio) depois de o snapshot final estar gravado, nunca antes', () => {
    const idxGravou = ef.indexOf('const gravouSnapshot = await guardarNaBase(CHAVE_COMPRAS_SNAPSHOT, snapshot);');
    const idxLimpa = ef.indexOf('await guardarNaBase(CHAVE_COMPRAS_CKPT, checkpointComprasVazio());');
    assert.ok(idxGravou > -1 && idxLimpa > -1 && idxLimpa > idxGravou, 'a ordem gravar-snapshot-depois-limpar-checkpoint não está garantida no código');
  });
}

console.log('\n[2b] Loop do browser — retenta falhas transitórias, nunca falhas de autenticação');
{
  const src = extrairFuncao('_tocoErroEhAutenticacao');
  function ehAuth(msg) {
    const ctx = { console };
    vm.createContext(ctx);
    vm.runInContext(src + '\n_RESULT = _tocoErroEhAutenticacao(' + JSON.stringify(msg) + ');', ctx);
    return ctx._RESULT;
  }
  teste('"Sessão inválida ou expirada..." é erro de autenticação (não retenta)', () => {
    assert.strictEqual(ehAuth('Sessão inválida ou expirada. Volte a entrar no CRM.'), true);
  });
  teste('"A sua conta não tem perfil activo..." é erro de autenticação (não retenta)', () => {
    assert.strictEqual(ehAuth('A sua conta não tem perfil activo no CRM.'), true);
  });
  teste('"HTTP 504" NÃO é erro de autenticação (retenta)', () => {
    assert.strictEqual(ehAuth('HTTP 504'), false);
  });
  teste('"HTTP 502" NÃO é erro de autenticação (retenta)', () => {
    assert.strictEqual(ehAuth('HTTP 502'), false);
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 3. Contas a Receber — baixa idempotente por _tocoId
// ══════════════════════════════════════════════════════════════════════════
console.log('\n[3] tocoBaixarRecebidosPorTocoId — idempotente, sem inserir, sem reverter sozinho');
{
  const src = extrairFuncao('tocoBaixarRecebidosPorTocoId');

  function corre(TES_RECEBER, _tocoFatCache) {
    let pushCount = 0, saveCount = 0;
    const ctx = {
      TES_RECEBER, _tocoFatCache,
      tesSaveReceber: () => { saveCount++; },
      obSbPush: () => { pushCount++; },
      console,
    };
    vm.createContext(ctx);
    vm.runInContext(src + '\n_RESULT = tocoBaixarRecebidosPorTocoId();', ctx);
    return { resultado: ctx._RESULT, pushCount, saveCount, linhas: TES_RECEBER };
  }

  teste('linha com _tocoId e documento liquidado (PendingTotal=0) passa a Recebido', () => {
    const linhas = [{ id: 'A1', _tocoId: '111', estado: 'Não Recebido', total: 100, cliente: 'X' }];
    const cache = [{ Id: '111', PendingTotal: 0 }];
    const r = corre(linhas, cache);
    assert.strictEqual(r.resultado.atualizados, 1);
    assert.strictEqual(linhas[0].estado, 'Recebido');
  });

  teste('nunca insere linhas novas — array continua com o mesmo tamanho', () => {
    const linhas = [{ id: 'A1', _tocoId: '111', estado: 'Não Recebido', total: 100, cliente: 'X' }];
    const cache = [
      { Id: '111', PendingTotal: 0 },
      { Id: '999', PendingTotal: 0 }, // documento TOConline que NÃO existe em TES_RECEBER
    ];
    corre(linhas, cache);
    assert.strictEqual(linhas.length, 1, 'o documento 999 (sem correspondência local) não deve ter sido inserido');
  });

  teste('linha sem _tocoId nunca é tocada (sem identificador estável para decidir)', () => {
    const linhas = [{ id: 'SHEET-1', estado: 'Não Recebido', total: 50, cliente: 'Y' }];
    const cache = [{ Id: '111', PendingTotal: 0 }];
    const r = corre(linhas, cache);
    assert.strictEqual(r.resultado.atualizados, 0);
    assert.strictEqual(linhas[0].estado, 'Não Recebido');
  });

  teste('sem dado fiável (PendingTotal ausente) não decide nada — nunca assume', () => {
    const linhas = [{ id: 'A1', _tocoId: '111', estado: 'Não Recebido', total: 100, cliente: 'X' }];
    const cache = [{ Id: '111' /* sem PendingTotal */ }];
    const r = corre(linhas, cache);
    assert.strictEqual(r.resultado.atualizados, 0);
    assert.strictEqual(r.resultado.semDadoFiavel, 1);
    assert.strictEqual(linhas[0].estado, 'Não Recebido');
  });

  teste('documento com saldo pendente mas já marcado Recebido NUNCA é revertido sozinho — só fica em "revisar"', () => {
    const linhas = [{ id: 'A1', _tocoId: '111', estado: 'Recebido', total: 100, cliente: 'X' }];
    const cache = [{ Id: '111', PendingTotal: 50 }];
    const r = corre(linhas, cache);
    assert.strictEqual(r.resultado.atualizados, 0);
    assert.strictEqual(linhas[0].estado, 'Recebido', 'nunca deve reverter Recebido automaticamente');
    assert.strictEqual(r.resultado.revisar.length, 1);
  });

  teste('idempotente — correr duas vezes seguidas com o mesmo cache não muda nada na segunda', () => {
    const linhas = [{ id: 'A1', _tocoId: '111', estado: 'Não Recebido', total: 100, cliente: 'X' }];
    const cache = [{ Id: '111', PendingTotal: 0 }];
    const r1 = corre(linhas, cache);
    assert.strictEqual(r1.resultado.atualizados, 1);
    const r2 = corre(linhas, cache); // mesma linha, já 'Recebido' desta vez
    assert.strictEqual(r2.resultado.atualizados, 0, 'segunda corrida não deve voltar a contar como atualização');
    assert.strictEqual(linhas[0].estado, 'Recebido');
  });

  teste('só grava (tesSaveReceber/obSbPush) quando houve pelo menos 1 atualização real', () => {
    const linhas = [{ id: 'A1', _tocoId: '111', estado: 'Recebido', total: 100, cliente: 'X' }];
    const cache = [{ Id: '111', PendingTotal: 0 }]; // já estava correto — nada muda
    const r = corre(linhas, cache);
    assert.strictEqual(r.resultado.atualizados, 0);
    assert.strictEqual(r.saveCount, 0);
    assert.strictEqual(r.pushCount, 0);
  });
}

console.log('\n' + passou + ' ok, ' + falhou + ' falha(s)');
process.exit(falhou > 0 ? 1 : 0);
