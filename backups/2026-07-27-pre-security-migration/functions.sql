-- Definições das funções existentes no schema public do projeto Supabase
-- ddzlbmnmsdyodouqxbjx, capturadas em 2026-07-27 antes da reconstrução de segurança.

CREATE OR REPLACE FUNCTION public.isp_get_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT tenant_id FROM isp_profiles WHERE id = auth.uid()
$function$;

CREATE OR REPLACE FUNCTION public.isp_is_tenant_member(tid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (SELECT 1 FROM isp_profiles WHERE id = auth.uid() AND tenant_id = tid)
$function$;

CREATE OR REPLACE FUNCTION public.isp_handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.raw_user_meta_data->>'tenant_id' IS NOT NULL THEN
    INSERT INTO isp_profiles (id, tenant_id, full_name, email, role)
    VALUES (
      NEW.id,
      (NEW.raw_user_meta_data->>'tenant_id')::UUID,
      COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)),
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'role','admin')
    ) ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin new.updated_at = now(); return new; end;
$function$;

CREATE OR REPLACE FUNCTION public.user_company()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT company_id FROM public.profiles WHERE id = auth.uid();
$function$;
