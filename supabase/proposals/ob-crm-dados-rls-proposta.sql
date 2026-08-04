-- ============================================================
-- Remediação RLS de public.ob_crm_dados
-- PROPOSTA, NAO APLICADA. ob-uni-items NAO e apagada/arquivada --
-- fica coberta por uma policy de SELECT só para admin (legado,
-- sem escrita), exactamente como pedido.
-- Reutiliza public.ob_is_admin() e public.ob_current_role() —
-- ambas já existem em produção, nenhuma função nova necessária.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Remover a política totalmente aberta
-- ------------------------------------------------------------
drop policy if exists ob_crm_dados_open on public.ob_crm_dados;
-- RLS já está ENABLE nesta tabela (confirmado) — não é preciso repetir.


-- ------------------------------------------------------------
-- 2) SELECT — uma policy por categoria funcional
-- ------------------------------------------------------------

create policy ob_crm_dados_select_comercial on public.ob_crm_dados
  for select to authenticated
  using (
    chave in ('ob-leads','ob-crm-atividades','ob-crm-historico','ob-clients')
    and (public.ob_is_admin() or public.ob_current_role() in ('comercial','manager'))
  );

create policy ob_crm_dados_select_financeiro on public.ob_crm_dados
  for select to authenticated
  using (
    chave in ('ob-fin-despesas','ob-iva-dados','ob-tes-cartoes','ob-tes-contas','ob-tes-log','ob-tes-receber')
    and (public.ob_is_admin() or public.ob_current_role() = 'financeiro')
  );

-- ob-faturas é caso especial: vive na página de Orçamentos, usada
-- pelo comercial para emitir facturas — não pode ficar só financeiro.
create policy ob_crm_dados_select_faturas on public.ob_crm_dados
  for select to authenticated
  using (
    chave = 'ob-faturas'
    and (public.ob_is_admin() or public.ob_current_role() in ('comercial','financeiro','manager'))
  );

-- RH: não existe papel 'rh' em ob_user_role. Por agora, só admin —
-- decisão a rever quando/se existir um papel RH próprio.
create policy ob_crm_dados_select_rh on public.ob_crm_dados
  for select to authenticated
  using (
    chave in ('ob-rh-colabs','ob-rh-ferias-cfg','ob-rh-turnos','ob-fo-ausencias')
    and public.ob_is_admin()
  );

-- ob-uni-items: legado/órfão (a Pipeline de Produção usa hoje a
-- tabela ob_uni_items, não esta chave). Mantida, não apagada, mas
-- só leitura por admin — sem policy de INSERT/UPDATE.
create policy ob_crm_dados_select_legado on public.ob_crm_dados
  for select to authenticated
  using (chave = 'ob-uni-items' and public.ob_is_admin());


-- ------------------------------------------------------------
-- 3) INSERT — mesma categorização (sem 'legado': ob-uni-items não
--    deve receber escrita nova por este caminho)
-- ------------------------------------------------------------

create policy ob_crm_dados_insert_comercial on public.ob_crm_dados
  for insert to authenticated
  with check (
    chave in ('ob-leads','ob-crm-atividades','ob-crm-historico','ob-clients')
    and (public.ob_is_admin() or public.ob_current_role() in ('comercial','manager'))
  );

create policy ob_crm_dados_insert_financeiro on public.ob_crm_dados
  for insert to authenticated
  with check (
    chave in ('ob-fin-despesas','ob-iva-dados','ob-tes-cartoes','ob-tes-contas','ob-tes-log','ob-tes-receber')
    and (public.ob_is_admin() or public.ob_current_role() = 'financeiro')
  );

create policy ob_crm_dados_insert_faturas on public.ob_crm_dados
  for insert to authenticated
  with check (
    chave = 'ob-faturas'
    and (public.ob_is_admin() or public.ob_current_role() in ('comercial','financeiro','manager'))
  );

create policy ob_crm_dados_insert_rh on public.ob_crm_dados
  for insert to authenticated
  with check (
    chave in ('ob-rh-colabs','ob-rh-ferias-cfg','ob-rh-turnos','ob-fo-ausencias')
    and public.ob_is_admin()
  );


