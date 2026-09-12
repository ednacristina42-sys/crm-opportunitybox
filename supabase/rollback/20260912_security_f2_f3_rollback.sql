-- ROLLBACK DE EMERGÊNCIA — F2/F3
-- NÃO aplicar normalmente.
-- Serve exclusivamente para restaurar o estado anterior
-- caso a migration de segurança F2/F3 cause algum problema inesperado.

begin;

-- Restaurar privilégios anon exatamente como estavam antes.
grant select, insert, update
  on table public.ob_crm_dados
  to anon;

-- Restaurar SELECT anónimo do pipeline legado.
create policy ob_crm_dados_select_anon_pipeline
  on public.ob_crm_dados
  for select
  to anon
  using (
    chave = any (
      array[
        'ob-leads'::text,
        'ob-clients'::text,
        'ob-crm-atividades'::text,
        'ob-crm-historico'::text
      ]
    )
  );

-- Restaurar INSERT anónimo exatamente como estava.
create policy ob_crm_dados_insert_anon_pipeline
  on public.ob_crm_dados
  for insert
  to anon
  with check (
    chave = any (
      array[
        'ob-clients'::text,
        'ob-crm-atividades'::text,
        'ob-crm-historico'::text
      ]
    )
  );

-- Restaurar UPDATE anónimo exatamente como estava.
create policy ob_crm_dados_update_anon_pipeline
  on public.ob_crm_dados
  for update
  to anon
  using (
    chave = any (
      array[
        'ob-clients'::text,
        'ob-crm-atividades'::text,
        'ob-crm-historico'::text
      ]
    )
  )
  with check (
    chave = any (
      array[
        'ob-clients'::text,
        'ob-crm-atividades'::text,
        'ob-crm-historico'::text
      ]
    )
  );

-- Restaurar EXECUTE das funções ao estado anterior.
grant execute on function public.ob_can_see(uuid)
  to public, anon, authenticated, service_role;

grant execute on function public.ob_current_role()
  to public, anon, authenticated, service_role;

grant execute on function public.ob_is_admin()
  to public, anon, authenticated, service_role;

grant execute on function public.ob_manages(uuid)
  to public, anon, authenticated, service_role;

grant execute on function public.ob_handle_new_user()
  to public, anon, authenticated, service_role;

commit;
