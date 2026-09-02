# Agendamento da sincronização TOConline → CRM

**Estado: PREPARADO, NÃO ACTIVO.** Nada abaixo foi executado na base de dados.
Activar só depois de a sincronização manual estar validada em produção.

## Como funciona

Uma tarefa `pg_cron` chama a Edge Function `crm-toconline?resource=sync` uma vez
por hora, autenticando-se com `x-api-key` (via servidor-para-servidor). Não há
polling no browser e não há Make em lado nenhum: o browser só lê o resultado em
`ob_crm_dados.chave = 'toc-sync-estado'`.

A mesma função que o botão "Sincronizar agora" usa. É deliberado — se o
agendamento corresse outro caminho, as duas vias podiam divergir sem ninguém
dar por isso.

## Pré-requisitos (ainda por fazer)

Duas extensões que **não estão instaladas** neste projecto. Instalá-las é uma
migration, por isso fica para quando a Edna autorizar:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
```

A gateway key não pode ficar em texto simples numa definição de cron. Guardar
no Vault (`supabase_vault`, já instalado):

```sql
select vault.create_secret('<TOC_GATEWAY_KEY>', 'toc_gateway_key',
                           'Chave da Edge Function crm-toconline');
```

## Activação (executar só quando autorizado)

```sql
select cron.schedule(
  'toconline-sync-horario',
  '17 * * * *',                        -- minuto 17, para não bater no topo da hora
  $$
  select net.http_get(
    url     := 'https://ddzlbmnmsdyodouqxbjx.supabase.co/functions/v1/crm-toconline?resource=sync',
    headers := jsonb_build_object(
      'x-api-key', (select decrypted_secret from vault.decrypted_secrets
                     where name = 'toc_gateway_key')),
    timeout_milliseconds := 120000     -- a recolha completa leva ~20-40s
  );
  $$
);
```

## Verificar

```sql
select jobid, jobname, schedule, active from cron.job;
select * from cron.job_run_details order by start_time desc limit 10;
select dados->>'ts', dados->>'status', dados->>'atualizados', dados->>'conflitos'
  from ob_crm_dados where chave = 'toc-sync-estado';
```

## Desactivar

```sql
select cron.unschedule('toconline-sync-horario');
```

## Porque é seguro correr de hora a hora

A sincronização é idempotente: só escreve em campos vazios, e depois da
primeira passagem já não há campos vazios para preencher. A segunda execução
devolve `atualizados: 0` e **não regrava** `ob-clients` — a gravação só
acontece quando há mesmo alterações. Testado em `ef12.mjs`.
