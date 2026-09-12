-- F6 — hardening de search_path (só para funções comprovadamente seguras
-- e internas ao Opportunitybox — ver docs/security-f6-audit.md).
-- NÃO aplicar sem revisão.
--
-- Âmbito estritamente limitado: só ALTER FUNCTION ... SET search_path.
-- Nada de corpo de função, SECURITY DEFINER/INVOKER, grants ou lógica é
-- alterado. As funções isp_*/user_company() também têm search_path
-- mutável (ver auditoria), mas ficam de fora desta migration por não
-- serem claramente Opportunitybox/infraestrutura interna (parecem
-- pertencer a outro produto/tenant que partilha este projeto Supabase).

begin;

-- set_updated_at() — trigger BEFORE UPDATE em ob_orcamentos, ob_stock,
-- ob_profiles, ob_clientes, ob_leads e ob_tasks. SECURITY INVOKER, corpo
-- trivial (só NEW.updated_at/now()), sem dependência de resolução de
-- nomes fora do óbvio — search_path é o único problema apontado.
alter function public.set_updated_at() set search_path = public;

-- ob_colaboradores_touch() — trigger BEFORE UPDATE em ob_colaboradores.
-- Mesmo padrão trivial e mesma justificação do set_updated_at() acima.
alter function public.ob_colaboradores_touch() set search_path = public;

commit;
