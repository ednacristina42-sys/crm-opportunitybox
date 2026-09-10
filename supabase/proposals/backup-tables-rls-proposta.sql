-- ============================================================
-- Remediação RLS de tabelas de backup expostas.
-- PROPOSTA, NAO APLICADA.
--
-- v2 (2026-09-10) — revista após feedback: princípio de menor
-- privilégio nas 5 tabelas de backup (sem policy nenhuma, nem para
-- 'authenticated' nem para 'anon' — só service_role/postgres, que já
-- ignoram RLS por BYPASSRLS). As 16 chaves órfãs de ob_crm_dados
-- ficaram FORA desta proposta (ver secção 0) — não se mexe nelas.
--
-- Contexto (investigação de 2026-09-10):
--
-- 5 tabelas físicas de backup têm RLS COMPLETAMENTE DESLIGADO,
-- reportado pelo advisor de segurança do Supabase — expostas por
-- inteiro à anon key (SELECT/INSERT/UPDATE/DELETE/TRUNCATE, tudo,
-- confirmado por information_schema.role_table_grants: 'anon' e
-- 'authenticated' têm hoje as 7 privileges via default privileges em
-- cada uma das 5). Contêm dados reais:
--
--   ob_orcamentos_bkp_20260808           577 linhas
--   ob_orcamentos_backup_20260901        722 linhas
--   ob_uni_items_backup_20260811          25 linhas
--   ob_uni_atividades_backup_20260811      0 linhas
--   ob_crm_dados_backup_20260901          21 linhas
--
-- Confirmado antes desta proposta:
--  - Nenhum dos 5 nomes de tabela aparece em index.html nem em
--    nenhuma migration existente em supabase/migrations/ (grep,
--    sem resultados) — não há dependência de frontend nem de
--    migration tracked. Foram criadas fora do fluxo normal
--    (snapshots manuais pontuais).
--  - O processo TOConline (edge function crm-toconline, ver
--    scratchpad/crm-toconline-v23.ts linha ~179) já usa
--    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") explicitamente para
--    persistir dados — comentário no próprio código: "Persistencia
--    na base (service_role; RLS nao se aplica)". Não toca nestas 5
--    tabelas, mas confirma que o padrão de sync desta app já é
--    service_role, não anon/authenticated.
--  - service_role e postgres têm rolbypassrls=true (confirmado em
--    pg_roles) — continuam com acesso total independentemente de
--    RLS/policies, sem precisar de nenhuma policy dedicada.
-- ============================================================


-- ------------------------------------------------------------
-- 0) As 16 chaves órfãs de ob_crm_dados (ob-clients-backup-*,
--    toc-finance-audit-*, toc-oauth, toc-snapshot, toc-sync-estado)
--    ficam DE FORA desta proposta, por decisão explícita: hoje já
--    estão negadas a anon/authenticated pela ausência de policy
--    (RLS é deny-by-default). Criar uma policy SELECT-admin para
--    "documentar" essa negação na verdade CONCEDE acesso novo que
--    não existe hoje — incluindo a 'toc-oauth', que guarda
--    credenciais de integração e deve continuar inacessível ao
--    frontend em qualquer papel. Nenhuma alteração proposta aqui.
-- ------------------------------------------------------------


-- ------------------------------------------------------------
-- 1) Ligar RLS nas 5 tabelas de backup expostas
-- ------------------------------------------------------------

alter table public.ob_orcamentos_bkp_20260808 enable row level security;
alter table public.ob_orcamentos_backup_20260901 enable row level security;
alter table public.ob_uni_items_backup_20260811 enable row level security;
alter table public.ob_uni_atividades_backup_20260811 enable row level security;
alter table public.ob_crm_dados_backup_20260901 enable row level security;


-- ------------------------------------------------------------
-- 2) Revogar TODOS os privilégios de 'anon' e 'authenticated' nas 5
--    tabelas. Sem nenhuma policy (nem para 'authenticated', nem
--    admin-gated) — menor privilégio real: mesmo que uma GRANT
--    volte a ser concedida por engano no futuro, RLS ligado sem
--    nenhuma policy já bloqueia esses dois roles por definição.
--    Nenhum SELECT é concedido à app para admin — só leitura direta
--    por service_role/postgres (dashboard do Supabase, scripts de
--    recuperação), que ignoram RLS.
-- ------------------------------------------------------------

revoke all on public.ob_orcamentos_bkp_20260808 from anon, authenticated;
revoke all on public.ob_orcamentos_backup_20260901 from anon, authenticated;
revoke all on public.ob_uni_items_backup_20260811 from anon, authenticated;
revoke all on public.ob_uni_atividades_backup_20260811 from anon, authenticated;
revoke all on public.ob_crm_dados_backup_20260901 from anon, authenticated;

-- Sem nenhum GRANT a seguir — nem SELECT, nem para 'authenticated',
-- nem para 'admin via aplicação'. service_role/postgres continuam
-- com os privilégios que já tinham (owner/role de sistema) — nada a
-- fazer aí. Sem nenhuma CREATE POLICY — zero policies nas 5 tabelas.


-- ------------------------------------------------------------
-- 3) ROLLBACK
-- ------------------------------------------------------------
-- Só desliga RLS se um dia for mesmo necessário — NÃO restaura os
-- GRANTs a anon/authenticated. O estado anterior (aberto a anon)
-- era o próprio problema reportado pelo advisor; um rollback nunca
-- deve reabrir os backups publicamente. Se alguma vez for preciso
-- que 'authenticated' volte a aceder a uma destas tabelas, isso
-- exige uma decisão nova e deliberada — GRANT explícito + policy
-- própria — nunca um "desfazer" automático desta proposta.
--
-- alter table public.ob_orcamentos_bkp_20260808 disable row level security;
-- alter table public.ob_orcamentos_backup_20260901 disable row level security;
-- alter table public.ob_uni_items_backup_20260811 disable row level security;
-- alter table public.ob_uni_atividades_backup_20260811 disable row level security;
-- alter table public.ob_crm_dados_backup_20260901 disable row level security;
--
-- Nenhuma linha de dados é tocada em qualquer sentido — só
-- policies/grants/RLS on-off.


-- ------------------------------------------------------------
-- 4) TESTES A CORRER DEPOIS DE APLICAR (nenhum corrido ainda)
-- ------------------------------------------------------------
-- - anon (sem sessão): SELECT/INSERT/UPDATE/DELETE em qualquer uma
--   das 5 tabelas -> "permission denied for table ..." (negado ao
--   nível do GRANT, nem chega a avaliar RLS). Hoje: PERMITE tudo —
--   é o bug a corrigir.
-- - authenticated, QUALQUER papel incluindo admin: idem, SELECT/
--   INSERT/UPDATE/DELETE -> "permission denied for table ...". Não
--   há exceção para admin via aplicação, por decisão explícita.
-- - service_role (dashboard/scripts server-side): SELECT/INSERT/
--   UPDATE/DELETE continuam a funcionar normalmente (BYPASSRLS +
--   grants de owner, inalterados por esta proposta).
-- - Repetir o grep dos 5 nomes de tabela em index.html e em
--   supabase/ depois de aplicar, para confirmar que continua sem
--   nenhuma referência (nada deveria ter mudado).
