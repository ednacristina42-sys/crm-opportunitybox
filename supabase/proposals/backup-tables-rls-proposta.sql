-- ============================================================
-- Remediação RLS de tabelas de backup expostas + cobertura
-- explícita das chaves "orfãs" em public.ob_crm_dados.
-- PROPOSTA, NAO APLICADA.
--
-- Contexto (investigação de 2026-09-10):
--
-- 1) public.ob_crm_dados tem RLS ativo e 16 policies (aplicadas em
--    20260805105524_ob_crm_dados_rls_remediacao +
--    20260810145529_allow_anon_crm_sync_leads_pipeline), mas a
--    tabela guarda hoje 32 linhas (uma por `chave`) e só 16 dessas
--    chaves estão cobertas por alguma policy:
--
--      cobertas (16): ob-leads, ob-clients, ob-crm-atividades,
--      ob-crm-historico, ob-faturas, ob-fin-despesas, ob-iva-dados,
--      ob-tes-cartoes, ob-tes-contas, ob-tes-log, ob-tes-receber,
--      ob-rh-colabs, ob-rh-ferias-cfg, ob-rh-turnos, ob-fo-ausencias,
--      ob-uni-items
--
--      NAO cobertas (16): ob-clients-backup-20260810,
--      ob-clients-backup-20260810b,
--      ob-clients-backup-20260814-pre-consolidacao,
--      ob-clients-backup-20260814-pre-restauracao,
--      ob-clients-backup-20260902-pre-enriquecimento,
--      ob-clients-backup-20260902-pre-promocao,
--      ob-clients-backup-20260902-pre-toconline,
--      ob-clients-consolidado-20260814-preview,
--      ob-tes-receber-backup-20260903-pre-sheet-sync,
--      toc-finance-audit-credit_notes, toc-finance-audit-invoices,
--      toc-finance-audit-invoices-checkpoint,
--      toc-finance-audit-receipts, toc-oauth, toc-snapshot,
--      toc-sync-estado
--
--    Confirmado por grep em index.html: NENHUMA destas 16 chaves é
--    lida/escrita pelo frontend (nem por 'anon' nem por
--    'authenticated'). Só aparecem escritas por scripts fora do
--    browser que usam a service_role key (backups/consolidações
--    manuais datadas de 10/08, 13-14/08 e 02-03/09; sincronização
--    TOConline em crm-toconline-*.ts). service_role ignora RLS, por
--    isso essas escritas sempre tiveram sucesso, RLS ligado ou não.
--
--    Resultado prático hoje: para 'anon'/'authenticated' (app real),
--    estas 16 linhas já estão implicitamente NEGADAS em todas as
--    operações (SELECT/INSERT/UPDATE), porque nenhuma policy as
--    menciona e RLS é "deny by default". Isto está correto, mas é
--    IMPLÍCITO — não há nenhuma policy que documente a intenção, o
--    que dificulta auditoria (alguém a ler só pg_policies não sabe
--    se foi esquecido ou decidido). A secção 2 abaixo torna essa
--    decisão explícita, no mesmo padrão já usado para 'ob-uni-items'
--    (select-only, admin).
--
-- 2) Achado mais crítico, tabelas separadas (não linhas de
--    ob_crm_dados): 5 tabelas físicas de backup têm RLS
--    COMPLETAMENTE DESLIGADO, reportado pelo advisor de segurança
--    do Supabase — expostas por inteiro à anon key (leitura E
--    escrita por qualquer pessoa com a chave pública):
--
--      ob_orcamentos_bkp_20260808           577 linhas
--      ob_orcamentos_backup_20260901        722 linhas
--      ob_uni_items_backup_20260811          25 linhas
--      ob_uni_atividades_backup_20260811      0 linhas
--      ob_crm_dados_backup_20260901          21 linhas
--
--    Isto é diferente do ponto 1: aqui não há RLS nenhum, não é
--    "faltam policies" — é "a tabela inteira está aberta". Contém
--    dados reais de clientes/orçamentos. É o remendo mais urgente.
-- ============================================================


