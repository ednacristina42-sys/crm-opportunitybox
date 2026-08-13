# Consolidação da base de Clientes — 14/08/2026

Registo desta operação, feita diretamente no Supabase (não é uma alteração de
código — `index.html` não foi tocado nesta consolidação).

## O que foi feito

Base `ob_crm_dados['ob-clients']` (30 registos de teste antigos, confirmados
pela Edna como não-oficiais) substituída por uma base consolidada de 1.749
clientes, construída a partir de:

- **Base histórica:** `ob-clients-backup-20260810b` (1.738 clientes,
  campos ricos: NIF, comercial responsável, totais, histórico de relação).
- **Fonte cadastral atual:** Google Sheets, aba "Dados clientes"
  (gid 1567654062) — 1.262 clientes, lido diretamente do ficheiro XLSX
  (não do resumo em texto, para evitar mistura entre abas).

## Regras aplicadas

- Correspondência prioritária por NIF (nunca por nome sozinho quando há NIF).
- 98 telefones corrigidos pelo Sheet (o backup tinha um "0" a mais no final,
  em quase todos os casos — padrão sistemático, não 98 decisões separadas).
- 11 clientes novos importados do Sheet (NIF que não existia no backup).
- Todos os campos ricos do backup preservados integralmente (comercialResp,
  comercialAtivo, totais, histórico) — o Sheet não alimenta estes campos.
- 22 candidatos de correspondência só por nome (backup sem NIF) — **não
  fundidos automaticamente**, ficam pendentes de revisão manual.
- 0 clientes históricos apagados.

## Backups de segurança criados (Supabase, chave `ob_crm_dados`)

- `ob-clients-backup-20260814-pre-consolidacao` — cópia do estado anterior
  (os 30 registos de teste).
- `ob-clients-consolidado-20260814-preview` — cópia da base consolidada,
  igual ao que ficou em `ob-clients`.

## Validado

- 1.749 clientes na base final, 0 NIFs duplicados indevidos.
- CRM testado localmente com estes dados: lista renderiza os 1.749, cliente
  histórico e cliente novo aparecem, Card Cliente abre sem erro.
- Busca global: confirma-se que só pesquisa por nome — não pesquisa por
  NIF/email/telefone. Não é uma regressão desta consolidação, é uma
  limitação já existente no código (`globalSearch()`), fica registada aqui
  para decisão futura.

Não houve alteração de tabelas, migrations, Auth, RLS, `main` nem Netlify.