-- ------------------------------------------------------------
-- 4) UPDATE — mesma categorização (usa upsert com on_conflict, que
--    em Postgres/PostgREST passa por UPDATE quando a linha já existe)
-- ------------------------------------------------------------

create policy ob_crm_dados_update_comercial on public.ob_crm_dados
  for update to authenticated
  using (
    chave in ('ob-leads','ob-crm-atividades','ob-crm-historico','ob-clients')
    and (public.ob_is_admin() or public.ob_current_role() in ('comercial','manager'))
  )
  with check (
    chave in ('ob-leads','ob-crm-atividades','ob-crm-historico','ob-clients')
    and (public.ob_is_admin() or public.ob_current_role() in ('comercial','manager'))
  );

create policy ob_crm_dados_update_financeiro on public.ob_crm_dados
  for update to authenticated
  using (
    chave in ('ob-fin-despesas','ob-iva-dados','ob-tes-cartoes','ob-tes-contas','ob-tes-log','ob-tes-receber')
    and (public.ob_is_admin() or public.ob_current_role() = 'financeiro')
  )
  with check (
    chave in ('ob-fin-despesas','ob-iva-dados','ob-tes-cartoes','ob-tes-contas','ob-tes-log','ob-tes-receber')
    and (public.ob_is_admin() or public.ob_current_role() = 'financeiro')
  );

create policy ob_crm_dados_update_faturas on public.ob_crm_dados
  for update to authenticated
  using (
    chave = 'ob-faturas'
    and (public.ob_is_admin() or public.ob_current_role() in ('comercial','financeiro','manager'))
  )
  with check (
    chave = 'ob-faturas'
    and (public.ob_is_admin() or public.ob_current_role() in ('comercial','financeiro','manager'))
  );

create policy ob_crm_dados_update_rh on public.ob_crm_dados
  for update to authenticated
  using (
    chave in ('ob-rh-colabs','ob-rh-ferias-cfg','ob-rh-turnos','ob-fo-ausencias')
    and public.ob_is_admin()
  )
  with check (
    chave in ('ob-rh-colabs','ob-rh-ferias-cfg','ob-rh-turnos','ob-fo-ausencias')
    and public.ob_is_admin()
  );

-- Sem nenhuma policy de DELETE — nenhum fluxo do frontend apaga
-- linhas de ob_crm_dados hoje (todas as escritas são upsert por
-- chave). DELETE fica bloqueado por omissão para todos, incluindo
-- admin através da aplicação normal.


-- ------------------------------------------------------------
-- 5) GRANTs — reforço explícito, mesmo padrão já usado na Fase 1.6
-- ------------------------------------------------------------
-- Auditoria (leitura, já feita): anon e authenticated têm hoje
-- SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER via
-- default privileges. Reforço:

revoke all on public.ob_crm_dados from anon;
revoke delete, truncate on public.ob_crm_dados from authenticated;
grant select, insert, update on public.ob_crm_dados to authenticated;


-- ------------------------------------------------------------
-- 6) ROLLBACK COMPLETO — restaura exactamente o estado anterior
-- ------------------------------------------------------------
-- drop policy if exists ob_crm_dados_select_comercial on public.ob_crm_dados;
-- drop policy if exists ob_crm_dados_select_financeiro on public.ob_crm_dados;
-- drop policy if exists ob_crm_dados_select_faturas on public.ob_crm_dados;
-- drop policy if exists ob_crm_dados_select_rh on public.ob_crm_dados;
-- drop policy if exists ob_crm_dados_select_legado on public.ob_crm_dados;
-- drop policy if exists ob_crm_dados_insert_comercial on public.ob_crm_dados;
-- drop policy if exists ob_crm_dados_insert_financeiro on public.ob_crm_dados;
-- drop policy if exists ob_crm_dados_insert_faturas on public.ob_crm_dados;
-- drop policy if exists ob_crm_dados_insert_rh on public.ob_crm_dados;
-- drop policy if exists ob_crm_dados_update_comercial on public.ob_crm_dados;
-- drop policy if exists ob_crm_dados_update_financeiro on public.ob_crm_dados;
-- drop policy if exists ob_crm_dados_update_faturas on public.ob_crm_dados;
-- drop policy if exists ob_crm_dados_update_rh on public.ob_crm_dados;
-- grant all on public.ob_crm_dados to anon;
-- grant all on public.ob_crm_dados to authenticated;
-- create policy ob_crm_dados_open on public.ob_crm_dados for all to public using (true) with check (true);
-- Nenhuma linha de dados é tocada em qualquer sentido — só policies/grants.


