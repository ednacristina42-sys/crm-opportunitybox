
drop policy if exists ob_uni_items_open on public.ob_uni_items;
drop policy if exists ob_uni_atividades_open on public.ob_uni_atividades;

-- ob_uni_items:
--   page='admin-agenda'  -> ob_can_see(owner_id): admin ve tudo, dono ve o seu, ninguem mais.
--   qualquer outra page  -> qualquer sessao autenticada (mesmo nivel de acesso que ja existe
--                            hoje na app para Producao/Design/Instalacoes, sem inventar dono).
--   sem sessao (anon)    -> nenhuma linha, nenhuma operacao.
create policy ob_uni_items_select on public.ob_uni_items
  for select
  using (
    (page = 'admin-agenda' and public.ob_can_see(owner_id))
    or (page <> 'admin-agenda' and auth.uid() is not null)
  );

create policy ob_uni_items_insert on public.ob_uni_items
  for insert
  with check (
    (page = 'admin-agenda' and (owner_id = auth.uid() or public.ob_is_admin()))
    or (page <> 'admin-agenda' and auth.uid() is not null)
  );

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

create policy ob_uni_items_delete on public.ob_uni_items
  for delete
  using (
    (page = 'admin-agenda' and public.ob_can_see(owner_id))
    or (page <> 'admin-agenda' and auth.uid() is not null)
  );

-- ob_uni_atividades: sem "page" proprio (item_id nao identifica de forma unica a
-- pagina, ver comentario no codigo sobre a PK composta (id,page) de ob_uni_items) --
-- regra minima segura: qualquer sessao autenticada, nenhum acesso anonimo.
create policy ob_uni_atividades_select on public.ob_uni_atividades
  for select using (auth.uid() is not null);
create policy ob_uni_atividades_insert on public.ob_uni_atividades
  for insert with check (auth.uid() is not null);
create policy ob_uni_atividades_update on public.ob_uni_atividades
  for update using (auth.uid() is not null) with check (auth.uid() is not null);
create policy ob_uni_atividades_delete on public.ob_uni_atividades
  for delete using (auth.uid() is not null);
