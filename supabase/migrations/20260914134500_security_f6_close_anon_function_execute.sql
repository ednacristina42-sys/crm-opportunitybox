begin;

revoke execute on function public.isp_get_tenant_id() from public, anon;
revoke execute on function public.isp_is_tenant_member(uuid) from public, anon;
revoke execute on function public.isp_handle_new_user() from public, anon;
revoke execute on function public.user_company() from public, anon;

grant execute on function public.isp_get_tenant_id() to authenticated, service_role;
grant execute on function public.isp_is_tenant_member(uuid) to authenticated, service_role;
grant execute on function public.isp_handle_new_user() to authenticated, service_role;
grant execute on function public.user_company() to authenticated, service_role;

commit;
