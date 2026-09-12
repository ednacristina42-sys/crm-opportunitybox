-- ROLLBACK DE EMERGÊNCIA — F4 (permissões de ob_uni_items por departamento)
-- NÃO aplicar normalmente.
-- Serve exclusivamente para restaurar o estado anterior caso a migration
-- 20260912133000_security_f4_uni_items_department_rls.sql cause algum
-- problema inesperado. Restaura exatamente as 4 policies de ob_uni_items
-- como estavam antes (ver 20260811093118_ob_uni_items_rls_por_owner.sql)
-- e remove public.ob_current_department().

begin;

drop policy if exists ob_uni_items_select on public.ob_uni_items;
drop policy if exists ob_uni_items_insert on public.ob_uni_items;
drop policy if exists ob_uni_items_update on public.ob_uni_items;
drop policy if exists ob_uni_items_delete on public.ob_uni_items;

-- Restaurar SELECT exatamente como estava.
create policy ob_uni_items_select on public.ob_uni_items
  for select
  using (
    (page = 'admin-agenda' and public.ob_can_see(owner_id))
    or (page <> 'admin-agenda' and auth.uid() is not null)
  );

-- Restaurar INSERT exatamente como estava.
create policy ob_uni_items_insert on public.ob_uni_items
  for insert
  with check (
    (page = 'admin-agenda' and (owner_id = auth.uid() or public.ob_is_admin()))
    or (page <> 'admin-agenda' and auth.uid() is not null)
  );

-- Restaurar UPDATE exatamente como estava (mesma lógica de SELECT no
-- USING e de INSERT no WITH CHECK).
create policy ob_uni_items_update on public.ob_uni_items
  for update
  using (
    (page = 'admin-agenda' and public.ob_can_see(owner_id))
    or (page <> 'admin-agenda' and auth.uid() is not null)
  )
  with check (
    (page = 'admin-agenda' and (owner_id = auth.uid() or public.ob_is_admin()))
    or (page <> 'admin-agenda' and auth.uid() is not null)
  );

-- Restaurar DELETE exatamente como estava.
create policy ob_uni_items_delete on public.ob_uni_items
  for delete
  using (
    (page = 'admin-agenda' and public.ob_can_see(owner_id))
    or (page <> 'admin-agenda' and auth.uid() is not null)
  );

-- Remover a função introduzida pelo F4.
drop function if exists public.ob_current_department();

commit;
