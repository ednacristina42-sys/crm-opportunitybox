-- ROLLBACK DE EMERGÊNCIA — F6 (search_path hardening)
-- NÃO aplicar normalmente.
-- Serve exclusivamente para restaurar o estado anterior caso a migration
-- 20260912143000_security_f6_search_path_hardening.sql cause algum
-- problema inesperado. Reverte só o search_path fixo introduzido pelo F6
-- (RESET, não um valor arbitrário) — nada de corpo de função, SECURITY
-- DEFINER/INVOKER ou grants é tocado, porque a migration original também
-- não tocou nisso.

begin;

alter function public.set_updated_at() reset search_path;
alter function public.ob_colaboradores_touch() reset search_path;

commit;
