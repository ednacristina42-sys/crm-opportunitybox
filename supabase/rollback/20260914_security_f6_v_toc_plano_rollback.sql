-- ROLLBACK DE EMERGÊNCIA — F6 (public.v_toc_plano)
-- NÃO aplicar normalmente.
-- Serve exclusivamente para restaurar o estado anterior caso a migration
-- 20260914101500_security_f6_v_toc_plano.sql cause algum problema
-- inesperado. Reverte só o security_invoker (RESET, não um valor
-- arbitrário) e os grants para o estado exato apurado na auditoria de
-- 2026-09-12/14 (antes da migration) — nada na definição da view
-- (SQL da query) é tocado, porque a migration original também não a
-- alterou.

begin;

alter view public.v_toc_plano
  reset (security_invoker);

grant all
  on public.v_toc_plano
  to public, anon, authenticated, service_role;

commit;
