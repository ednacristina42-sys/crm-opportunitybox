# Backup pré-reconstrução de segurança — 2026-07-27

Este diretório é a Fase 1 (contenção) da auditoria de segurança/permissões pedida em
2026-07-27: cópia completa dos dados e da estrutura do Supabase **antes** de qualquer
alteração de autenticação, esquema ou políticas RLS.

Projeto Supabase: `ddzlbmnmsdyodouqxbjx` ("https-equipaopportunitybox.pt").

## Conteúdo

- `schema_public_tables.json` — estrutura de todas as tabelas do schema `public`
  (colunas, tipos, chaves primárias/estrangeiras) e contagem de linhas no momento do backup.
- `rls_policies.json` — todas as políticas RLS existentes em cada tabela. Confirma o
  achado da auditoria: RLS está "ligada" em todas as tabelas, mas quase todas as
  políticas são `USING (true)` / `WITH CHECK (true)`, ou seja, sem isolamento real.
- `functions.sql` — definição de todas as funções do schema `public`
  (`isp_get_tenant_id`, `isp_is_tenant_member`, `user_company`, `isp_handle_new_user`,
  `set_updated_at`) — infraestrutura de multi-tenant já existente mas não aplicada às
  tabelas reais do CRM.
- `data/*.json` — conteúdo integral de todas as tabelas que tinham dados:
  - `ob_orcamentos.json` — 577 orçamentos/propostas
  - `ob_crm_dados.json` — os 16 blocos JSON (clientes, leads, histórico, tesouraria —
    incl. `ob-tes-receber` com 345 registos —, faturas, etc.)
  - `ob_stock.json` — 4 itens de stock
  - `ob_uni_items.json` — 25 itens do kanban "Universal" (fábrica/design/admin)
  - `ob_despesas.json` — 1 despesa
  - `isp_profiles.json` — 2 perfis do módulo "Equipa em Campo"
  - `auth_users_metadata.json` — metadados (sem passwords/hashes) das 3 contas reais
    existentes no Supabase Auth deste projeto

Todas as restantes tabelas do schema `public` estavam vazias (0 linhas) no momento do
backup — a estrutura delas está documentada em `schema_public_tables.json`.

## O que este backup NÃO substitui

Isto é um export lógico (JSON), não um `pg_dump` binário do Postgres. Para uma
recuperação completa em caso de desastre, o Supabase mantém os seus próprios backups
automáticos (Point-in-Time Recovery, conforme o plano do projeto) — este diretório serve
para termos uma cópia legível e versionada no Git, e para validar totais durante a
migração da Fase 3 (comparar contagens/somas antes e depois de normalizar os blocos
`ob_crm_dados` em tabelas reais).

## Estado no momento deste backup

- Login do CRM principal: sem autenticação real (ver auditoria de segurança na conversa).
- RLS: ativa mas permissiva em todas as tabelas do CRM.
- Chaves expostas no `index.html`: apenas chaves `anon` (públicas por natureza); nenhuma
  `service_role` encontrada.
