// ═══════════════════════════════════════════════════════════════════
// MÓDULO DE ORÇAMENTOS — OpportunityBox
// Extraído do CRM principal (ob-business-os-v2.html).
// As funções mantêm os MESMOS nomes e assinaturas do CRM para a
// integração de volta ser directa. Ver README.md e INTEGRACAO.md.
// ═══════════════════════════════════════════════════════════════════

// ── Constantes (iguais ao CRM principal) ───────────────────────────
var ORC_USER_EMAILS = {
  "Paulo Faria": "paulo@opportunitybox.pt",
  "Edna Faria": "edna@opportunitybox.pt",
  "Rui Mota": "rui@opportunitybox.pt",
  "Humberto Estrelinha": "humberto@opportunitybox.pt",
  "Filipa Santos": "filipa@opportunitybox.pt",
  "Andreia": "andreia@opportunitybox.pt",
  "Victor Horta": "victor@opportunitybox.pt"
};
var ORC_PRODUTOS = ["Letras Monobloco 3D", "Reclamo Luminoso LED", "Reclamo em Acrílico", "Totem", "Caixa de Luz", "Neon Flex", "Painel LED", "Sinalética", "Decoração Viatura", "Impressão Digital", "Vinil Decorativo", "Instalação", "Design", "Transporte", "Manutenção"];
var ESTADOS_ORC = ['Pendente', 'Em análise', 'Aprovado', 'Em Produção', 'Concluído', 'Faturado', 'Cancelado'];

// ── Utilizador actual (no CRM principal vem do login; aqui é simulado) ──
var CU = { name: localStorage.getItem('ob-orc-vendedor') || 'Equipa OpportunityBox', admin: true };

// ── Dados ───────────────────────────────────────────────────────────
// orcData: lista de orçamentos (mais recente primeiro — unshift ao guardar)
var orcData; try { orcData = JSON.parse(localStorage.getItem('ob-orcamentos') || '[]'); } catch (e) { orcData = []; }
// cliData: mini-lista de clientes usada no datalist e auto-preenchimento
var cliData; try { cliData = JSON.parse(localStorage.getItem('ob-clients') || '[]'); } catch (e) { cliData = []; }
function saveCliData() { localStorage.setItem('ob-clients', JSON.stringify(cliData)); }
function saveOrcData() { localStorage.setItem('ob-orcamentos', JSON.stringify(orcData.slice(0, 5000))); }

// Carregar orçamentos do Supabase ao iniciar (substitui localStorage se houver dados)
(async function _orcInitFromSB() {
  var sbData = await _sbOrcLoadAll();
  if (sbData && sbData.length > 0) {
    orcData = sbData;
    saveOrcData();
    if (typeof orcRenderList === 'function') orcRenderList();
  }
})();

// ── Formatação ──────────────────────────────────────────────────────
function orcFmt(n) {
  return new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function orcFmtEur(n) { return '€' + orcFmt(n); }

// ── Numeração ORC-AAAA-NNN ──────────────────────────────────────────
function orcNextNum() {
  const year = new Date().getFullYear();
  const saved = orcData.filter(o => o.num && o.num.includes('-' + year + '-'));
  // Usa o MAIOR número do ano (orcData guarda o mais recente primeiro via unshift)
  const last = saved.reduce((max, o) => Math.max(max, parseInt(o.num.split('-').pop()) || 0), 0);
  const next = String(last + 1).padStart(3, '0');
  return `ORC-${year}-${next}`;
}

// ── Clientes: auto-preenchimento e datalist ─────────────────────────
function orcAutoFillCliente(nome) {
  const c = cliData.find(x => (x.n || '').toLowerCase() === (nome || '').toLowerCase());
  if (!c) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el && !el.value) el.value = val || ''; };
  set('orc-morada', c.morada);
  set('orc-nif', c.nif);
  set('orc-email', c.email);
  set('orc-whatsapp', c.tel);
  const prazoEl = document.getElementById('orc-prazo');
  if (prazoEl && !prazoEl.value && c.prazo) prazoEl.value = c.prazo;
}

function orcRefreshDatalist() {
  const dl = document.getElementById('orc-clientes-list');
  if (!dl || !cliData) return;
  dl.innerHTML = cliData.map(c => `<option value="${c.n}"></option>`).join('');
}

