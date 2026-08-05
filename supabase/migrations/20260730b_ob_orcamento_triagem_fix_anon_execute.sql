-- Correção aplicada em produção logo após 20260730_ob_orcamento_triagem.sql:
-- "revoke all on function ... from public" não remove o EXECUTE que o
-- schema public concede por default privilege diretamente a "anon"
-- (grant nomeado, não herdado de PUBLIC) em qualquer função nova criada
-- pelo role "postgres". Confirmado por auditoria (has_function_privilege)
-- que "anon" tinha EXECUTE nas 5 RPCs logo após a primeira migration.
-- Revoga agora explicitamente de anon.

revoke execute on function public.fu_reativar_simples(text) from anon;
revoke execute on function public.fu_classificar_e_reativar(text, text, text) from anon;
revoke execute on function public.fu_classificar(text, text, text) from anon;
revoke execute on function public.fu_desativar_followup(text) from anon;
revoke execute on function public.fu_confirmar_estado(text, text) from anon;
