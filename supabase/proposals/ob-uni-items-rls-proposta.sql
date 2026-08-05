-- ============================================================
-- Remediação RLS de public.ob_uni_items
-- PROPOSTA, NÃO APLICADA. Nenhum comando deste ficheiro foi
-- corrido contra a base de dados — é só para revisão.
--
-- Motivo: o Dashboard Comercial (Meu Painel) ia precisar de ler
-- itens de Agenda (page='admin-agenda') para o card "Plano do Dia".
-- Antes disso, auditei a tabela e encontrei RLS totalmente aberta
-- (roles={public}, qual=true) — decisão: corrigir isto primeiro,
-- sem tocar no Dashboard Comercial (que continua sem esse card).
-- ============================================================


-- ------------------------------------------------------------
-- 0) ACHADO CRÍTICO — antes de qualquer RLS ser útil
-- ------------------------------------------------------------
-- O acesso a ob_uni_items (leitura E escrita) não passa pelo cliente
-- Supabase autenticado (crmSBClient()). Usa fetch() direto com a
-- ANON KEY fixa como Authorization (_ORC_SB_KEY / _sbOrcHeaders(),
-- linha ~15226-15229 do index.html):
--
--   headers: { apikey: _ORC_SB_KEY, Authorization: 'Bearer '+_ORC_SB_KEY }
--
-- Isto significa que, hoje, TODAS as chamadas a ob_uni_items chegam
-- à base de dados como role=anon, com auth.uid() = NULL — mesmo que
-- o utilizador esteja autenticado no browser. Qualquer política RLS
-- baseada em auth.uid() (ob_can_see, ob_is_admin, ob_current_role)
-- vai devolver SEMPRE zero linhas / bloquear SEMPRE a escrita para
-- QUALQUER utilizador, incluindo admins, enquanto isto não for
-- corrigido no frontend.
--
-- Isto já foi resolvido antes para ob_orcamentos (ver comentário no
-- index.html, linha ~15232-15236, "Fase 4, Etapa 6"): esse caminho
-- passou a usar crmSBClient().from('ob_orcamentos')... em vez de
-- fetch()+anon key. ob_uni_items ficou deliberadamente de fora
-- dessa etapa ("fora do âmbito desta etapa").
--
-- CONCLUSÃO: a RLS abaixo só produz o efeito pretendido depois de
-- o frontend migrar _sbUniItemsLoadAll / _sbUniItemUpsert /
-- _sbUniItemDelete / _sbUniAtividadeInsert / _sbUniAtividadesLoadAll
-- de fetch()+_ORC_SB_KEY para crmSBClient().from(...), exactamente
-- como já foi feito para orçamentos. Isso é trabalho de FRONTEND,
-- não SQL, e tem de acontecer ANTES (ou no mesmo passo) da secção 2.


-- ------------------------------------------------------------
-- 1) Contexto de dados (confirmado por consulta directa em produção)
-- ------------------------------------------------------------
-- Schema real: id bigint, page text, payload jsonb, updated_at timestamptz.
-- Não existe owner_id nem qualquer FK para ob_profiles.
-- 'page' agrupa 5 usos distintos partilhando a mesma tabela:
--   admin-agenda, design-tarefas, design-ficheiros,
--   fabrica-producao, fabrica-instalacoes.
-- O nome do responsável vive em payload->>'assignee' (texto livre,
-- ex. "Rui Mota", "Paulo Faria") — não é um UUID, é um nome.
--
-- ob_profiles hoje só tem 5 utilizadores reais, todos role admin ou
-- comercial (enum ob_user_role só tem admin/manager/comercial/
-- financeiro — não existe role 'design' nem 'fabrica'). Os
-- departamentos reais em ob_profiles.department são "Admin",
-- "Comercial", "Direcção" — NÃO coincidem com as chaves do menu
-- (DEPT_PAGES) 'Dep. Design' / 'Chão da Fábrica' / 'Gestão
-- Administrativa'. Ou seja: hoje NINGUÉM tem perfil de Design ou
-- Fábrica — essas páginas só têm dados de exemplo/seed, sem
-- utilizadores reais a testar o acesso.
--
-- Verificado também: pelo menos 1 assignee de admin-agenda
-- ("Ricardo Faria") não corresponde a nenhum ob_profiles.full_name
-- existente — provavelmente equipa de instalação sem login no CRM.
-- Uma política por owner_id vai deixar esses itens sem dono
-- reconhecido (visíveis só a admin) até serem reconciliados à mão.