// ── Modal Novo Cliente ──────────────────────────────────────────────
function orcNovoCliOpen() {
  ['oncli-nome', 'oncli-nif', 'oncli-morada', 'oncli-email', 'oncli-tel'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const m = document.getElementById('orc-novo-cli-modal');
  if (m) { m.style.display = 'flex'; setTimeout(() => { const n = document.getElementById('oncli-nome'); if (n) n.focus(); }, 50); }
}

function orcNovoCliClose() {
  const m = document.getElementById('orc-novo-cli-modal');
  if (m) m.style.display = 'none';
}

function orcNovoCliSave() {
  const nome = (document.getElementById('oncli-nome').value || '').trim();
  if (!nome) { alert('O nome do cliente é obrigatório.'); return; }
  const novo = {
    id: Date.now(),
    n: nome,
    sec: 'Outro',
    cont: nome,
    nif: (document.getElementById('oncli-nif').value || '').trim(),
    morada: (document.getElementById('oncli-morada').value || '').trim(),
    email: (document.getElementById('oncli-email').value || '').trim(),
    tel: (document.getElementById('oncli-tel').value || '').trim(),
    projs: 0, rev: 0, last: 'hoje', st: 'active'
  };
  cliData.unshift(novo);
  saveCliData();
  orcRefreshDatalist();
  const orcCli = document.getElementById('orc-cliente');
  if (orcCli) { orcCli.value = nome; }
  orcAutoFillCliente(nome);
  orcNovoCliClose();
}

// ── Inicialização da página ─────────────────────────────────────────
function orcInitPage() {
  orcRefreshDatalist();
  // Validade: 30 dias a partir de hoje
  const val = document.getElementById('orc-validade');
  if (val && !val.value) {
    const d = new Date(); d.setDate(d.getDate() + 30);
    val.value = d.toISOString().split('T')[0];
  }
  // Número
  const badge = document.getElementById('orc-num-badge');
  if (badge) badge.textContent = orcNextNum();
  // Renderizar lista
  orcRenderList();
  // 2 linhas iniciais
  const cont = document.getElementById('orc-lines-container');
  if (cont && cont.children.length === 0) {
    orcAddLine(); orcAddLine();
  }
  orcCalcTotal();
}

// ── Linhas de produto ───────────────────────────────────────────────
function orcAddLine() {
  const cont = document.getElementById('orc-lines-container');
  if (!cont) return;
  const opts = ORC_PRODUTOS.map(p => `<option value="${p}">${p}</option>`).join('');
  const id = Date.now();
  const div = document.createElement('div');
  div.className = 'orc-line';
  div.innerHTML = `
    <select class="form-select" id="sel-${id}">${opts}</select>
    <input class="form-input" placeholder="Descrição/obs" id="desc-${id}"/>
    <input class="form-input" type="number" value="1" min="1" id="qty-${id}" oninput="orcCalcTotal()"/>
    <input class="form-input" type="number" value="0" min="0" id="preco-${id}" oninput="orcCalcTotal()"/>
    <div class="sub-val" id="sub-${id}">€0,00</div>
    <button class="del-btn" onclick="this.closest('.orc-line').remove();orcCalcTotal()">×</button>`;
  cont.appendChild(div);
  orcCalcTotal();
}

function orcCalcTotal() {
  const lines = document.querySelectorAll('#orc-lines-container .orc-line');
  let sub = 0;
  lines.forEach(l => {
    const qty = parseFloat(l.querySelector('[id^=qty-]')?.value) || 1;
    const preco = parseFloat(l.querySelector('[id^=preco-]')?.value) || 0;
    const ls = qty * preco;
    sub += ls;
    const sv = l.querySelector('[id^=sub-]');
    if (sv) sv.textContent = orcFmtEur(ls);
  });
  const descPct = parseFloat(document.getElementById('orc-desconto')?.value) || 0;
  const ivaPct = parseFloat(document.getElementById('orc-iva')?.value) || 23;
  const descVal = sub * descPct / 100;
  const base = sub - descVal;
  const ivaVal = base * ivaPct / 100;
  const total = base + ivaVal;

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('orc-subtotal', orcFmtEur(sub));
  set('orc-desconto-val', '-' + orcFmtEur(descVal));
  set('orc-iva-val', orcFmtEur(ivaVal));
  set('orc-iva-pct', ivaPct);
  set('orc-total-val', orcFmtEur(total));
  const dr = document.getElementById('orc-desconto-row');
  if (dr) dr.style.display = descPct > 0 ? 'flex' : 'none';
  return { sub, descPct, descVal, ivaPct, ivaVal, total };
}

function orcGetLinhas() {
  const lines = document.querySelectorAll('#orc-lines-container .orc-line');
  return Array.from(lines).map(l => {
    const sel = l.querySelector('[id^=sel-]');
    const desc = l.querySelector('[id^=desc-]');
    const qty = parseFloat(l.querySelector('[id^=qty-]')?.value) || 1;
    const preco = parseFloat(l.querySelector('[id^=preco-]')?.value) || 0;
    return { produto: sel?.value || '', desc: desc?.value || '', qty, preco, sub: qty * preco };
  }).filter(l => l.sub > 0 || l.produto);
}

// ── Recolha de dados do formulário ──────────────────────────────────
function orcGetData() {
  const num = document.getElementById('orc-num-badge')?.textContent || orcNextNum();
  const cli = document.getElementById('orc-cliente')?.value || '';
  const prazo = document.getElementById('orc-prazo')?.value || '';
  const prazoEntrega = document.getElementById('orc-prazo-entrega')?.value || '25';
  const morada = document.getElementById('orc-morada')?.value || '';
  const nif = document.getElementById('orc-nif')?.value || '';
  const cliEmail = document.getElementById('orc-email')?.value || '';
  const cliWA = document.getElementById('orc-whatsapp')?.value || '';
  const val = document.getElementById('orc-validade')?.value || '';
  const linhas = orcGetLinhas();
  const totais = orcCalcTotal();
  const vendedor = (typeof CU !== 'undefined' && CU) ? CU.name : 'Equipa OpportunityBox';
  const email = ORC_USER_EMAILS[vendedor] || 'geral@opportunitybox.pt';
  // Condições de pagamento 50% adjudicação + 50% entrega — calcula sinal/saldo
  const pagamento50 = prazo === '50% adjudicação + 50% entrega';
  const sinal = pagamento50 ? Math.round(totais.total * 50) / 100 : null;
  const saldo = pagamento50 ? Math.round((totais.total - sinal) * 100) / 100 : null;
  const imagem = window._orcImagemAtual || null;
  return {
    num, cli, prazo, prazoEntrega, morada, nif, val, linhas, totais, vendedor, email,
    cliEmail, cliWA, pagamento50, sinal, saldo, imagem, imagemObra: imagem,
    data: new Date().toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' })
  };
}

// ── Imagem da obra (upload manual, base64) ──────────────────────────
window._orcImagemAtual = window._orcImagemAtual || null;
function orcSetImagemPreview(dataUrl) {
  window._orcImagemAtual = dataUrl || null;
  const el = document.getElementById('orc-imagem-preview');
  if (!el) return;
  el.innerHTML = dataUrl
    ? `<img src="${dataUrl}" alt="Imagem do orçamento" style="max-width:160px;max-height:160px;border-radius:6px;border:1px solid var(--border)"/>`
    : 'Nenhuma imagem associada a este orçamento.';
}

function orcImagemObraUpload(input) {
  const file = input && input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) { orcSetImagemPreview(e.target.result); };
  reader.readAsDataURL(file);
}

