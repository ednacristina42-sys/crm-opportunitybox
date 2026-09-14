-- ROLLBACK DE EMERGÊNCIA — F6 (funções residuais isp_*)
-- NÃO aplicar normalmente.
-- Serve exclusivamente para restaurar o estado anterior caso a migration
-- 20260914113000_security_f6_residual_functions.sql cause algum
-- problema inesperado. Reverte só o search_path fixo introduzido pela
-- migration (RESET, não um valor arbitrário) — nada de corpo de função,
-- SECURITY DEFINER/INVOKER, grants ou trigger é tocado, porque a
-- migration original também não tocou nisso.

begin;

alter function public.isp_get_tenant_id() reset search_path;
alter function public.isp_is_tenant_member(uuid) reset search_path;
alter function public.isp_handle_new_user() reset search_path;

commit;
