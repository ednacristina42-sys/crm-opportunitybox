begin;

grant execute on function public.isp_get_tenant_id()
  to public, anon, authenticated, service_role;

grant execute on function public.isp_is_tenant_member(uuid)
  to public, anon, authenticated, service_role;

grant execute on function public.isp_handle_new_user()
  to public, anon, authenticated, service_role;

grant execute on function public.user_company()
  to public, anon, authenticated, service_role;

commit;
