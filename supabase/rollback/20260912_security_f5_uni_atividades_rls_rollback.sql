-- ROLLBACK DE EMERGÊNCIA — F5 (ob_uni_atividades derivada de ob_uni_items)
-- NÃO aplicar normalmente.
-- Serve exclusivamente para restaurar o estado anterior caso a migration
-- 20260912140000_security_f5_uni_atividades_rls.sql cause algum problema
-- inesperado. Restaura exatamente as 4 policies de ob_uni_atividades como
-- estavam antes (ver 20260811093118_ob_uni_items_rls_por_owner.sql) e
-- remove apenas a constraint ob_uni_atividades_item_id_fkey. Não remove o
-- índice ob_uni_atividades_item_idx (já existia antes do F5) nem toca em
-- public.ob_current_department() (pertence ao F4).

begin;

drop policy if exists ob_uni_atividades_select on public.ob_uni_atividades;
drop policy if exists ob_uni_atividades_insert on public.ob_uni_atividades;
drop policy if exists ob_uni_atividades_update on public.ob_uni_atividades;
drop policy if exists ob_uni_atividades_delete on public.ob_uni_atividades;

-- Restaurar as 4 policies exatamente como estavam antes do F5.
create policy ob_uni_atividades_select on public.ob_uni_atividades
  for select using (auth.uid() is not null);

create policy ob_uni_atividades_insert on public.ob_uni_atividades
  for insert with check (auth.uid() is not null);

create policy ob_uni_atividades_update on public.ob_uni_atividades
  for update using (auth.uid() is not null) with check (auth.uid() is not null);

create policy ob_uni_atividades_delete on public.ob_uni_atividades
  for delete using (auth.uid() is not null);

-- Remover só a constraint introduzida pelo F5 — nunca o índice existente.
alter table public.ob_uni_atividades
  drop constraint if exists ob_uni_atividades_item_id_fkey;

commit;
