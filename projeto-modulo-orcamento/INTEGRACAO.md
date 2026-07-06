# Guia de Integração — devolver o trabalho ao CRM principal

Este documento é para a Opportunity Box (não para o freelancer): explica como
integrar as alterações feitas neste módulo de volta no CRM principal
(`ob-business-os-v2.html`, ficheiro único de ~22.000 linhas).

## Correspondência entre este módulo e o CRM principal

| Ficheiro do módulo   | Onde vive no ob-business-os-v2.html                          |
|----------------------|--------------------------------------------------------------|
| `index.html`         | `<div id="page-comercial-orcamentos">` (HTML da página)      |
| `js/orcamentos.js`   | Bloco "ORÇAMENTOS — completo e funcional" (funções `orc*`)   |
| `js/pdf.js`          | Funções `orcPDF()` e `numeroPorExtenso()`                    |
| `js/supabase.js`     | Funções `_sbOrcUpsert()` / `_sbOrcLoadAll()`                 |
| `js/logo.js`         | Variável `ORC_LOGO_B64`                                      |
| `css/estilo.css`     | Variáveis `:root` e classes partilhadas do CRM               |

## O que foi propositadamente DEIXADO DE FORA do módulo

Estas partes existem na página de Orçamentos do CRM principal mas dependem de
outras áreas do CRM (stock, produção, integrações) e **não** fazem parte do
âmbito do freelancer:

- Composição do Reclamo / materiais do stock (`orcAddMaterial`, `orcRecalcMateriais`, markup)
- Mão de Obra & Produção (`moAdicionarLinha`, `orcMaoObraCalc`)
- Logística & Deslocação (`orcLogisticaCalc`, `orcLogisticaTipoChange`)
- Copiloto IA (análise de imagem, geração de imagem, chat)
- Faturas + TocOnline (`fat*`, `toco*`)
- Webhooks ClickUp / Aprovação (`orcEnviarClickUp`, `orcSolicitarAprovacao`)
- Baixa de stock e ficha técnica dentro de `orcChangeStatus`
- Importação de planilha/Excel
- Pré-preenchimento a partir de leads (`orcFromLead`, sessionStorage)

Se o trabalho do freelancer tocar em algo desta lista, é sinal de que saiu do
âmbito — rever antes de aceitar.

## Passos para integrar uma alteração

1. **Rever o Pull Request** do freelancer neste repositório. Confirmar que:
   - nomes de funções, IDs de HTML e formato de dados não mudaram (regras do README)
   - não entraram chaves de API nem dependências novas
2. **Testar o módulo isolado**: abrir o `index.html`, criar orçamento, mudar
   estados, gerar PDF, exportar CSV.
3. **Transpor as alterações** para o `ob-business-os-v2.html`:
   - Alterações em `js/orcamentos.js` ou `js/pdf.js` → localizar a função com
     o mesmo nome no ficheiro principal (pesquisar `function nomeDaFuncao`)
     e substituir o corpo pela versão nova.
   - Alterações no `index.html` → localizar o elemento pelo mesmo `id` dentro
     de `<div id="page-comercial-orcamentos">` e aplicar a mesma alteração.
   - Funções/elementos NOVOS → colar junto do bloco de orçamentos existente
     (funções perto de `orcRenderList`, HTML dentro da página de orçamentos).
   - CSS novo → juntar ao `<style>` principal, usando as variáveis `:root`
     já existentes.
4. **Atenção às diferenças de contexto** no CRM principal:
   - `CU` vem do login real (não do stub do módulo)
   - `cliData`/`saveCliData` são o registo completo de clientes do CRM
   - `orcChangeStatus` no CRM faz também baixa de stock, ClickUp e ficha
     técnica — se o freelancer alterou esta função, aplicar a alteração apenas
     à parte comum (estado + persistência + render)
   - a lista do CRM tem colunas extra (Ficha, TocOnline/Fatura) que aqui não existem
   - `_sbOrcUpsert` no CRM envia campos extra (materiais, mo_linhas, logistica,
     markup, imagem) — manter esses campos
5. **Testar no CRM** (localmente, abrindo o `ob-business-os-v2.html`): criar
   orçamento, aprovar, gerar PDF, verificar lista e Supabase.
6. **Commit + push para `main`** do repositório `crm-opportunitybox` — o
   Netlify faz deploy automático.

## Dica

Pedir ao freelancer que descreva no Pull Request **exactamente que funções e
IDs alterou** — com essa lista, a transposição para o ficheiro principal é
mecânica e rápida.
