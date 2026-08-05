-- ============================================================
-- Fase 1 do Follow-up: registo de emails (MODO SIMULAÇÃO)
-- PROPOSTA, NAO APLICADA. Sem cron, sem chamada à Resend.
-- ============================================================

create table public.ob_followup_emails (
  id uuid primary key default gen_random_uuid(),

  orcamento_id text not null references public.ob_orcamentos(id),

  -- null só quando estado='ignorado' e a decisão nem chegou a
  -- escolher modelo (ex.: email inválido).
  modelo text,

  destinatario text not null,
  assunto text not null,

  estado text not null default 'simulado'
    check (estado in ('simulado','enviado','erro','ignorado')),
  motivo_ignorado text,

  resend_id text,
  erro text,

  -- Dia a que esta avaliação se refere (definido pela Edge Function,
  -- não pelo relógio de inserção) — é a base da deduplicação. Nunca
  -- 'criado_em::date': um valor explícito evita acoplar a regra de
  -- negócio ao instante exato da escrita.
  data_referencia date not null,

  criado_em timestamptz not null default now(),
  enviado_em timestamptz,
  criado_por uuid references public.ob_profiles(id),

  constraint ob_followup_emails_modelo_valido check (
    (estado = 'ignorado' and modelo is null)
    or
    (estado <> 'ignorado' and modelo in (
      'primeiro_lembrete','lembrete_intermedio',
      'valor_alto_personalizado','reativacao'
    ))
  )
);

-- Deduplicação: no máximo 1 linha por orçamento+modelo+dia de
-- referência — só para linhas que representam uma decisão real
-- (simulado/enviado/erro). Linhas 'ignorado' têm o seu próprio limite,
-- separado, para não competir pelo mesmo índice com modelo=null.
-- IMPORTANTE: isto é uma barreira de "não duplicar no mesmo dia", não
-- "não repetir para sempre" — um 'simulado' de hoje não impede nada
-- amanhã, nem impede um envio real no futuro (essa regra vive na
-- lógica da Edge Function, não aqui — ver comentário nela).
create unique index ob_followup_emails_dedup_decisao
  on public.ob_followup_emails (orcamento_id, modelo, data_referencia)
  where estado <> 'ignorado';

create unique index ob_followup_emails_dedup_ignorado
  on public.ob_followup_emails (orcamento_id, data_referencia)
  where estado = 'ignorado';

create index ob_followup_emails_orcamento_idx
  on public.ob_followup_emails (orcamento_id, criado_em desc);

comment on table public.ob_followup_emails is
  'Registo de avaliações de email de follow-up (Fase 1). Em modo simulação, todas as linhas ficam estado=simulado — nenhum email é enviado.';

-- ------------------------------------------------------------
-- RLS — mesmo padrão da Fase 1.6: SELECT via ob_can_see; escrita só
-- pela Edge Function (service_role, que ignora RLS por definição) —
-- sem policy de INSERT/UPDATE/DELETE para authenticated.
-- ------------------------------------------------------------

alter table public.ob_followup_emails enable row level security;

create policy ob_followup_emails_select on public.ob_followup_emails
  for select to authenticated
  using (
    exists (
      select 1 from public.ob_orcamentos o
      where o.id = orcamento_id and public.ob_can_see(o.owner_id)
    )
  );

revoke all on public.ob_followup_emails from anon;
revoke insert, update, delete, truncate on public.ob_followup_emails from authenticated;
grant select on public.ob_followup_emails to authenticated;

-- ------------------------------------------------------------
-- ROLLBACK
-- ------------------------------------------------------------
-- drop table if exists public.ob_followup_emails;
-- Isolado: nenhuma FK de fora aponta para esta tabela.