-- ------------------------------------------------------------
-- 2) Nova coluna owner_id (mesmo padrão já usado em ob_orcamentos)
-- ------------------------------------------------------------
alter table public.ob_uni_items
  add column if not exists owner_id uuid references public.ob_profiles(id);

-- Backfill best-effort por nome — NÃO é fiável a 100% (nomes podem
-- mudar, colidir, ou não ter perfil, como "Ricardo Faria" acima).
-- Correr e depois conferir manualmente quantas linhas ficaram com
-- owner_id null antes de avançar para a secção 3.
update public.ob_uni_items u
set owner_id = p.id
from public.ob_profiles p
where u.owner_id is null
  and p.full_name = (u.payload->>'assignee');

-- Query de verificação a correr depois do backfill (não uma política,
-- só um SELECT de conferência manual):
-- select page, payload->>'assignee' as assignee, count(*)
-- from public.ob_uni_items where owner_id is null
-- group by page, assignee order by page;


-- ------------------------------------------------------------
-- 3) Políticas RLS
-- ------------------------------------------------------------
-- Abordagem faseada, deliberadamente: fecha já o caso concreto que
-- motivou esta auditoria (admin-agenda a vazar dados de todos os
-- comerciais/departamentos para qualquer sessão), sem inventar uma
-- regra de departamento para Design/Fábrica que ninguém decidiu
-- ainda (e que hoje não tem nenhum utilizador real para validar).

drop policy if exists ob_uni_items_open on public.ob_uni_items;

-- SELECT — admin/manager vêem tudo; cada utilizador vê sempre os
-- seus próprios itens (owner_id); páginas que ainda não têm um
-- modelo de departamento decidido (design-tarefas, design-ficheiros,
-- fabrica-producao, fabrica-instalacoes) mantêm-se visíveis a
-- qualquer utilizador AUTENTICADO — mesmo comportamento de hoje
-- nessas páginas, mas já sem acesso anónimo. Isto é uma decisão
-- explícita de âmbito, não um esquecimento: ver ponto 6 do relatório
-- (mensagem de chat) para o que falta decidir.
create policy ob_uni_items_select on public.ob_uni_items
  for select to authenticated
  using (
    public.ob_is_admin()
    or public.ob_current_role() = 'manager'
    or owner_id = auth.uid()
    or page <> 'admin-agenda'
  );

-- INSERT — só autenticado, e só pode criar-se a si próprio como dono
-- (ou admin a criar em nome de outro, ex. atribuir agenda a um
-- técnico sem login).
create policy ob_uni_items_insert on public.ob_uni_items
  for insert to authenticated
  with check (
    public.ob_is_admin() or owner_id = auth.uid() or owner_id is null
  );

-- UPDATE/DELETE — dono, admin, ou manager do dono.
create policy ob_uni_items_update on public.ob_uni_items
  for update to authenticated
  using (public.ob_can_see(owner_id))
  with check (public.ob_can_see(owner_id));

create policy ob_uni_items_delete on public.ob_uni_items
  for delete to authenticated
  using (public.ob_can_see(owner_id));


-- ------------------------------------------------------------
-- 4) ob_uni_atividades — mesma tabela-irmã, mesmo problema
-- ------------------------------------------------------------
-- Não incluída nesta proposta em detalhe (fora do pedido original,
-- que foi só "ob_uni_items"), mas é usada pelo mesmo caminho
-- fetch()+anon key (_sbUniAtividadeInsert/_sbUniAtividadesLoadAll) e
-- deve ser auditada com a mesma lógica antes de dar como resolvido.
-- select policyname, roles, cmd, qual from pg_policies
-- where tablename='ob_uni_atividades';   -- ainda não corrido.


-- ------------------------------------------------------------
-- 5) ROLLBACK
-- ------------------------------------------------------------
-- drop policy if exists ob_uni_items_select on public.ob_uni_items;
-- drop policy if exists ob_uni_items_insert on public.ob_uni_items;
-- drop policy if exists ob_uni_items_update on public.ob_uni_items;
-- drop policy if exists ob_uni_items_delete on public.ob_uni_items;
-- create policy ob_uni_items_open on public.ob_uni_items
--   for all to public using (true) with check (true);
-- -- owner_id pode ficar (coluna extra não parte nada); se se quiser
-- -- reverter por completo:
-- -- alter table public.ob_uni_items drop column if exists owner_id;
