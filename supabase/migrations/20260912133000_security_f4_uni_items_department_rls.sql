-- F4 — permissões de ob_uni_items por departamento.
-- NÃO aplicar sem revisão. Depende de existirem perfis ativos reais para
-- Design/Produção/Instalação (ver trava de segurança abaixo) — caso
-- contrário aborta antes de tocar em qualquer policy.

begin;

-- 1) public.ob_current_department() — department de ob_profiles para
-- auth.uid(), mesmo padrão de segurança de ob_can_see/ob_is_admin
-- (security definer + search_path fixo, para RLS não poder ser
-- contornada por um search_path manipulado pela sessão chamadora).
create or replace function public.ob_current_department()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select department
  from public.ob_profiles
  where id = auth.uid();
$$;

revoke execute on function public.ob_current_department() from public, anon;
grant execute on function public.ob_current_department() to authenticated, service_role;

-- 2) Trava de segurança — obrigatória: impede que esta migration seja
-- aplicada antes de existirem utilizadores operacionais configurados
-- para os 3 departamentos que passam a ter regras próprias. Sem isto,
-- aplicar a migration cedo demais bloquearia Design/Produção/Instalação
-- por completo (ninguém teria o department certo para passar na policy).
do $$
begin
  if not exists (
    select 1
    from public.ob_profiles
    where active = true
      and lower(coalesce(department,'')) = 'design'
  ) then
    raise exception 'F4 blocked: no active Design profile configured';
  end if;

  if not exists (
    select 1
    from public.ob_profiles
    where active = true
      and lower(coalesce(department,'')) in ('produção','producao')
  ) then
    raise exception 'F4 blocked: no active Producao profile configured';
  end if;

  if not exists (
    select 1
    from public.ob_profiles
    where active = true
      and lower(coalesce(department,'')) in ('instalação','instalacao')
  ) then
    raise exception 'F4 blocked: no active Instalacao profile configured';
  end if;
end $$;

-- 3) Policies de public.ob_uni_items — substituem as 4 policies atuais
-- (ob_uni_items_select/_insert/_update/_delete, ver
-- 20260811093118_ob_uni_items_rls_por_owner.sql) pela mesma matriz, só
-- que agora admin-agenda continua exatamente como estava e as páginas
-- operacionais (design-ficheiros/design-tarefas/fabrica-producao/
-- fabrica-instalacoes) passam a exigir o department correto (ou admin),
-- em vez de "qualquer authenticated". ob_uni_atividades e ob_profiles
-- não são tocados aqui (ob_uni_atividades é do F5).
drop policy if exists ob_uni_items_select on public.ob_uni_items;
drop policy if exists ob_uni_items_insert on public.ob_uni_items;
drop policy if exists ob_uni_items_update on public.ob_uni_items;
drop policy if exists ob_uni_items_delete on public.ob_uni_items;

-- SELECT — admin-agenda mantém-se exatamente ob_can_see(owner_id);
-- qualquer outra página continua visível a qualquer authenticated.
create policy ob_uni_items_select on public.ob_uni_items
  for select
  using (
    (page = 'admin-agenda' and public.ob_can_see(owner_id))
    or (page <> 'admin-agenda' and auth.uid() is not null)
  );

-- INSERT — admin-agenda mantém a lógica atual (dono ou admin); as 3
-- páginas operacionais passam a exigir admin OU o department certo;
-- qualquer outra página nunca é permitida automaticamente (nenhuma
-- cláusula cobre esse caso, por isso cai em false por omissão).
create policy ob_uni_items_insert on public.ob_uni_items
  for insert
  with check (
    (page = 'admin-agenda' and (owner_id = auth.uid() or public.ob_is_admin()))
    or (page in ('design-ficheiros','design-tarefas')
        and (public.ob_is_admin() or lower(coalesce(public.ob_current_department(),'')) = 'design'))
    or (page = 'fabrica-producao'
        and (public.ob_is_admin() or lower(coalesce(public.ob_current_department(),'')) in ('produção','producao')))
    or (page = 'fabrica-instalacoes'
        and (public.ob_is_admin() or lower(coalesce(public.ob_current_department(),'')) in ('instalação','instalacao')))
  );

-- UPDATE — mesma matriz do INSERT em USING e em WITH CHECK; admin-agenda
-- preserva exatamente USING ob_can_see(owner_id) e WITH CHECK
-- (owner_id = auth.uid() OR ob_is_admin()), como pedido.
create policy ob_uni_items_update on public.ob_uni_items
  for update
  using (
    (page = 'admin-agenda' and public.ob_can_see(owner_id))
    or (page in ('design-ficheiros','design-tarefas')
        and (public.ob_is_admin() or lower(coalesce(public.ob_current_department(),'')) = 'design'))
    or (page = 'fabrica-producao'
        and (public.ob_is_admin() or lower(coalesce(public.ob_current_department(),'')) in ('produção','producao')))
    or (page = 'fabrica-instalacoes'
        and (public.ob_is_admin() or lower(coalesce(public.ob_current_department(),'')) in ('instalação','instalacao')))
  )
  with check (
    (page = 'admin-agenda' and (owner_id = auth.uid() or public.ob_is_admin()))
    or (page in ('design-ficheiros','design-tarefas')
        and (public.ob_is_admin() or lower(coalesce(public.ob_current_department(),'')) = 'design'))
    or (page = 'fabrica-producao'
        and (public.ob_is_admin() or lower(coalesce(public.ob_current_department(),'')) in ('produção','producao')))
    or (page = 'fabrica-instalacoes'
        and (public.ob_is_admin() or lower(coalesce(public.ob_current_department(),'')) in ('instalação','instalacao')))
  );

-- DELETE — admin-agenda preserva ob_can_see(owner_id); qualquer outra
-- página operacional passa a exigir sempre ob_is_admin() (mais restritivo
-- que antes, que permitia a qualquer authenticated).
create policy ob_uni_items_delete on public.ob_uni_items
  for delete
  using (
    (page = 'admin-agenda' and public.ob_can_see(owner_id))
    or (page <> 'admin-agenda' and public.ob_is_admin())
  );

commit;