-- ------------------------------------------------------------
-- 7) MATRIZ DE TESTES POR PAPEL (a executar depois de aplicar,
--    antes de considerar concluído — nenhum destes testes foi
--    corrido ainda, é o que falta fazer quando for aprovado)
-- ------------------------------------------------------------
-- Legenda: A=Admin  M=Manager  C=Comercial  F=Financeiro  N=anon (sem sessão)
--
-- Categoria "comercial" (ob-leads/ob-crm-atividades/ob-crm-historico/ob-clients)
--   SELECT: A permite | M permite | C permite | F NEGA | N NEGA (sem grant)
--   INSERT: A permite | M permite | C permite | F NEGA | N NEGA
--   UPDATE: A permite | M permite | C permite | F NEGA | N NEGA
--
-- Categoria "financeiro" (ob-fin-despesas/ob-iva-dados/ob-tes-*)
--   SELECT: A permite | M NEGA | C NEGA | F permite | N NEGA
--   INSERT: A permite | M NEGA | C NEGA | F permite | N NEGA
--   UPDATE: A permite | M NEGA | C NEGA | F permite | N NEGA
--
-- Categoria "faturas" (ob-faturas)
--   SELECT: A permite | M permite | C permite | F permite | N NEGA
--   INSERT: A permite | M permite | C permite | F permite | N NEGA
--   UPDATE: A permite | M permite | C permite | F permite | N NEGA
--
-- Categoria "rh" (ob-rh-*/ob-fo-ausencias)
--   SELECT: A permite | M NEGA | C NEGA | F NEGA | N NEGA
--   INSERT: A permite | M NEGA | C NEGA | F NEGA | N NEGA
--   UPDATE: A permite | M NEGA | C NEGA | F NEGA | N NEGA
--
-- Categoria "legado" (ob-uni-items)
--   SELECT: A permite | M NEGA | C NEGA | F NEGA | N NEGA
--   INSERT: NEGA para todos (sem policy)
--   UPDATE: NEGA para todos (sem policy)
--
-- Todas as categorias, DELETE: NEGA para todos, incluindo admin (sem policy).
--
-- Testes adicionais a correr (não só a matriz acima):
--  - ob-faturas escrito via importarConfiguracao() (index.html:23008) —
--    caminho fora do padrão identificado na investigação; confirmar
--    que continua a funcionar para comercial depois da RLS.
--  - ob-fo-ausencias escrito em index.html:14183 (sem obSbPush
--    adjacente) — confirmar que não fica bloqueado silenciosamente.
--  - Confirmar que os 577 orçamentos e as tabelas da Fase 1.6
--    continuam intactos (não são tocados por esta migration).


-- ------------------------------------------------------------
-- 8) PRESSUPOSTOS DE DESENHO A CONFIRMAR (não são factos, são
--    decisões que tomei por defeito e que pode querer corrigir)
-- ------------------------------------------------------------
-- - 'manager' incluído em "comercial" e "faturas" (supervisão),
--   excluído de "financeiro" e "rh" — não há evidência no código
--   que confirme isto, é uma extrapolação razoável do padrão já
--   usado por ob_can_see (que também estende a managers).
-- - RH restrito só a admin, por não existir papel 'rh' no enum
--   ob_user_role — alternativa seria usar department='Gestão
--   Administrativa', mas isso reintroduz o mesmo risco de string
--   livre que o bug do DEPT_PAGES (já corrigido no frontend, mas
--   não normalizado na base de dados).
-- - ob-uni-items só leitura por admin, nunca apagada — conforme
--   pedido explicitamente.
-- - Nenhuma policy de DELETE em categoria nenhuma — nenhum fluxo
--   do frontend apaga linhas de ob_crm_dados hoje.
