begin;

drop policy if exists ob_crm_dados_select_anon_pipeline
  on public.ob_crm_dados;

drop policy if exists ob_crm_dados_insert_anon_pipeline
  on public.ob_crm_dados;

drop policy if exists ob_crm_dados_update_anon_pipeline
  on public.ob_crm_dados;

revoke select, insert, update, delete
  on table public.ob_crm_dados
  from anon;

revoke execute on function public.ob_can_see(uuid) from public, anon;
revoke execute on function public.ob_current_role() from public, anon;
revoke execute on function public.ob_is_admin() from public, anon;
revoke execute on function public.ob_manages(uuid) from public, anon;

grant execute on function public.ob_can_see(uuid) to authenticated, service_role;
grant execute on function public.ob_current_role() to authenticated, service_role;
grant execute on function public.ob_is_admin() to authenticated, service_role;
grant execute on function public.ob_manages(uuid) to authenticated, service_role;

revoke execute on function public.ob_handle_new_user()
  from public, anon, authenticated;

grant execute on function public.ob_handle_new_user()
  to service_role;

commit;