// ── Guardar / Novo ──────────────────────────────────────────────────
function orcGuardar() {
  const d = orcGetData();
  if (!d.cli.trim()) { alert('Por favor preenche o nome do cliente.'); return; }
  if (!d.linhas.length) { alert('Adiciona pelo menos uma linha de produto.'); return; }
  d.dt = d.data; d.st = 'Pendente'; d.stc = 'ba';
  orcData.unshift(d);
  saveOrcData();
  _sbOrcUpsert(d);
  orcRenderList();
  const badge = document.getElementById('orc-num-badge');
  if (badge) badge.textContent = orcNextNum();
  const msg = document.getElementById('orc-save-msg');
  if (msg) { msg.textContent = '✓ Orçamento ' + d.num + ' guardado com sucesso'; msg.style.display = 'block'; setTimeout(() => msg.style.display = 'none', 3000); }
}

function orcNew() {
  const cont = document.getElementById('orc-lines-container');
  if (cont) cont.innerHTML = '';
  const inputs = ['orc-cliente', 'orc-morada', 'orc-nif', 'orc-email', 'orc-whatsapp', 'orc-prazo'];
  inputs.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const desc = document.getElementById('orc-desconto'); if (desc) desc.value = '0';
  const badge = document.getElementById('orc-num-badge');
  if (badge) badge.textContent = orcNextNum();
  const d = new Date(); d.setDate(d.getDate() + 30);
  const val = document.getElementById('orc-validade');
  if (val) val.value = d.toISOString().split('T')[0];
  orcAddLine(); orcAddLine(); orcCalcTotal();
  orcSetImagemPreview(null);
}

