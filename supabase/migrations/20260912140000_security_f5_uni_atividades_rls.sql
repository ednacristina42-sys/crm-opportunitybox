-- F5 — segurança de ob_uni_atividades derivada de ob_uni_items.
-- NÃO aplicar sem revisão. Depende de F4 (public.ob_current_department())
-- já estar instalada e de não existirem atividades órfãs (ver travas
-- abaixo) — caso contrário aborta antes de tocar em qualquer coisa.

begin;

-- 1) Trava de integridade — obrigatória, antes de qualquer alteração:
-- nenhuma linha de ob_uni_atividades pode ficar sem o ob_uni_items
-- correspondente, ou a foreign key abaixo falharia a meio da migration
-- (ou pior, alguma órfã escaparia silenciosamente às novas policies,
-- que passam a derivar tudo do item relacionado).
do $$
begin
  if exists (
    select 1
    from public.ob_uni_atividades a
    left join public.ob_uni_items i on i.id = a.item_id
    where i.id is null
  ) then
    raise exception 'F5 blocked: orphan ob_uni_atividades records exist';
  end if;
end $$;

-- 2) Trava de dependência — F5 nunca pode ser aplicada antes de F4,
-- porque as novas policies de INSERT/UPDATE chamam
-- public.ob_current_department() (criada em
-- 20260912133000_security_f4_uni_items_department_rls.sql).
do $$
begin
  if to_regprocedure('public.ob_current_department()') is null then
    raise exception 'F5 blocked: F4 ob_current_department() is not installed';
  end if;
end $$;

-- 3) Foreign key item_id -> ob_uni_items(id). drop constraint if exists
-- antes, para esta migration poder ser reaplicada em segurança
-- (idempotência) sem duplicar a constraint.
alter table public.ob_uni_atividades
  drop constraint if exists ob_uni_atividades_item_id_fkey;

alter table public.ob_uni_atividades
  add constraint ob_uni_atividades_item_id_fkey
  foreign key (item_id)
  references public.ob_uni_items(id)
  on delete cascade;

-- Nota: não é criado nenhum índice novo — ob_uni_atividades_item_idx já
-- existe em item_id e continua a servir tanto a FK acima como as
-- policies abaixo (todas filtram por item_id).

-- 4) Substituir as 4 policies atuais (todas "auth.uid() is not null",
-- ver 20260811093118_ob_uni_items_rls_por_owner.sql) por policies que
-- derivam sempre a autorização do ob_uni_items relacionado — nunca de
-- colunas próprias novas em ob_uni_atividades (nenhuma coluna page/
-- owner_id/department é adicionada aqui, ver ponto 8 do pedido).
drop policy if exists ob_uni_atividades_select on public.ob_uni_atividades;
drop policy if exists ob_uni_atividades_insert on public.ob_uni_atividades;
drop policy if exists ob_uni_atividades_update on public.ob_uni_atividades;
drop policy if exists ob_uni_atividades_delete on public.ob_uni_atividades;

-- SELECT — mesma visibilidade atual de ob_uni_items: admin-agenda por
-- ob_can_see(owner_id); qualquer outra página, qualquer authenticated.
create policy ob_uni_atividades_select on public.ob_uni_atividades
  for select
  using (
    exists (
      select 1 from public.ob_uni_items i
      where i.id = ob_uni_atividades.item_id
        and (
          (i.page = 'admin-agenda' and public.ob_can_see(i.owner_id))
          or (i.page <> 'admin-agenda' and auth.uid() is not null)
        )
    )
  );

-- INSERT — só se existir o item relacionado E o utilizador tiver
-- permissão de edição sobre esse item (mesma matriz do F4); qualquer
-- página fora desta lista nunca é permitida automaticamente.
create policy ob_uni_atividades_insert on public.ob_uni_atividades
  for insert
  with check (
    exists (
      select 1 from public.ob_uni_items i
      where i.id = ob_uni_atividades.item_id
        and (
          (i.page = 'admin-agenda' and (i.owner_id = auth.uid() or public.ob_is_admin()))
          or (i.page in ('design-ficheiros','design-tarefas')
              and (public.ob_is_admin() or lower(coalesce(public.ob_current_department(),'')) = 'design'))
          or (i.page = 'fabrica-producao'
              and (public.ob_is_admin() or lower(coalesce(public.ob_current_department(),'')) in ('produção','producao')))
          or (i.page = 'fabrica-instalacoes'
              and (public.ob_is_admin() or lower(coalesce(public.ob_current_department(),'')) in ('instalação','instalacao')))
        )
    )
  );

-- UPDATE — mesma lógica do INSERT, no USING e no WITH CHECK.
create policy ob_uni_atividades_update on public.ob_uni_atividades
  for update
  using (
    exists (
      select 1 from public.ob_uni_items i
      where i.id = ob_uni_atividades.item_id
        and (
          (i.page = 'admin-agenda' and (i.owner_id = auth.uid() or public.ob_is_admin()))
          or (i.page in ('design-ficheiros','design-tarefas')
              and (public.ob_is_admin() or lower(coalesce(public.ob_current_department(),'')) = 'design'))
          or (i.page = 'fabrica-producao'
              and (public.ob_is_admin() or lower(coalesce(public.ob_current_department(),'')) in ('produção','producao')))
          or (i.page = 'fabrica-instalacoes'
              and (public.ob_is_admin() or lower(coalesce(public.ob_current_department(),'')) in ('instalação','instalacao')))
        )
    )
  )
  with check (
    exists (
      select 1 from public.ob_uni_items i
      where i.id = ob_uni_atividades.item_id
        and (
          (i.page = 'admin-agenda' and (i.owner_id = auth.uid() or public.ob_is_admin()))
          or (i.page in ('design-ficheiros','design-tarefas')
              and (public.ob_is_admin() or lower(coalesce(public.ob_current_department(),'')) = 'design'))
          or (i.page = 'fabrica-producao'
              and (public.ob_is_admin() or lower(coalesce(public.ob_current_department(),'')) in ('produção','producao')))
          or (i.page = 'fabrica-instalacoes'
              and (public.ob_is_admin() or lower(coalesce(public.ob_current_department(),'')) in ('instalação','instalacao')))
        )
    )
  );

-- DELETE — item admin-agenda preserva ob_can_see(owner_id); qualquer
-- outra página só permite a admins.
create policy ob_uni_atividades_delete on public.ob_uni_atividades
  for delete
  using (
    exists (
      select 1 from public.ob_uni_items i
      where i.id = ob_uni_atividades.item_id
        and (
          (i.page = 'admin-agenda' and public.ob_can_see(i.owner_id))
          or (i.page <> 'admin-agenda' and public.ob_is_admin())
        )
    )
  );

commit;