-- ------------------------------------------------------------
-- A) Ligar RLS nas 5 tabelas de backup expostas
-- ------------------------------------------------------------

alter table public.ob_orcamentos_bkp_20260808 enable row level security;
alter table public.ob_orcamentos_backup_20260901 enable row level security;
alter table public.ob_uni_items_backup_20260811 enable row level security;
alter table public.ob_uni_atividades_backup_20260811 enable row level security;
alter table public.ob_crm_dados_backup_20260901 enable row level security;


-- ------------------------------------------------------------
-- B) Policies — só leitura, só admin (são backups pontuais para
--    recuperação/auditoria, não fluxo de trabalho ativo; ninguém no
--    frontend hoje lê/escreve nestas tabelas — grep confirmado).
--    Mesmo padrão de 'ob_crm_dados_select_legado' para ob-uni-items.
-- ------------------------------------------------------------

create policy ob_orcamentos_bkp_20260808_select_admin on public.ob_orcamentos_bkp_20260808
  for select to authenticated
  using (public.ob_is_admin());

create policy ob_orcamentos_backup_20260901_select_admin on public.ob_orcamentos_backup_20260901
  for select to authenticated
  using (public.ob_is_admin());

create policy ob_uni_items_backup_20260811_select_admin on public.ob_uni_items_backup_20260811
  for select to authenticated
  using (public.ob_is_admin());

create policy ob_uni_atividades_backup_20260811_select_admin on public.ob_uni_atividades_backup_20260811
  for select to authenticated
  using (public.ob_is_admin());

create policy ob_crm_dados_backup_20260901_select_admin on public.ob_crm_dados_backup_20260901
  for select to authenticated
  using (public.ob_is_admin());

-- Sem policy de INSERT/UPDATE/DELETE em nenhuma — só o dono do
-- projeto (service_role/postgres) escreve nestas tabelas, e essas
-- roles ignoram RLS. Isto bloqueia escrita por 'authenticated' e
-- 'anon' por omissão, incluindo admin através da aplicação normal.


-- ------------------------------------------------------------
-- C) Reforço de GRANTs — mesmo padrão da migration
--    ob_crm_dados_rls_remediacao (revoga tudo de anon, remove
--    DELETE/TRUNCATE de authenticated)
-- ------------------------------------------------------------

revoke all on public.ob_orcamentos_bkp_20260808 from anon;
revoke all on public.ob_orcamentos_backup_20260901 from anon;
revoke all on public.ob_uni_items_backup_20260811 from anon;
revoke all on public.ob_uni_atividades_backup_20260811 from anon;
revoke all on public.ob_crm_dados_backup_20260901 from anon;

revoke delete, truncate, insert, update on public.ob_orcamentos_bkp_20260808 from authenticated;
revoke delete, truncate, insert, update on public.ob_orcamentos_backup_20260901 from authenticated;
revoke delete, truncate, insert, update on public.ob_uni_items_backup_20260811 from authenticated;
revoke delete, truncate, insert, update on public.ob_uni_atividades_backup_20260811 from authenticated;
revoke delete, truncate, insert, update on public.ob_crm_dados_backup_20260901 from authenticated;
grant select on public.ob_orcamentos_bkp_20260808 to authenticated;
grant select on public.ob_orcamentos_backup_20260901 to authenticated;
grant select on public.ob_uni_items_backup_20260811 to authenticated;
grant select on public.ob_uni_atividades_backup_20260811 to authenticated;
grant select on public.ob_crm_dados_backup_20260901 to authenticated;


-- ------------------------------------------------------------
-- D) ob_crm_dados: tornar explícita (não só implícita) a negação
--    das 16 chaves de backup/sync-TOConline, com o mesmo padrão
--    'legado' já usado para ob-uni-items. Não muda nenhum
--    comportamento (já estava tudo negado por omissão) — só
--    documenta a decisão para quem auditar pg_policies no futuro.
-- ------------------------------------------------------------