// ── Envio: WhatsApp e Email ─────────────────────────────────────────
function orcWhatsApp() {
  const d = orcGetData();
  if (!d.cli) { alert('Preenche o cliente.'); return; }
  if (!d.totais.total) { alert('⚠️ O orçamento ainda não tem valor definido.'); return; }
  const linhas = d.linhas.map(l => `  • ${l.produto}${l.desc ? ' (' + l.desc + ')' : ''} x${l.qty} = €${orcFmt(l.sub)}`).join('\n');
  const msgTexto = [
    '*Orçamento OpportunityBox*',
    `Nº *${d.num}* — válido até ${d.val.split('-').reverse().join('/')}`,
    '',
    `Cliente: *${d.cli}*`,
    '',
    '*Artigos:*',
    linhas,
    '',
    d.totais.descPct > 0 ? `Desconto: ${d.totais.descPct}% (-€${orcFmt(d.totais.descVal)})` : '',
    `IVA ${d.totais.ivaPct}%: €${orcFmt(d.totais.ivaVal)}`,
    `*TOTAL: €${orcFmt(d.totais.total)}*`,
    '',
    'Para confirmar, responda a esta mensagem ou contacte-nos:',
    'Tel: ' + OB_CONFIG.EMPRESA.tel + ' | ' + OB_CONFIG.EMPRESA.email
  ].filter(Boolean).join('\n');
  const tel = (d.cliWA || '').replace(/[^0-9]/g, '');
  const base = tel ? ('https://wa.me/' + tel) : 'https://wa.me/';
  window.open(base + '?text=' + encodeURIComponent(msgTexto), '_blank');
}

function orcEmail() {
  const d = orcGetData();
  if (!d.cli) { alert('Preenche o cliente.'); return; }
  if (!d.totais.total) { alert('⚠️ O orçamento ainda não tem valor definido.'); return; }
  const linhas = d.linhas.map(l => `  • ${l.produto}${l.desc ? ' (' + l.desc + ')' : ''} x${l.qty} = €${orcFmt(l.sub)}`).join('\n');
  const subject = encodeURIComponent(`Orçamento ${d.num} — OpportunityBox`);
  const body = encodeURIComponent([
    `Exmo(a) Sr(a).,`,
    ``,
    `Conforme combinado, enviamos em anexo o orçamento ${d.num}.`,
    ``,
    `Cliente: ${d.cli}`,
    `Validade: ${d.val.split('-').reverse().join('/')}`,
    ``,
    `Artigos:`,
    linhas,
    ``,
    d.totais.descPct > 0 ? `Desconto (${d.totais.descPct}%): -€${orcFmt(d.totais.descVal)}` : '',
    `IVA (${d.totais.ivaPct}%): €${orcFmt(d.totais.ivaVal)}`,
    `TOTAL: €${orcFmt(d.totais.total)}`,
    ``,
    `Para confirmar, basta responder a este email.`,
    ``,
    `Com os melhores cumprimentos,`,
    `${d.vendedor}`,
    `${d.email}`,
    `OpportunityBox — ${OB_CONFIG.EMPRESA.slogan}`,
    `Tel: ${OB_CONFIG.EMPRESA.tel} | ${OB_CONFIG.EMPRESA.site}`,
  ].filter(l => l !== null && l !== undefined).join('\n'));
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
}

// ── Estado do orçamento ─────────────────────────────────────────────
// Versão simplificada do CRM principal: no CRM completo esta função também
// faz baixa de stock, envia para ClickUp e gera ficha técnica. Aqui apenas
// muda o estado, regista a aprovação e persiste.
function orcChangeStatus(orcId, novoEstado) {
  var orc = orcData.find(function(o) { return o.num === orcId; });
  if (!orc) return;
  var estadoAnterior = orc.st;
  orc.st = novoEstado;
  orc.stc = novoEstado === 'Aprovado' ? 'g' : novoEstado === 'Em Produção' ? 'b' : novoEstado === 'Concluído' ? 'g2' : 'ba';
  if (novoEstado === 'Em Produção' && !orc.dtProducao) {
    orc.dtProducao = new Date().toLocaleDateString('pt-PT');
  }
  if (novoEstado === 'Aprovado' && estadoAnterior !== 'Aprovado') {
    orc.aprovado_em = new Date().toLocaleDateString('pt-PT');
    orc.aprovado_por = (typeof CU !== 'undefined' && CU) ? CU.name : 'Equipa OpportunityBox';
  }
  saveOrcData();
  _sbOrcUpsert(orc);
  orcRenderList();
}

