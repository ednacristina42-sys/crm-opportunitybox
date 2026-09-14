-- F6 — fechar public.v_toc_plano (security_definer_view, ERROR).
-- NÃO aplicar sem revisão.
--
-- Auditoria (2026-09-12, revalidada 2026-09-14) confirmou:
--   - view SECURITY DEFINER (dono postgres, sem security_invoker), corre
--     com os privilégios do dono em vez do utilizador que consulta;
--   - anon e authenticated tinham TODOS os privilégios (SELECT/INSERT/
--     UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES), confirmados via
--     information_schema.role_table_grants;
--   - lê só de public.ob_crm_dados (chaves 'toc-snapshot' e 'ob-clients');
--   - expõe campos derivados de cliente: w_tel, w_email, w_cont, w_cp,
--     w_loc (mais w_tocid, w_prazo, cid, toc_id, e — sem dados novos além
--     dos já auditados);
--   - nenhuma FK/trigger/view/função pública depende desta view;
--   - sem referência conhecida no frontend do CRM (index.html).
--
-- Versão confirmada do Postgres do projeto: 17.6 — suporta
-- `ALTER VIEW ... SET (security_invoker = true)` (disponível desde o
-- Postgres 15), pelo que se usa essa forma em vez de recriar a view.
-- A definição da view (SQL da query) não é alterada — só a opção
-- security_invoker e os grants.
--
-- Com security_invoker = true, a view passa a correr com os privilégios
-- e as políticas de RLS do utilizador que a consulta, em vez do dono
-- (postgres) — deixa de contornar o fecho de acesso anónimo já aplicado
-- a ob_crm_dados pelo F2/F3.

begin;

alter view public.v_toc_plano
  set (security_invoker = true);

revoke all
  on public.v_toc_plano
  from public, anon, authenticated, service_role;

grant select
  on public.v_toc_plano
  to authenticated, service_role;

commit;
