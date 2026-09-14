-- ============================================================
-- G1 (docs/final-gaps-audit.md) -- Tabela canonica para as atividades
-- de CRM/vendas, substituindo o blob unico ob_crm_dados['ob-crm-atividades']
-- (1234 objetos, RLS so por role, nao por dono -- qualquer comercial recebe
-- no browser as atividades de TODOS os colegas).
--
-- PREPARADA, NAO APLICADA. Nao foi corrida via apply_migration nesta
-- entrega -- so escrita em ficheiro, para revisao/aplicacao numa sessao
-- futura. A chave antiga 'ob-crm-atividades' NAO e apagada por esta
-- migration (fica intacta em ob_crm_dados) e o frontend NAO foi alterado
-- para escrever aqui (sem dual-write nesta entrega).
--
-- Auditoria de dados que fundamenta esta migration (SELECT, so leitura,
-- projeto ddzlbmnmsdyodouqxbjx, 2026-09-14):
--   total de atividades no blob ......................... 1234
--   com orcId preenchido ................................. 767 (62,2%)
--   com leadId preenchido ................................ 469 (38,0%)
--   com autor preenchido ................................ 1234 (100%)
--   orcId cruzado com ob_orcamentos.num -> owner_id 100%
--     resolvido (767/767 correspondencias, 0 sem match) ... 767 (62,2%)
--   leadId cruzado com donos -- NAO POSSIVEL com seguranca:
--     ob_leads (tabela canonica) tem 0 registos; a chave
--     ob_crm_dados['ob-leads'] (fonte real) tem hoje só 1 lead
--     (substituida sempre, nunca merge -- ver canonical-data-map.md);
--     apenas 22/469 leadId de atividades correspondem a esse unico lead
--     vivo, e mesmo esse lead tem 2 "assignees" (nao um dono unico) --
--     nao ha correspondencia inequivoca lead->owner_id para nenhuma
--     atividade. NAO foi inventada nenhuma associacao.
--   sem orcId e sem leadId ................................. 1 (0,08%)
--   TOTAL SEM DONO DERIVAVEL COM SEGURANCA (nem orcId nem
--     leadId util) ......................................... 467 (37,8%)
--     dos quais por tipo: TopHojeItem 345, nota 65, estado 19,
--     criado 15, editado 13, apagado 6, adjudicacao 2, Chamada 1,
--     orcamento 1.
--
-- Decisao: só as 767 atividades com owner_id 100% seguro (via orcId ->
-- ob_orcamentos.owner_id) são pré-carregadas pelo backfill abaixo. As
-- 467 restantes ficam de fora desta migração inicial -- continuam
-- disponíveis apenas na chave antiga ob_crm_dados['ob-crm-atividades']
-- (que não é tocada) até haver um critério seguro de derivação (ex.: um
-- dia em que 'autor' possa ser resolvido com confiança a um
-- ob_profiles.id -- isso NÃO é feito aqui porque reintroduziria o mesmo
-- problema de fundo do Bug B1: comparar por nome de texto, não por uuid).
-- A tabela aceita owner_id NULL para estes casos futuros e a policy de
-- SELECT só mostra linhas com owner_id NULL a administradores.
-- ============================================================

create table public.ob_crm_atividades (
  id uuid primary key default gen_random_uuid(),
  legacy_ts text not null unique, -- ts original (string ISO) de crmAtividades -- chave natural, evita duplicar num re-run do backfill
  ts timestamptz not null,
  tipo text not null,
  texto text not null,
  autor text, -- nome em texto livre, so para exibicao (NAO usar para decidir dono/permissao -- essa e exatamente a causa raiz do Bug B1)
  owner_id uuid references public.ob_profiles(id), -- nullable: NULL = dono nao derivavel com seguranca (ver nota acima), so visivel a admin
  orc_num text, -- ob_orcamentos.num na origem (sem FK fisica -- num nao tem constraint unique na tabela ob_orcamentos hoje)
  lead_id text, -- id do lead na origem (ob-leads), sem FK -- ob_leads (tabela) esta vazia, sem relacao fiavel
  resultado text,
  extra jsonb, -- campos adicionais confirmados na auditoria: acao, canal, clienteId, data, due, origem, prioridade, tags, e o objecto 'extra' original (TopHojeItem)
  created_at timestamptz not null default now()
);