// ── Filtros, KPIs, paginação e lista ────────────────────────────────
var ORC_FILTERS = { search: '', estado: '', vendedor: '', data: '' };
var ORC_PAGE = 1;
var ORC_PAGE_SIZE = 20;

function orcGetValorTotal(o) { return o.totais && typeof o.totais.total === 'number' ? o.totais.total : (typeof o.val === 'number' ? o.val : 0); }

function orcFiltrarLista() {
  var search = (ORC_FILTERS.search || '').trim().toLowerCase();
  return (orcData || []).filter(function(o) {
    if (search && !((o.cli || '').toLowerCase().includes(search) || (o.num || '').toLowerCase().includes(search))) return false;
    if (ORC_FILTERS.estado && o.st !== ORC_FILTERS.estado) return false;
    if (ORC_FILTERS.vendedor && o.vendedor !== ORC_FILTERS.vendedor) return false;
    if (ORC_FILTERS.data) {
      var dt = o.dt || o.data || '';
      var iso = orcDataParaIso(dt);
      if (iso !== ORC_FILTERS.data) return false;
    }
    return true;
  });
}

function orcDataParaIso(dt) {
  if (!dt) return '';
  var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dt);
  if (m) return m[3] + '-' + m[2] + '-' + m[1];
  return dt;
}

