// ═══════════════════════════════════════════════════════════════════
// GERAÇÃO DE PDF — Orçamento OpportunityBox
// Extraído do CRM principal (função orcPDF). Abre uma janela nova com o
// documento A4 formatado e dispara window.print() — o utilizador escolhe
// "Guardar como PDF" no diálogo de impressão do navegador.
// ═══════════════════════════════════════════════════════════════════

// Converte um valor monetário (0 a 999.999,99) para texto por extenso em português
function numeroPorExtenso(valor) {
  valor = Math.round((Number(valor) || 0) * 100) / 100;
  var inteiro = Math.floor(valor);
  var centimos = Math.round((valor - inteiro) * 100);

  var UNID = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
  var DEZ10A19 = ['dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezasseis', 'dezassete', 'dezoito', 'dezanove'];
  var DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  var CENTENAS = ['', 'cem', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

  function extensoCentena(n) {
    n = Math.floor(n);
    if (n === 0) return '';
    if (n === 100) return 'cem';
    var partes = [];
    var c = Math.floor(n / 100), r = n % 100;
    if (c > 0) partes.push(CENTENAS[c]);
    if (r > 0) {
      if (r < 10) partes.push(UNID[r]);
      else if (r < 20) partes.push(DEZ10A19[r - 10]);
      else {
        var d = Math.floor(r / 10), u = r % 10;
        partes.push(u > 0 ? (DEZENAS[d] + ' e ' + UNID[u]) : DEZENAS[d]);
      }
    }
    return partes.join(' e ');
  }

  function extensoInteiro(n) {
    n = Math.floor(n);
    if (n === 0) return 'zero';
    var milhares = Math.floor(n / 1000), resto = n % 1000;
    var partes = [];
    if (milhares > 0) {
      partes.push(milhares === 1 ? 'mil' : extensoCentena(milhares) + ' mil');
    }
    if (resto > 0) {
      partes.push(extensoCentena(resto));
    }
    var usaE = milhares > 0 && resto > 0 && resto < 100;
    return partes.join(usaE ? ' e ' : ' ');
  }

  var euros = extensoInteiro(inteiro);
  var txtEuros = euros + ' euro' + (inteiro === 1 ? '' : 's');
  if (centimos === 0) return ('(' + txtEuros.charAt(0).toUpperCase() + txtEuros.slice(1) + ')');
  var txtCentimos = extensoInteiro(centimos) + ' cêntimo' + (centimos === 1 ? '' : 's');
  var full = txtEuros + ' e ' + txtCentimos;
  return ('(' + full.charAt(0).toUpperCase() + full.slice(1) + ')');
}

function orcPDF() {
  const d = orcGetData();
  if (!d.cli) { alert('Preenche o cliente antes de gerar o PDF.'); return; }
  // Se não houver totais (ou o total vier a zero), recalcula a partir das linhas
  if (!d.totais || d.totais.total === 0) {
    let sub = 0;
    (d.linhas || []).forEach(l => { sub += (l.sub || l.subtotal || (l.qty * l.preco) || 0); });
    const descPct = d.totais?.descPct || 0;
    const ivaPct = d.totais?.ivaPct || 23;
    const descVal = sub * descPct / 100;
    const base = sub - descVal;
    const ivaVal = base * ivaPct / 100;
    const total = base + ivaVal;
    d.totais = { sub, descPct, descVal, ivaPct, ivaVal, total };
  }
  const E = OB_CONFIG.EMPRESA;
  const valFmt = d.val ? d.val.split('-').reverse().join('/') : '—';
  const linhasHTML = d.linhas.map((l, i) => `
    <tr>
      <td style="font-size:12px;color:#555;text-align:center">${i + 1}</td>
      <td><strong>${l.produto}</strong>${l.desc ? '<br><span style="font-size:11px;color:#888">' + l.desc + '</span>' : ''}</td>
      <td style="text-align:center">${l.qty}</td>
      <td style="text-align:right">€${orcFmt(l.preco)}</td>
      <td style="text-align:right;font-weight:600">€${orcFmt(l.sub)}</td>
    </tr>`).join('');

  const pdfHTML = `<!DOCTYPE html>
<html lang="pt">
<head>
<meta charset="UTF-8"/>
<title>Orçamento ${d.num} — OpportunityBox</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#222;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;counter-reset:page}
@page{size:A4;margin:15mm 15mm 20mm 15mm}
@media print{.no-print{display:none!important}body{padding:0}}
.header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:8px;border-bottom:3px solid #F5C400;margin-bottom:10px}
.logo-area{display:block}
.logo-area img,.logo-area svg{height:40px;max-height:50px;width:auto;display:block;object-fit:contain}
.co-info{text-align:right;font-size:11px;color:#555;line-height:1.4;white-space:nowrap}
.co-info strong{color:#222;font-size:11px;white-space:nowrap}
.co-info .nipc{color:#888;font-size:9px}
.doc-table{width:100%;border-collapse:collapse;margin-bottom:12px}
.doc-table th{background:#222;color:#F5C400;padding:5px 8px;font-size:10.5px;text-align:left;text-transform:uppercase;letter-spacing:.06em}
.doc-table td{padding:5px 8px;font-size:11.5px;border-bottom:1px solid #eee}
.title-block{text-align:center;margin:10px 0 12px}
.title-block h1{font-size:17px;font-weight:700;letter-spacing:.03em;color:#111;text-transform:uppercase}
.title-block .sub{font-size:12px;color:#555;margin-top:3px}
.section-label{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:4px}
.client-box{background:#f8f8f8;border-left:4px solid #F5C400;padding:7px 10px;margin-bottom:12px}
.client-box .name{font-size:13px;font-weight:700;color:#111}
.client-box .details{font-size:11px;color:#555;margin-top:2px}
.lines-table{width:100%;border-collapse:collapse;margin-bottom:10px}
.lines-table thead tr{background:#222}
.lines-table thead th{color:#fff;padding:6px 8px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.lines-table thead th:nth-child(3),.lines-table thead th:nth-child(4),.lines-table thead th:nth-child(5){text-align:right}
.lines-table thead th:nth-child(3){text-align:center}
.lines-table tbody tr:nth-child(even){background:#fafafa}
.lines-table tbody td{padding:5px 8px;font-size:11.5px;border-bottom:1px solid #eee;vertical-align:middle}
.lines-table tbody td:nth-child(3){text-align:center}
.lines-table tbody td:nth-child(4),.lines-table tbody td:nth-child(5){text-align:right}
.totais-block{margin-left:auto;width:260px}
.totais-row{display:flex;justify-content:space-between;padding:3px 0;font-size:11.5px;color:#555;border-bottom:1px dashed #eee}
.totais-row.total{border-bottom:none;border-top:2px solid #F5C400;padding-top:5px;margin-top:3px}
.totais-row.total .lbl{font-weight:700;font-size:13px;color:#111}
.totais-row.total .val{font-weight:700;font-size:16px;color:#111}
.totais-row.disc{color:#c0392b}
.notes-box{margin-top:10px;padding:7px 10px;background:#fffbea;border:1px solid #F5C400;border-radius:4px;font-size:10.5px;color:#555;line-height:1.45}
.footer{position:fixed;bottom:0;left:15mm;right:15mm;border-top:2px solid #F5C400;padding-top:6px;display:flex;justify-content:space-between;align-items:center;font-size:9.5px;color:#888}
.footer .brand{color:#F5C400;font-weight:700;font-size:10px;letter-spacing:.03em}
.footer .pagenum:after{content:counter(page)}
.ven-row{display:flex;gap:20px;margin-bottom:10px}
.ven-item{flex:1}
</style>
</head>
<body>

<div class="header">
  <div class="logo-area">
    <img src="${ORC_LOGO_B64}" alt="OpportunityBox" style="height:40px;width:auto;max-height:45px;object-fit:contain;"/>
  </div>
  <div class="co-info">
    <strong>${E.nome}</strong><br>
    <span class="nipc">${E.nipc}</span><br>
    ${E.morada}<br>
    ${E.site} | ${E.email}<br>
    Tel. ${E.tel}
  </div>
</div>

<table class="doc-table">
  <thead><tr>
    <th>DOCUMENTO</th><th>NÚMERO</th><th>DATA</th><th>VALIDADE</th><th>RESPONSÁVEL</th>
  </tr></thead>
  <tbody><tr>
    <td><strong>Orçamento</strong></td>
    <td><strong style="color:#000">${d.num}</strong></td>
    <td>${d.data}</td>
    <td>${valFmt}</td>
    <td>${d.vendedor}<br><span style="font-size:12px;color:#888">${d.email}</span></td>
  </tr></tbody>
</table>

<div class="title-block">
  <h1>Orçamento</h1>
  <div class="sub">Proposta Comercial — Ref. ${d.num}</div>
</div>

<div class="section-label">Dados do cliente</div>
<div class="client-box">
  <div class="name">${d.cli}</div>
  <div class="details">
    ${d.morada ? d.morada + '<br>' : ''}
    ${d.nif ? 'NIF: ' + d.nif + '<br>' : ''}${d.cliEmail ? '✉ ' + d.cliEmail + (d.cliWA ? '&nbsp;&nbsp;|&nbsp;&nbsp;' : '') : ''}${d.cliWA ? '📱 ' + d.cliWA : ''}
  </div>
</div>

<div class="section-label">Artigos e serviços</div>
<table class="lines-table">
  <thead>
    <tr><th>#</th><th>Artigo / Serviço</th><th>Qtd</th><th>Preço Unit.</th><th>Subtotal</th></tr>
  </thead>
  <tbody>${linhasHTML}</tbody>
</table>

<div class="totais-block">
  <div class="totais-row"><span class="lbl">Subtotal</span><span class="val">€${orcFmt(d.totais.sub)}</span></div>
  ${d.totais.descPct > 0 ? '<div class="totais-row disc"><span class="lbl">Desconto (' + d.totais.descPct + '%)</span><span class="val">-€' + orcFmt(d.totais.descVal) + '</span></div>' : ''}
  <div class="totais-row"><span class="lbl">IVA (${d.totais.ivaPct}%)</span><span class="val">€${orcFmt(d.totais.ivaVal)}</span></div>
  <div class="totais-row total"><span class="lbl">TOTAL</span><span class="val">€${orcFmt(d.totais.total)}</span></div>
  ${d.pagamento50 ? `
  <div class="totais-row"><span class="lbl">Sinal (50% adjudicação)</span><span class="val">€${orcFmt(d.sinal)}</span></div>
  <div class="totais-row"><span class="lbl">Saldo (50% entrega)</span><span class="val">€${orcFmt(d.saldo)}</span></div>` : ''}
</div>
<div style="font-size:11.5px;color:#888;text-align:right;margin:-8px 0 18px;font-style:italic">${numeroPorExtenso(d.totais.total)}</div>

<div class="notes-box">
  <strong>Condições:</strong> Orçamento válido até ${valFmt}. Prazo de entrega: <strong>${d.prazoEntrega || '25'} dias úteis</strong> após confirmação. ${d.prazo ? `Prazo de pagamento: <strong>${d.prazo}</strong>.` : 'Pagamento conforme condições negociadas.'} O presente orçamento não constitui compromisso de entrega até confirmação formal.
</div>

<div class="ven-row" style="margin-top:30px">
  <div class="ven-item" style="text-align:center">
    <div style="border-top:1px solid #888;margin-top:40px;padding-top:6px;font-size:12.5px;color:#222">
      <strong>${d.vendedor || 'Equipa OpportunityBox'}</strong><br>
      <span style="font-size:11px;color:#888">Responsável Comercial</span>
    </div>
  </div>
  <div class="ven-item" style="text-align:center">
    <div class="sign-box" style="border-top:1px solid #888;margin-top:40px;padding-top:6px;font-size:12.5px;color:#222">
      Assinatura do cliente
    </div>
  </div>
</div>

${d.imagemObra ? `
<div class="section-label" style="margin-top:14px">Imagem de Referência</div>
<div style="margin-bottom:10px">
  <img src="${d.imagemObra}" alt="Imagem de referência da obra" style="max-width:220px;max-height:220px;border-radius:6px;border:1px solid #ddd"/>
</div>` : ''}

<div class="footer">
  <div>
    Documento elaborado por computador, válido sem assinatura. · Tel. ${E.tel} · ${E.email} · ${E.nipc}<br>
    <span class="brand">${E.slogan}</span> · Pág. <span class="pagenum"></span>
  </div>
</div>

<script>
  window.onload = function(){
    setTimeout(function(){ window.print(); }, 400);
  };
<\/script>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) { alert('⚠️ O navegador bloqueou a janela do PDF. Permite popups para este site e tenta novamente.'); return; }
  win.document.write(pdfHTML);
  win.document.close();
}