comment on table public.ob_crm_atividades is
  'Tabela canonica de atividades CRM/vendas (G1) -- substitui gradualmente ob_crm_dados[''ob-crm-atividades'']. owner_id NULL = dono nao derivavel com seguranca na migracao inicial (so visivel a admin). PREPARADA, sem dual-write do frontend nesta entrega.';

create index ob_crm_atividades_owner_idx on public.ob_crm_atividades (owner_id);
create index ob_crm_atividades_orc_num_idx on public.ob_crm_atividades (orc_num) where orc_num is not null;
create index ob_crm_atividades_lead_id_idx on public.ob_crm_atividades (lead_id) where lead_id is not null;
create index ob_crm_atividades_ts_idx on public.ob_crm_atividades (ts desc);

alter table public.ob_crm_atividades enable row level security;

-- SELECT: mesmo padrao ja usado em ob_orcamentos/ob_orcamento_triagem
-- (ob_can_see = dono, admin, ou manager da equipa). Linhas com owner_id
-- NULL (dono nao derivavel) so sao visiveis a admin -- nunca expostas a
-- um comercial qualquer (o oposto do problema original: RLS so por role).
create policy ob_crm_atividades_select on public.ob_crm_atividades
  for select to authenticated
  using (
    (owner_id is not null and public.ob_can_see(owner_id))
    or (owner_id is null and public.ob_is_admin())
  );

-- Sem GRANTs de escrita nesta entrega -- so leitura. Uma fase futura que
-- ligue o frontend a esta tabela (dual-write, depois corte da chave
-- antiga) precisa de RPCs SECURITY DEFINER equivalentes a crmAddAtividade/
-- crmDeleteAtividade, no mesmo padrao das RPCs fu_* ja existentes -- fora
-- do ambito desta entrega.
revoke all on public.ob_crm_atividades from anon;
revoke all on public.ob_crm_atividades from authenticated;
grant select on public.ob_crm_atividades to authenticated;

-- ------------------------------------------------------------
-- BACKFILL (idempotente via ON CONFLICT (legacy_ts) DO NOTHING) -- só as
-- atividades cujo owner_id é 100% seguro (orcId casa com um
-- ob_orcamentos.num real, cujo owner_id já vem preenchido). NÃO insere
-- nenhuma linha para as 467 sem derivação segura -- essas continuam só em
-- ob_crm_dados['ob-crm-atividades'], que não é alterada por este script.
-- ------------------------------------------------------------
insert into public.ob_crm_atividades
  (legacy_ts, ts, tipo, texto, autor, owner_id, orc_num, lead_id, resultado, extra)
select
  a->>'ts' as legacy_ts,
  (a->>'ts')::timestamptz as ts,
  a->>'tipo' as tipo,
  a->>'texto' as texto,
  a->>'autor' as autor,
  o.owner_id,
  a->>'orcId' as orc_num,
  nullif(a->>'leadId','') as lead_id,
  nullif(a->>'resultado','') as resultado,
  jsonb_strip_nulls(jsonb_build_object(
    'acao', a->'acao', 'canal', a->'canal', 'clienteId', a->'clienteId',
    'data', a->'data', 'due', a->'due', 'origem', a->'origem',
    'prioridade', a->'prioridade', 'tags', a->'tags', 'extra', a->'extra'
  )) as extra
from public.ob_crm_dados d
cross join lateral jsonb_array_elements(d.dados) a
join public.ob_orcamentos o on o.num = (a->>'orcId')
where d.chave = 'ob-crm-atividades'
  and a->>'orcId' is not null and a->>'orcId' <> ''
  and a->>'ts' is not null and a->>'ts' <> ''
on conflict (legacy_ts) do nothing;