function orcAtualizarKPIs(lista) {
  var total = lista.length;
  var aprovados = lista.filter(function(o) { return o.st === 'Aprovado'; });
  var pendentes = lista.filter(function(o) { return o.st === 'Pendente'; });
  var faturados = lista.filter(function(o) { return o.st === 'Faturado'; });
  var valorAprovados = aprovados.reduce(function(s, o) { return s + orcGetValorTotal(o); }, 0);
  var setTxt = function(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
  setTxt('orc-kpi-total', total);
  setTxt('orc-kpi-aprovados', aprovados.length);
  setTxt('orc-kpi-aprovados-val', orcFmt(valorAprovados));
  setTxt('orc-kpi-pendentes', pendentes.length);
  setTxt('orc-kpi-faturados', faturados.length);
}

function orcPopularVendedores() {
  var sel = document.getElementById('orc-filtro-vendedor');
  if (!sel) return;
  var vendedores = Array.from(new Set((orcData || []).map(function(o) { return o.vendedor; }).filter(Boolean))).sort();
  var atual = sel.value;
  sel.innerHTML = '<option value="">— Todos os vendedores —</option>' + vendedores.map(function(v) { return '<option value="' + v + '">' + v + '</option>'; }).join('');
  sel.value = atual;
}

function orcApplyFilters() {
  var busca = document.getElementById('orc-filtro-busca');
  var estado = document.getElementById('orc-filtro-estado');
  var vendedor = document.getElementById('orc-filtro-vendedor');
  var data = document.getElementById('orc-filtro-data');
  ORC_FILTERS.search = busca ? busca.value : '';
  ORC_FILTERS.estado = estado ? estado.value : '';
  ORC_FILTERS.vendedor = vendedor ? vendedor.value : '';
  ORC_FILTERS.data = data ? data.value : '';
  ORC_PAGE = 1;
  orcRenderList();
}

function orcLimparFiltros() {
  ORC_FILTERS = { search: '', estado: '', vendedor: '', data: '' };
  var busca = document.getElementById('orc-filtro-busca'); if (busca) busca.value = '';
  var estado = document.getElementById('orc-filtro-estado'); if (estado) estado.value = '';
  var vendedor = document.getElementById('orc-filtro-vendedor'); if (vendedor) vendedor.value = '';
  var data = document.getElementById('orc-filtro-data'); if (data) data.value = '';
  ORC_PAGE = 1;
  orcRenderList();
}

function orcExportarCSV() {
  var lista = orcFiltrarLista();
  var linhas = [['Nº', 'Cliente', 'Valor', 'Vendedor', 'Estado', 'Data']];
  lista.forEach(function(o) {
    linhas.push([o.num, o.cli, orcGetValorTotal(o).toFixed(2), o.vendedor || '', o.st || '', o.dt || o.data || '']);
  });
  var csv = linhas.map(function(l) {
    return l.map(function(v) { var s = String(v == null ? '' : v); return '"' + s.replace(/"/g, '""') + '"'; }).join(';');
  }).join('\n');
  var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'orcamentos.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function orcTooltipLinhas(o) {
  if (!o.linhas || !o.linhas.length) return '';
  return o.linhas.map(function(l) { return (l.desc || l.descricao || 'item'); }).join(', ');
}

function orcRenderList() {
  const el = document.getElementById('orc-tbody');
  if (!el) return;
  orcPopularVendedores();
  var filtrados = orcFiltrarLista();
  orcAtualizarKPIs(filtrados);
  // Ordenar por data, mais recente primeiro
  filtrados = filtrados.slice().sort(function(a, b) {
    var da = orcDataParaIso(a.dt || a.data || ''); var db = orcDataParaIso(b.dt || b.data || '');
    return db.localeCompare(da);
  });
  var totalPaginas = Math.max(1, Math.ceil(filtrados.length / ORC_PAGE_SIZE));
  if (ORC_PAGE > totalPaginas) ORC_PAGE = totalPaginas;
  var inicio = (ORC_PAGE - 1) * ORC_PAGE_SIZE;
  var all = filtrados.slice(inicio, inicio + ORC_PAGE_SIZE);
  var infoEl = document.getElementById('orc-pag-info');
  if (infoEl) infoEl.textContent = 'Página ' + ORC_PAGE + ' de ' + totalPaginas + ' (' + filtrados.length + ' orçamentos)';
  var prevBtn = document.getElementById('orc-pag-prev'); if (prevBtn) prevBtn.disabled = ORC_PAGE <= 1;
  var nextBtn = document.getElementById('orc-pag-next'); if (nextBtn) nextBtn.disabled = ORC_PAGE >= totalPaginas;
  el.innerHTML = all.map(function(o) {
    var destacar = (o.st === 'Aprovado' || o.st === 'Em Produção' || o.st === 'Em Producao');
    var rowStyle = destacar ? 'border-left:3px solid ' + (o.st === 'Aprovado' ? 'var(--g)' : '#4d94db') : '';
    var tooltip = orcTooltipLinhas(o);
    return `<tr style="${rowStyle}">
    <td style="font-family:'DM Mono',monospace;font-size:13px" ${tooltip ? `title="${tooltip.replace(/"/g, '&quot;')}"` : ''}>${o.num}</td>
    <td><strong style="color:var(--txt2)">${o.cli}</strong>${o.aprovado_em ? `<div style="font-size:10.5px;color:var(--g);margin-top:2px">✓ Aprovado por ${o.aprovado_por || '—'} em ${o.aprovado_em}</div>` : ''}</td>
    <td style="font-family:'DM Mono',monospace;color:var(--y)">€${orcFmt(orcGetValorTotal(o))}</td>
    <td style="font-size:13px;color:var(--muted)">${o.vendedor || '—'}</td>
    <td>
      <select onchange="orcChangeStatus('${o.num}',this.value)" style="background:var(--bg3);border:1px solid var(--border);border-radius:5px;color:var(--txt2);font-size:12px;padding:2px 5px;cursor:pointer;font-family:'Inter',sans-serif">
        ${ESTADOS_ORC.map(e => `<option value="${e}" ${e === o.st ? 'selected' : ''}>${e}</option>`).join('')}
      </select>
    </td>
    <td style="color:var(--muted);font-size:13px">${o.dt || o.data || '—'}</td>
  </tr>`; }).join('');
}

// ── Ligação dos filtros e arranque ──────────────────────────────────
(function orcWireFiltros() {
  function wire() {
    var ids = ['orc-filtro-busca', 'orc-filtro-estado', 'orc-filtro-vendedor', 'orc-filtro-data'];
    ids.forEach(function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      var evt = (id === 'orc-filtro-busca') ? 'input' : 'change';
      el.addEventListener(evt, orcApplyFilters);
    });
    var limpar = document.getElementById('orc-filtro-limpar');
    if (limpar) limpar.addEventListener('click', orcLimparFiltros);
    var csv = document.getElementById('orc-exportar-csv');
    if (csv) csv.addEventListener('click', orcExportarCSV);
    var prev = document.getElementById('orc-pag-prev');
    if (prev) prev.addEventListener('click', function() { if (ORC_PAGE > 1) { ORC_PAGE--; orcRenderList(); } });
    var next = document.getElementById('orc-pag-next');
    if (next) next.addEventListener('click', function() { ORC_PAGE++; orcRenderList(); });
    orcInitPage();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
