-- F6 — hardening de search_path para as 3 funções residuais isp_*
-- (ver docs/security-f6-audit.md, secção "F6 — auditoria final isp_* /
-- user_company").
-- NÃO aplicar sem revisão.
--
-- Âmbito estritamente limitado: só ALTER FUNCTION ... SET search_path.
-- Nada de corpo de função, SECURITY DEFINER/INVOKER, grants ou trigger é
-- alterado.
--
-- Estas 3 funções (isp_get_tenant_id, isp_is_tenant_member,
-- isp_handle_new_user) pertencem, com boa confiança, a outro
-- sistema/tenant que partilha este projeto Supabase (schema isp_*, sem
-- qualquer referência em index.html, mas com dados reais e trigger
-- ativa) — classificação B na auditoria. Mesmo assim, o hardening de
-- search_path é aplicado porque foi comprovado, por introspeção,
-- SEM ALTERAR COMPORTAMENTO: a tabela isp_profiles, referenciada sem
-- qualificação de schema no corpo das 3 funções, existe SÓ no schema
-- public em toda a base de dados (confirmado por
-- information_schema.tables sem filtro de schema e por enumeração de
-- todos os schemas via pg_namespace) — logo fixar search_path=public
-- não pode mudar a resolução do nome para nenhuma outra tabela.
--
-- public.user_company() foi auditada na mesma ronda mas NÃO entra aqui:
-- já tem search_path=public fixo desde antes (confirmado por
-- pg_proc.proconfig).

begin;

alter function public.isp_get_tenant_id() set search_path = public;
alter function public.isp_is_tenant_member(uuid) set search_path = public;
alter function public.isp_handle_new_user() set search_path = public;

commit;