create policy ob_crm_dados_select_backups_legado on public.ob_crm_dados
  for select to authenticated
  using (
    chave in (
      'ob-clients-backup-20260810',
      'ob-clients-backup-20260810b',
      'ob-clients-backup-20260814-pre-consolidacao',
      'ob-clients-backup-20260814-pre-restauracao',
      'ob-clients-backup-20260902-pre-enriquecimento',
      'ob-clients-backup-20260902-pre-promocao',
      'ob-clients-backup-20260902-pre-toconline',
      'ob-clients-consolidado-20260814-preview',
      'ob-tes-receber-backup-20260903-pre-sheet-sync',
      'toc-finance-audit-credit_notes',
      'toc-finance-audit-invoices',
      'toc-finance-audit-invoices-checkpoint',
      'toc-finance-audit-receipts',
      'toc-oauth',
      'toc-snapshot',
      'toc-sync-estado'
    )
    and public.ob_is_admin()
  );

-- Sem policy de INSERT/UPDATE/DELETE para estas chaves — continuam
-- só graváveis por service_role (scripts de sync/backup), como já
-- acontece hoje. 'toc-oauth' em particular guarda credenciais de
-- integração: mantém-se só leitura-admin, nunca escrita via
-- authenticated/anon.


-- ------------------------------------------------------------
-- E) ROLLBACK
-- ------------------------------------------------------------
-- drop policy if exists ob_orcamentos_bkp_20260808_select_admin on public.ob_orcamentos_bkp_20260808;
-- drop policy if exists ob_orcamentos_backup_20260901_select_admin on public.ob_orcamentos_backup_20260901;
-- drop policy if exists ob_uni_items_backup_20260811_select_admin on public.ob_uni_items_backup_20260811;
-- drop policy if exists ob_uni_atividades_backup_20260811_select_admin on public.ob_uni_atividades_backup_20260811;
-- drop policy if exists ob_crm_dados_backup_20260901_select_admin on public.ob_crm_dados_backup_20260901;
-- drop policy if exists ob_crm_dados_select_backups_legado on public.ob_crm_dados;
-- alter table public.ob_orcamentos_bkp_20260808 disable row level security;
-- alter table public.ob_orcamentos_backup_20260901 disable row level security;
-- alter table public.ob_uni_items_backup_20260811 disable row level security;
-- alter table public.ob_uni_atividades_backup_20260811 disable row level security;
-- alter table public.ob_crm_dados_backup_20260901 disable row level security;
-- grant all on public.ob_orcamentos_bkp_20260808 to anon, authenticated;
-- grant all on public.ob_orcamentos_backup_20260901 to anon, authenticated;
-- grant all on public.ob_uni_items_backup_20260811 to anon, authenticated;
-- grant all on public.ob_uni_atividades_backup_20260811 to anon, authenticated;
-- grant all on public.ob_crm_dados_backup_20260901 to anon, authenticated;
-- Nenhuma linha de dados é tocada em qualquer sentido — só
-- policies/grants/RLS on-off.


-- ------------------------------------------------------------
-- F) TESTES A CORRER DEPOIS DE APLICAR (nenhum corrido ainda)
-- ------------------------------------------------------------
-- - anon (sem sessão): SELECT/INSERT/UPDATE em qualquer uma das 5
--   tabelas -> NEGA tudo (hoje: PERMITE tudo, é o bug a corrigir).
-- - authenticated não-admin (comercial/financeiro): SELECT nas 5
--   tabelas -> NEGA.
-- - authenticated admin: SELECT nas 5 tabelas -> PERMITE; INSERT/
--   UPDATE/DELETE -> NEGA (só service_role escreve).
-- - Confirmar que nenhum script de sync (crm-toconline-*, rotinas
--   de backup manual) corre com a authenticated key em vez de
--   service_role — se algum correr, esta proposta bloqueia-o e
--   precisa de policy de escrita própria, ainda por identificar.
-- - Confirmar em produção que index.html não lê nenhuma das 16
--   chaves cobertas na secção D nem as 5 tabelas da secção A/B
--   (grep já feito nesta investigação, sem resultados — repetir
--   depois de aplicar para confirmar que nada mudou silenciosamente).
