# Fase 2 — Execução faseada (migração a migração)

Resposta ao pedido de 2026-07-27: sequência detalhada das 8 migrations, testes
preparados, correção segura do webhook Make.com, e prévia da associação dos 577
orçamentos antigos. **Nada neste documento foi executado além do que está
explicitamente marcado como "já corrido (só leitura)".** Nenhuma migration nova,
nenhuma alteração de RLS antiga, nenhuma atualização de dados e nenhum deploy foi
feito.

---

## 1. As 8 migrations — sequência detalhada

| # | Nome exato | Objetivo | Tabelas afetadas | Impacto esperado | Risco | Teste após execução | Rollback |
|---|---|---|---|---|---|---|---|
| 1 | `ob_orcamentos_rename_owner_and_audit_columns` | Renomear `assigned_user_id`→`owner_id` e acrescentar `updated_by` em `ob_orcamentos`, para alinhar com a nomenclatura aprovada | `ob_orcamentos` | Nenhum dado muda; nenhuma query existente do CRM lê estas colunas ainda (não usadas em produção) | **Baixo** — coluna nova/renomeada, sem leitores atuais | `select column_name from information_schema.columns where table_name='ob_orcamentos'` confirma `owner_id` e `updated_by` presentes; `select count(*) from ob_orcamentos` continua 577 | `alter table ob_orcamentos rename column owner_id to assigned_user_id; alter table ob_orcamentos drop column updated_by;` |
| 2 | `ob_new_tables_rename_owner_and_audit_columns` | O mesmo em `ob_clientes`, `ob_leads`, `ob_tasks`, `ob_visitas` (ainda vazias) | `ob_clientes`, `ob_leads`, `ob_tasks`, `ob_visitas` | Nenhum — tabelas sem dados | **Baixo** | `select count(*) from ob_clientes` (e restantes) continua 0; colunas confirmadas via `information_schema` | inverso, coluna a coluna |
| 3 | `ob_policies_rename_owner_references` | Recriar as políticas RLS das 5 tabelas acima para referirem `owner_id` em vez de `assigned_user_id` (necessário depois de #1/#2, senão as políticas ficam a apontar para uma coluna que deixou de existir) | `ob_profiles`(n/a, não usa esta coluna), `ob_clientes`, `ob_leads`, `ob_tasks`, `ob_visitas`, `ob_orcamentos`(sem política nova ainda, só preparado) | Sem alteração de comportamento — mesma lógica, novo nome de coluna | **Baixo**, mas **depende de #1 e #2 terem corrido primeiro** (ordem obrigatória) | `select * from pg_policies where tablename in (...)` confirma `qual`/`with_check` a referir `owner_id` | recriar as políticas com o nome antigo (`assigned_user_id`) |
| 4 | `ob_tasks_restrict_delete_to_admin` | Fechar a exceção atual que permite a quem criou uma tarefa apagá-la — fica só admin, alinhado com "sem DELETE físico para não-admin" | `ob_tasks` | Comercial deixa de conseguir apagar as próprias tarefas (tinha essa exceção só aqui, nenhuma outra tabela nova tem) | **Baixo** | login como comercial de teste, tentar `DELETE` numa tarefa própria → deve falhar (RLS) | `drop policy ob_tasks_delete; create policy ob_tasks_delete on ob_tasks for delete using (ob_is_admin() or created_by = auth.uid());` |
| 5 | `ob_soft_delete_columns` | Preparar `deleted_at`/`deleted_by` em `ob_orcamentos`, `ob_clientes`, `ob_leads`, `ob_tasks`, `ob_visitas` — **só as colunas**, sem alterar nenhuma política de SELECT ainda (isso seria uma migração `5b` separada, não incluída aqui) | as 5 tabelas | Nenhum — colunas novas, nulas, nenhuma política as usa ainda | **Baixo** | colunas confirmadas via `information_schema`; `select count(*) from ob_orcamentos where deleted_at is not null` = 0 | `alter table ... drop column deleted_at, drop column deleted_by;` nas 5 tabelas |
| 6 | `ob_handle_new_user_trigger` | Criar a função/trigger que gera automaticamente uma linha em `ob_profiles` quando alguém aceita um convite do Supabase Auth (mecanismo de convite — não cria nenhuma conta por si só) | `ob_profiles` (via trigger em `auth.users`) | Nenhum até haver um convite real — função fica pronta mas inativa na prática | **Baixo** | inserir manualmente um utilizador de teste em `auth.users` (via convite real de teste, não SQL direto) e confirmar que aparece em `ob_profiles` | `drop trigger ob_on_auth_user_created on auth.users; drop function ob_handle_new_user();` |
| 7 | `ob_orcamentos_owner_backfill` | Preencher `owner_id` nos 577 orçamentos existentes, um `UPDATE` por vendedor confirmado (ver prévia na secção 3) | `ob_orcamentos` (dados, não estrutura) | Preenche `owner_id` para os registos com correspondência aprovada; o resto fica `NULL` | **Médio** — é a primeira migração que toca em dados reais de produção (embora sem apagar/sobrescrever nada, só preencher uma coluna nova) | `select vendedor, owner_id, count(*) from ob_orcamentos group by 1,2` confirma que cada vendedor aprovado ficou com o `owner_id` certo, e que a soma continua 577 | `update ob_orcamentos set owner_id = null where owner_id in (...);` — reversível a 100%, não toca em `vendedor` nem em mais nenhum campo |
| 8 | `ob_orcamentos_tighten_rls` | Substituir a política aberta `ob_orcamentos_open` pelas políticas reais (admin tudo; comercial só o que é seu; sem DELETE físico para não-admin) | `ob_orcamentos` (política) | **Este é o corte real** — a partir daqui o acesso deixa de ser "toda a gente com a chave anon vê tudo" | **Alto** — só deve correr depois de #7 estar revisto e da Fase 4 (app já autenticado) estar pronta, senão a app deixa de conseguir ler os orçamentos | repetir os 7 cenários de teste (comercial A/B, admin, URL direto) antes de considerar concluído | `drop policy ob_orcamentos_select; drop policy ob_orcamentos_insert; drop policy ob_orcamentos_update; create policy ob_orcamentos_open on ob_orcamentos for all using (true) with check (true);` |

**Ordem obrigatória:** 1 e 2 antes de 3 (dependência de nomes de coluna). 7 só depois da
prévia da secção 3 estar aprovada nome a nome. 8 só depois de 7 estar concluído e
revisto — e, conforme combinado, **nenhuma migration que toque `ob_stock`,
`ob_despesas`, `ob_crm_dados` ou nas políticas de `ob_orcamentos` corre sem nova
aprovação explícita**, independentemente desta tabela.

---

## 2. Testes preparados (não corridos — dependem de contas reais existirem)

Script de validação, pronto a usar assim que houver pelo menos 1 conta admin + 2
contas comerciais de teste (secção 5):

1. **Isolamento entre comerciais** — autenticar como Comercial A (`POST /auth/v1/token?grant_type=password`
   para obter um JWT), criar um cliente em `ob_clientes` com esse JWT; autenticar como
   Comercial B, tentar `GET /rest/v1/ob_clientes` → o cliente do A não deve aparecer.
2. **Acesso direto por ID** — Comercial B tenta `GET /rest/v1/ob_clientes?id=eq.<id-do-cliente-do-A>`
   diretamente → deve devolver `[]` (RLS bloqueia ao nível da linha, não é "escondido na UI").
3. **Admin vê tudo** — autenticar como Edna, `GET /rest/v1/ob_clientes` → devolve os
   registos de A e de B.
4. **Edição/eliminação** — Comercial B tenta `PATCH`/`DELETE` num registo do A →
   ambos devem falhar (403/RLS); Comercial A tenta `DELETE` num registo próprio → deve
   falhar também (sem DELETE físico, só admin).
5. **Logout** — depois de `POST /auth/v1/logout`, o token antigo deixa de ser aceite
   em qualquer pedido autenticado.
6. **Chave nunca exposta** — grep ao `index.html` publicado por `service_role` ou por
   qualquer segredo novo introduzido nesta fase (já corrido na Fase 1 para o estado
   atual; repetir depois da Fase 4 alterar o ficheiro).
7. **`get_advisors(type="security")`** depois de cada lote de migrações — já usado nas
   Fases 1 e 2 para confirmar que as novas funções não têm o aviso de "search_path
   mutável" que as funções antigas tinham.

---

## 3. Correção segura do webhook Make.com (proposta — nada foi alterado ainda)

### O que encontrei

- `ob_despesas` tem hoje 3 políticas para o papel `anon`: `anon insert`, `anon select`,
  `anon update` — todas `USING/WITH CHECK (true)`. O único registo existente tem
  `origem: "Make Webhook (teste)"`.
- Vasculhei a conta Make.com (organização "My Organization", team "My Team") — há **20
  scenarios**, nenhum com nome que mencione "despesas". O mais parecido em propósito
  (`OB CRM → TOConline (Faturas)`) está **inativo** (`isActive: false`) e lida com
  faturas, não despesas.
- **Não consegui confirmar com certeza qual scenario (se algum ativo) escreve em
  `ob_despesas`** — o registo existente sugere um teste manual (via Postman/curl, ou um
  scenario entretanto apagado/renomeado) mais do que uma automação viva. Não quis abrir
  os 20 blueprints um a um só para procurar isto às cegas.
- Encontrei sim um padrão já existente e testado no mesmo projeto Supabase: a Edge
  Function `crm-lead-intake` (ativa), que recebe leads do WhatsApp via Make.com e usa a
  `service_role key` **só dentro da função** (nunca exposta), lendo `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`.
  Vou seguir o mesmo padrão para despesas, com uma proteção extra por serem dados
  financeiros.

**Antes de tocar em `ob_despesas`, preciso que confirmes**: qual é, de facto, o
scenario Make.com (se ainda existir) que escreve nesta tabela — o nome exato ou o
`hookId`. Consegues ver isso mais depressa na tua conta Make do que eu a abrir 20
blueprints. Se não houver nenhum scenario vivo (só foi um teste único), o risco de
apertar `ob_despesas` desce drasticamente e digo isso já na próxima ronda.

### Solução proposta: Edge Function + segredo partilhado

Nova função `ob-despesas-webhook` no projeto `ddzlbmnmsdyodouqxbjx` (**não criada
ainda** — código pronto abaixo, a aguardar aprovação para `deploy_edge_function`):

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Segredo dedicado a este webhook — definido como Edge Function secret no
// Supabase (nunca no repositório, nunca no HTML, nunca no corpo do pedido do
// Make.com — só no cabeçalho, que o Make guarda encriptado do lado dele).
const WEBHOOK_SECRET = Deno.env.get("MAKE_DESPESAS_SECRET")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  if (req.headers.get("x-make-secret") !== WEBHOOK_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const despesa = {
    funcionario: String(body.funcionario || "").trim(),
    data: String(body.data || "").trim(),
    categoria: String(body.categoria || "").trim(),
    descricao: String(body.descricao || "").trim(),
    valor: Number(body.valor) || 0,
    metodo_pagamento: String(body.metodo_pagamento || "").trim(),
    estado: "Pendente",
    origem: "Make Webhook",
  };
  if (!despesa.funcionario || !despesa.valor) {
    return json({ error: "funcionario e valor são obrigatórios" }, 400);
  }

  const r = await fetch(`${SB_URL}/rest/v1/ob_despesas`, {
    method: "POST",
    headers: {
      apikey: SB_SERVICE_KEY,
      Authorization: `Bearer ${SB_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(despesa),
  });
  if (!r.ok) return json({ error: "falha ao gravar despesa" }, 502);
  return json({ ok: true, despesa: (await r.json())[0] });
});
```

### Passo a passo para pôr isto a funcionar (nenhum passo executado ainda)

1. Aprovar o código acima (ou pedir ajustes).
2. Eu gero um segredo aleatório forte e crio-o como Edge Function secret
   (`MAKE_DESPESAS_SECRET`) no Supabase — nunca fica em texto visível para mim depois
   de o definir, e nunca vai para o Git.
3. Eu faço `deploy_edge_function` desta função (fica ativa, mas **não** substitui nada
   ainda — é só uma nova função disponível).
4. Tu (ou eu, se preferires) reconfiguras o módulo HTTP do scenario Make.com em causa:
   URL passa a ser `https://ddzlbmnmsdyodouqxbjx.supabase.co/functions/v1/ob-despesas-webhook`,
   com um cabeçalho `x-make-secret: <o segredo>` — deixa de usar a `apikey`/`anon key`
   diretamente contra `/rest/v1/ob_despesas`.
5. Testar uma despesa de teste a passar pelo novo caminho.
6. **Só depois disto confirmado a funcionar** é que a migração de aperto de
   `ob_despesas` (remover as 3 políticas `anon`) entra na lista de migrations — ainda
   não está numerada nas 8 acima porque depende deste passo.

Nada disto (gerar segredo, fazer deploy, mudar o Make.com) foi feito — é a proposta
pedida, a aguardar aprovação.

---

## 4. Prévia da associação dos 577 orçamentos antigos

**Já corrido — é uma leitura (`SELECT ... GROUP BY`), não altera nada.**

```sql
select coalesce(nullif(trim(vendedor),''), '(vazio)') as vendedor, count(*) as n
from public.ob_orcamentos group by 1 order by n desc;
```

| Nome no registo antigo (`vendedor`) | Utilizador sugerido | Confiança | Nº de orçamentos |
|---|---|:---:|---:|
| Paulo Faria | Paulo Faria (admin, mas pode ser `owner_id`) | **Alta** — correspondência exata | 251 |
| Rui Mota | Rui Mota (comercial) | **Alta** — correspondência exata | 220 |
| Humberto Estrelinha | Humberto Estrelinha (comercial) | **Alta** — correspondência exata | 106 |

**Total: 577 — bate certo com o total da tabela.**

- **Registos sem correspondência:** nenhum. Não há valores vazios, nulos, nem nomes
  fora da lista dos 3 acima.
- **Nomes ambíguos:** nenhum. Não há variações de escrita (maiúsculas/minúsculas,
  espaços, abreviaturas) — os 3 valores são exatamente os nomes completos esperados.
- André e Andreia: **não aparecem em nenhum orçamento antigo** — não têm nenhum
  histórico para associar, o que é consistente com não terem ainda conta.

Este é o melhor cenário possível: os dados antigos já estão limpos, sem necessidade de
correspondência aproximada (fuzzy matching) nem de decisões difíceis. A migração #7
(quando aprovada) seria, na prática, só 3 `UPDATE`s diretos:

```sql
-- rascunho — não corrido, falta o uuid real de cada ob_profiles (contas não existem ainda)
update ob_orcamentos set owner_id = '<uuid-paulo>'    where vendedor = 'Paulo Faria';
update ob_orcamentos set owner_id = '<uuid-rui>'      where vendedor = 'Rui Mota';
update ob_orcamentos set owner_id = '<uuid-humberto>' where vendedor = 'Humberto Estrelinha';
```

Isto só pode correr depois de existirem contas reais para Paulo, Rui e Humberto
(secção 5) — sem conta, não há `uuid` para atribuir.

---

## 5. Sistema de convite — preparado, sem contas criadas

Confirmado: nenhuma conta real foi criada, nenhum convite foi enviado. O mecanismo
(migração #6 acima, `ob_handle_new_user_trigger`) está desenhado e pronto a aplicar
quando aprovares, mas **não foi aplicado**. Quando tiveres os emails confirmados de
Rui, Humberto, André e (eventualmente) Andreia, o processo é:

1. Aprovar e aplicar a migração #6.
2. Tu (ou Paulo) vais a `Supabase Dashboard → Authentication → Users → Invite user`
   para cada pessoa, com `full_name`/`role`/`department` nos metadados do convite.
3. `ob_profiles` aparece sozinho assim que cada pessoa confirma o convite — sem mais
   nenhum passo manual.

Confirmação sobre o Paulo: fica `role = 'admin'` e pode simultaneamente ser `owner_id`
de clientes/leads/orçamentos próprios — não precisa de nenhum tratamento especial no
esquema, como já tinha explicado na Fase 2 inicial.

---

## Resumo do que está e não está feito

| Item pedido | Estado |
|---|---|
| 1. Lista detalhada das 8 migrations | ✅ Entregue (secção 1) — nenhuma executada |
| 2. Testes preparados | ✅ Entregue (secção 2) — não corridos, dependem de contas reais |
| 3. Correção segura do Make.com | ✅ Proposta entregue (secção 3) — **preciso que confirmes o scenario exato**; nada foi criado/alterado no Supabase nem no Make.com |
| 4. Prévia da associação dos 577 orçamentos | ✅ Entregue (secção 4) — só leitura; nenhum `UPDATE` corrido |
| 5. Sistema de convite preparado | ✅ Confirmado (secção 5) — sem contas criadas, sem convites enviados |

Nenhuma migration nova, nenhuma alteração de RLS antiga, nenhuma atualização dos 577
orçamentos e nenhuma publicação em produção foi feita nesta ronda.
