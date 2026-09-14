# G — Canonical Data Map

Auditoria estática, **só de leitura** — nenhuma SQL de escrita foi
executada, nenhum dado foi alterado, nenhuma migration foi criada. Dados
recolhidos por introspeção do catálogo Postgres + leitura de `dados`
(jsonb) em `public.ob_crm_dados`, no projeto `Opportunitybox CRM`
(`ddzlbmnmsdyodouqxbjx`), e por leitura de `index.html`, em 2026-09-14.

Objetivo: mapear onde cada tipo de dado do CRM vive hoje, identificar
duplicações entre `ob_crm_dados` (armazenamento genérico chave/blob
JSONB) e as tabelas relacionais "canónicas", e propor uma ordem de
migração gradual — sem mover dados nem apagar nada nesta etapa.

---

## 1. `public.ob_crm_dados` — todas as chaves

Estrutura da tabela: `chave text` (uma linha por chave, sem duplicados),
`dados jsonb`, `updated_at timestamptz`. 32 chaves no total.

| Chave | Linhas | Tamanho JSON | Tipo | Nº objetos/campos-topo | Última atualização |
|---|---|---|---|---|---|
| `ob-clients` | 1 | 191 879 B | array | **1243** clientes | 2026-09-11 |
| `ob-crm-atividades` | 1 | 112 221 B | array | **1234** atividades | 2026-09-12 |
| `ob-tes-receber` | 1 | 49 395 B | array | **571** recebimentos | 2026-09-08 |
| `toc-finance-audit-invoices-checkpoint` | 1 | 49 038 B | object | log de auditoria | 2026-09-03 |
| `ob-clients-backup-20260902-pre-toconline` | 1 | 199 492 B | array | backup histórico | 2026-09-02 |
| `ob-clients-backup-20260902-pre-enriquecimento` | 1 | 198 830 B | array | backup histórico | 2026-09-02 |
| `ob-clients-consolidado-20260814-preview` | 1 | 198 373 B | array | backup histórico | 2026-08-13 |
| `ob-clients-backup-20260810b` | 1 | 197 024 B | array | backup histórico | 2026-08-10 |
| `toc-snapshot` | 1 | 302 634 B | object | snapshot bruto TOConline | 2026-09-08 |
| `ob-tes-receber-backup-20260903-pre-sheet-sync` | 1 | 41 390 B | array | backup histórico | 2026-09-03 |
| `toc-sync-estado` | 1 | 6 305 B | object | estado última sync | 2026-09-08 |
| `toc-finance-audit-invoices` | 1 | 8 358 B | object | log de auditoria | 2026-09-03 |
| `ob-uni-items` | 1 | 2 788 B | array | **25** itens (órfã — ver §4) | 2026-07-20 |
| `toc-finance-audit-credit_notes` | 1 | 4 011 B | object | log de auditoria | 2026-09-03 |
| `toc-finance-audit-receipts` | 1 | 3 867 B | object | log de auditoria | 2026-09-03 |
| `ob-faturas` | 1 | 1 496 B | array | 4 faturas | 2026-08-05 |
| `ob-clients-backup-20260810` | 1 | 1 194 B | array | backup histórico | 2026-08-10 |
| `ob-clients-backup-20260814-pre-consolidacao` | 1 | 1 194 B | array | backup histórico | 2026-08-13 |
| `ob-clients-backup-20260814-pre-restauracao` | 1 | 1 194 B | array | backup histórico | 2026-08-14 |
| `ob-clients-backup-20260902-pre-promocao` | 1 | 1 194 B | array | backup histórico | 2026-09-02 |
| `ob-leads` | 1 | 1 188 B | array | **1** lead (quase vazia) | 2026-09-12 |
| `toc-oauth` | 1 | 151 B | object | tokens OAuth | 2026-09-08 |
| `ob-crm-historico` | 1 | 485 B | array | 3 entradas | 2026-09-12 |
| `ob-tes-contas` | 1 | 485 B | array | 1 conta a pagar | 2026-08-05 |
| `ob-fin-despesas` | 1 | 328 B | array | 1 despesa | 2026-08-05 |
| `ob-fo-ausencias` | 1 | 5 B | array | vazia (`[]`) | 2026-08-05 |
| `ob-iva-dados` | 1 | 5 B | array | vazia (`[]`) | 2026-08-05 |
| `ob-rh-colabs` | 1 | 5 B | array | vazia (`[]`) | 2026-08-05 |
| `ob-rh-ferias-cfg` | 1 | 5 B | array | vazia (`[]`) | 2026-08-05 |
| `ob-rh-turnos` | 1 | 5 B | array | vazia (`[]`) | 2026-08-05 |
| `ob-tes-cartoes` | 1 | 5 B | array | vazia (`[]`) | 2026-08-05 |
| `ob-tes-log` | 1 | 5 B | array | vazia (`[]`) | 2026-08-05 |

Nota: `ob-followups` é referenciada no código (`OB_SB_SYNC_KEYS`, ver §4)
mas **não existe como linha** em `ob_crm_dados` — nunca chegou a ser
criada (ver §4, Follow-up).

---

## 2. Detalhe por chave relevante

### `ob-clients` (Clientes)
- **Entidade:** clientes/empresas do CRM.
- **Estrutura:** array de objetos `{n, id, st, nif, rev, sec, tel, cont, last, email, projs, morada, projectIds, ...}`.
- **IDs:** `id` numérico (timestamp-like, ex. `1789139698372`), sem relação com `uuid` das tabelas relacionais.
- **1243 objetos.**
- **Tabela canónica equivalente:** `public.ob_clientes` (existe, colunas `id uuid, nome, email, telefone, morada, nif, notas, status, owner_id, ...`, RLS ativo) — **0 registos**, nunca populada.
- **Frontend lê:** sim, diretamente de `ob_crm_dados` (`obSbBoot()`, `localStorage`).
- **Frontend escreve:** sim (`obSbPush('ob-clients')` → `obSbPushClientesInterno`).
- **Existe em tabela relacional?** Não (tabela canónica vazia).
- **Fonte de verdade atual:** `ob_crm_dados['ob-clients']`.

### `ob-leads` (Leads)
- **Entidade:** leads comerciais (funil de vendas).
- **Estrutura:** objetos `{n, dt, id, st, ass, emp, tel, val, nota, prod, email, origem, dtFecho, numLead, dtInicio, assignees, prioridade, adjudicacao{...}, proximaAcao{...}, ...}` — estrutura rica, aninhada.
- **1 objeto atualmente** (era maior; a função `crmHidratarLeadsCanonico()` substitui sempre pelo remoto, nunca faz merge — ver nota abaixo).
- **Tabela canónica equivalente:** `public.ob_leads` (existe, `id uuid, nome, empresa, contacto, origem, valor_estimado, estado, cliente_id, owner_id, ...`, RLS ativo) — **0 registos**, nunca populada.
- **Frontend lê:** sim — mas **atenção**: a função `crmHidratarLeadsCanonico()` (nome sugere "canónico") continua a ler de `sb.from('ob_crm_dados').eq('chave','ob-leads')`, **não** da tabela `ob_leads`. "Canónico" aqui refere-se a ser o único caminho de hidratação autoritativo em JS, não à tabela relacional.
- **Frontend escreve:** sim (`obSbPushLeadsSeguro()`, mesmo padrão de chave/blob).
- **Fonte de verdade atual:** `ob_crm_dados['ob-leads']`.

### `ob-crm-atividades` (Atividades CRM/vendas)
- **Entidade:** atividades comerciais — chamadas, reuniões, notas, ligadas a leads/orçamentos.
- **Estrutura:** `{ts, tipo, autor, orcId, texto, leadId, resultado}`.
- **1234 objetos.**
- **Tabela canónica equivalente:** nenhuma dedicada. (Não confundir com `public.ob_uni_atividades` — tabela diferente, para comentários/atividade de itens do Kanban de Design/Produção/Instalações, ver §2 abaixo.)
- **Frontend lê/escreve:** sim, diretamente via `ob_crm_dados`.
- **Fonte de verdade atual:** `ob_crm_dados['ob-crm-atividades']`.

### `ob-crm-historico`
- **Entidade:** histórico de alterações de campos de leads (`{data, autor, campo, leadId, valorNovo, valorAntigo}`).
- **3 objetos** — muito pouco usada.
- **Tabela canónica:** nenhuma.
- **Frontend lê/escreve:** sim, diretamente.
- **Fonte de verdade atual:** `ob_crm_dados['ob-crm-historico']`.

### `ob-uni-items` (chave, ÓRFÃ) vs. `public.ob_uni_items` (tabela, ATIVA)
- **Entidade:** itens de Kanban (Design/Produção/Instalações).
- **Chave `ob_crm_dados['ob-uni-items']`:** 25 objetos, última atualização **2026-07-20** (há quase 2 meses). Estrutura antiga (`{n, dt, id, date, page, notes, client, status, assignee, priority, checklists, _ckAplicado}`).
- **Tabela `public.ob_uni_items`:** `id bigint, page, payload jsonb, owner_id, updated_at` — **7 registos**, distribuídos por `page`: `design-ficheiros` (1), `design-tarefas` (3), `fabrica-instalacoes` (1), `fabrica-producao` (2).
- **Frontend lê/escreve a tabela diretamente:** sim — `_sbUniItemUpsert()` (`sb.from('ob_uni_items').upsert(...)`), `_uniInitFromSB()`.
- **Frontend lê a chave `ob_crm_dados['ob-uni-items']`?** **Não** — `obSbBoot()` ignora-a explicitamente: *"'ob-uni-items' tem agora a sua própria sincronização por item (...) — ignorado aqui para não competir com ela."*
- **Frontend escreve a chave?** **Não** — `'ob-uni-items'` está explicitamente fora de `OB_SB_SYNC_KEYS` (comentário: *"têm a sua própria sincronização por item, mais robusta que este mecanismo de blob único"*).
- **Duplicação real:** **sim** — os 25 objetos na chave são uma cópia morta/desatualizada, sem qualquer consumidor. É a única duplicação **de dados residuais coexistentes** encontrada nesta auditoria (as outras "duplicações" são tabelas canónicas vazias, sem dados a duplicar).
- **Fonte de verdade atual:** `public.ob_uni_items` (tabela).

### `public.ob_uni_atividades` (não é uma chave de `ob_crm_dados`)
- **Entidade:** comentários/log de atividade por item do Kanban (`item_id` → `ob_uni_items.id`).
- **2 registos.** Colunas: `id bigint, item_id, dept, texto, link, autor, ts`.
- **Frontend lê/escreve:** sim, diretamente (`sb.from('ob_uni_atividades').upsert(...)`, `.select('*')`).
- **Tabela canónica:** é ela própria — já é a fonte de verdade, sem equivalente em `ob_crm_dados`.

### `ob-tes-receber` / `ob-tes-contas` (Tesouraria)
- **Entidade:** contas a receber (571 objetos) / a pagar (1 objeto).
- **Tabela canónica equivalente:** nenhuma tabela relacional dedicada — não fazem parte das 13 tabelas auditadas (Tesouraria não tem tabela própria neste schema).
- **Frontend lê:** via `tesHidratarCanonico()` — **mesma ressalva que `ob-leads`**: apesar do nome "canónico", continua a ler `sb.from('ob_crm_dados').eq('chave','ob-tes-receber'|'ob-tes-contas')`, não uma tabela relacional.
- **Frontend escreve:** sim, via o mecanismo genérico (`OB_SB_SYNC_KEYS`).
- **Fonte de verdade atual:** `ob_crm_dados`.

### `ob-faturas`, `ob-fin-despesas`, `ob-iva-dados`, `ob-tes-log`, `ob-tes-cartoes`, `ob-fo-ausencias`, `ob-rh-colabs`, `ob-rh-ferias-cfg`, `ob-rh-turnos`
- Todas geridas pelo mesmo mecanismo genérico (`OB_SB_SYNC_KEYS` → `obSbPush`/`obSbBoot`).
- **7 das 9 estão vazias (`[]`, 5 bytes)** — sem dados reais atualmente: `ob-fo-ausencias`, `ob-iva-dados`, `ob-rh-colabs`, `ob-rh-ferias-cfg`, `ob-rh-turnos`, `ob-tes-cartoes`, `ob-tes-log`.
- `ob-rh-colabs` está vazia porque `public.ob_colaboradores` (tabela, **3 registos**, RLS ativo) já é a fonte real para Colaboradores/RH — mas o código ainda hidrata `rhColabs` a partir desta chave quando `ob_crm_dados` tem dados (não tem). **HÍBRIDO**: há referências no código tanto a `ob_colaboradores` (comentários "dinâmico, vem de ob_colaboradores") como à variável `rhColabs` (histórica, ligada à chave vazia) — na prática, hoje, `ob_colaboradores` parece ser o caminho real.
- `ob-faturas` (4 objetos) e `ob-fin-despesas` (1 objeto) têm alguns dados, mas nenhuma tabela canónica equivalente existe.

### `toc-snapshot`, `toc-oauth`, `toc-sync-estado`, `toc-finance-audit-*` (4 chaves)
- **Entidade:** integração TOConline (faturação externa) — snapshot da API, tokens OAuth, estado de sincronização, logs de auditoria de faturas/recibos/notas de crédito.
- **`toc-snapshot`** (302 KB): `{diag, customers, obtido_em, invoices_count, customers_count, invoices_amostra, customers_include, customers_included, customers_included_count, customers_include_tentativas}` — é a fonte lida por `public.v_toc_plano` (view, já corrigida com `security_invoker=true` no F6).
- **Tabela canónica:** nenhuma — por design, é um cache/snapshot de uma API externa; não há (nem faz sentido criar já) uma tabela relacional 1:1.
- **Frontend lê/escreve:** maioritariamente via funções de sincronização backend/edge, não diretamente pelo `index.html` na maior parte dos casos (fora do âmbito de leitura desta auditoria, que se focou em `index.html`).
- **Fonte de verdade atual:** `ob_crm_dados` (é a única fonte).

### Chaves de backup (10 no total)
`ob-clients-backup-20260810`, `ob-clients-backup-20260810b`,
`ob-clients-backup-20260814-pre-consolidacao`,
`ob-clients-backup-20260814-pre-restauracao`,
`ob-clients-backup-20260902-pre-enriquecimento`,
`ob-clients-backup-20260902-pre-promocao`,
`ob-clients-backup-20260902-pre-toconline`,
`ob-clients-consolidado-20260814-preview`,
`ob-tes-receber-backup-20260903-pre-sheet-sync` — snapshots pontuais
criados antes de operações de risco (consolidações, migrações,
integração TOConline). Não são lidas nem escritas pelo frontend em uso
normal — histórico de segurança, análogo aos backups já tratados no F6
(`ob_crm_dados_backup_20260901`, etc.).

---

## 3. Ocorrências no `index.html`

| Termo | Ocorrências | Padrão de uso |
|---|---|---|
| `'ob-clients'`/`"ob-clients"` | várias (incl. nas 103 ocorrências combinadas de todas as chaves pedidas) | leitura/escrita direta, proteção especial contra sobrescrita |
| `'ob-leads'` | idem | via `crmHidratarLeadsCanonico()` — lê `ob_crm_dados`, não `ob_leads` |
| `'ob-crm-atividades'` | idem | leitura/escrita direta |
| `'ob-crm-historico'` | idem | leitura/escrita direta |
| `'toc-snapshot'` | idem | lida por `v_toc_plano`/integração TOConline |
| `.from('ob_crm_dados')` | 10 ocorrências diretas em `sb.from(...)` | além do mecanismo genérico via `fetch()` |
| `.from('ob_uni_items')` | múltiplas (`_sbUniItemUpsert`, `_uniInitFromSB`) | tabela, ativa |
| `.from('ob_uni_atividades')` | múltiplas | tabela, ativa |
| `.from('ob_profiles')` | 1 (`crmAuthLoadProfile`) | tabela, ativa (perfis/login) |
| `.from('ob_clientes')`, `.from('ob_leads')`, `.from('ob_tasks')`, `.from('ob_visitas')`, `.from('ob_followup_emails')` | **0** | nenhuma destas 5 tabelas canónicas é lida ou escrita pelo frontend |
| `.from('ob_orcamentos')`, `.from('ob_orcamento_triagem')`, `.from('ob_orcamento_triagem_historico')` | 6 combinadas | tabelas, ativas (Orçamentos + Follow-up) |
| `ob_colaboradores` (texto/comentários) | várias | conceptualmente usada (RH), mas maioritariamente via variável `rhColabs` |
| `'ob-followups'` | 2 (em `OB_SB_SYNC_KEYS` + hidratação defensiva) | **chave nunca chegou a existir na BD** — vestígio de uma geração anterior do Follow-up, substituída pelas tabelas `ob_orcamento_triagem*` + RPCs `fu_*` |
| "Visitas" (`ob_visitas`) | 58 ocorrências de "visita" no texto, mas **0** referências a `.from('ob_visitas')` | o que o código chama "visitas" é outra funcionalidade (equipa em campo), noutro projeto Supabase (`ecSupabase`/`avGetSupabase`, tabela `work_days`), não `public.ob_visitas` |

---

## 4. Matriz de domínios

| Domínio | Fonte atual | Tabela canónica | Frontend lê | Frontend escreve | Duplicado? | Fonte de verdade atual | Recomendação | Classificação |
|---|---|---|---|---|---|---|---|---|
| **Clientes** | `ob_crm_dados['ob-clients']` (1243 obj.) | `ob_clientes` (0 linhas) | `ob_crm_dados` | `ob_crm_dados` | Não (tabela vazia) | `ob_crm_dados` | Preparar dual-write antes de qualquer leitura da tabela | **LEGADO** |
| **Leads** | `ob_crm_dados['ob-leads']` (1 obj.) | `ob_leads` (0 linhas) | `ob_crm_dados` (via `crmHidratarLeadsCanonico`) | `ob_crm_dados` | Não (tabela vazia) | `ob_crm_dados` | Idem Clientes | **LEGADO** |
| **Orçamentos** | `public.ob_orcamentos` (787 linhas) | `ob_orcamentos` | tabela | tabela | Não | tabela `ob_orcamentos` | Manter — já migrado | **CANÓNICO** |
| **Follow-up** | `ob_orcamento_triagem` (2) + `_historico` (6), via RPCs `fu_*` | as próprias tabelas | RPC | RPC | Não (chave `ob-followups` antiga nunca populada) | tabelas `ob_orcamento_triagem*` | Manter — já migrado; remover referência morta a `ob-followups` quando conveniente | **CANÓNICO** |
| **Histórico** | `ob_crm_dados['ob-crm-historico']` (3 obj.) | nenhuma | `ob_crm_dados` | `ob_crm_dados` | Não | `ob_crm_dados` | Baixo volume — avaliar se vale a pena tabela própria | **LEGADO** |
| **Atividades** (CRM/vendas) | `ob_crm_dados['ob-crm-atividades']` (1234 obj.) | nenhuma dedicada | `ob_crm_dados` | `ob_crm_dados` | Não | `ob_crm_dados` | Maior volume de todas as chaves ativas — candidata a tabela própria numa fase futura | **LEGADO** |
| **Utilizadores/perfis** | `public.ob_profiles` (5 linhas) | `ob_profiles` | tabela | tabela (via Auth) | Não | tabela `ob_profiles` | Manter | **CANÓNICO** |
| **Design** | `public.ob_uni_items` (page `design-*`, 4 linhas) + `ob_uni_atividades` | as próprias | tabela | tabela | **Sim** — resíduo morto em `ob_crm_dados['ob-uni-items']` (25 obj., ignorado) | tabela `ob_uni_items` | Apagar/arquivar a chave órfã numa fase própria (fora desta etapa) | **CANÓNICO** (com lixo residual) |
| **Produção** | `ob_uni_items` (page `fabrica-producao`, 2 linhas) + `ob_uni_atividades` | idem | tabela | tabela | idem | tabela `ob_uni_items` | idem | **CANÓNICO** (idem) |
| **Instalações** | `ob_uni_items` (page `fabrica-instalacoes`, 1 linha) + `ob_uni_atividades` | idem | tabela | tabela | idem | tabela `ob_uni_items` | idem | **CANÓNICO** (idem) |
| **Visitas** | nenhuma, neste projeto | `ob_visitas` (0 linhas, nunca referenciada) | não | não | Não aplicável | **nenhuma** (funcionalidade real fica noutro Supabase) | Confirmar propósito de `ob_visitas` antes de decidir — pode ser tabela nunca implementada | **INCERTO** |
| **Dados TOConline** | `ob_crm_dados` (`toc-snapshot`, `toc-oauth`, `toc-sync-estado`, `toc-finance-audit-*` — 7 chaves) | nenhuma (é cache de API externa, por design) | `v_toc_plano` (view) + backend/edge | backend/edge | Não | `ob_crm_dados` | Manter em JSONB — não faz sentido relacional | **LEGADO** (aceitável) |
| *(extra) Colaboradores/RH* | `public.ob_colaboradores` (3 linhas) — `ob_crm_dados['ob-rh-colabs']` vazia | `ob_colaboradores` | tabela (maioritariamente) + variável `rhColabs` (ligada à chave vazia) | tabela | Não (chave vazia) | tabela `ob_colaboradores` | Confirmar e remover de vez a dependência de `rhColabs`/`ob-rh-colabs` | **HÍBRIDO** |

---

## 5. Duplicações encontradas

1. **`ob_uni_items` (Design/Produção/Instalações) — única duplicação real de dados coexistentes.** A chave `ob_crm_dados['ob-uni-items']` (25 objetos, parada desde 2026-07-20) e a tabela `public.ob_uni_items` (7 registos, ativa) coexistem. A chave já está desligada da leitura e da escrita (confirmado no código), mas continua a ocupar espaço e pode confundir quem auditar a base de dados sem ver o código.
2. **Clientes/Leads** — as tabelas canónicas (`ob_clientes`, `ob_leads`) existem no schema mas estão **vazias**; não há dados duplicados, mas há **schema duplicado/morto** (duas modelações da mesma entidade, uma delas nunca usada).
3. **`ob-rh-colabs` vs. `ob_colaboradores`** — a chave está vazia, a tabela tem os dados reais; risco baixo, mas o código ainda tem caminhos (`rhColabs`) que dependem da chave, criando ambiguidade sobre qual é a fonte em certos pontos.
4. **Backups (10 chaves)** — duplicação intencional/histórica, não é um problema a corrigir.

Não foi encontrada nenhuma duplicação onde **ambas** as fontes (chave + tabela) tenham dados reais e divergentes ao mesmo tempo — o cenário mais perigoso (dessincronia silenciosa) não ocorre atualmente em nenhum domínio auditado.

---

## 6. Fonte de verdade atual, por domínio (resumo)

- **`ob_crm_dados` ainda é a fonte de verdade real** para: Clientes, Leads, Histórico, Atividades (CRM/vendas), Tesouraria (a receber/a pagar), Faturas, Despesas, e a integração TOConline.
- **As tabelas relacionais já são a fonte de verdade real** para: Orçamentos, Follow-up (triagem), Utilizadores/perfis, Design, Produção, Instalações (via `ob_uni_items`/`ob_uni_atividades`), e Colaboradores/RH (majoritariamente).
- **Nenhuma fonte de verdade identificável** para: Visitas (`ob_visitas` não implementada neste projeto).

---

## 7. Ordem recomendada de migração gradual

Não é proposta nenhuma reescrita grande, nenhuma movimentação de dados e
nenhuma chave é apagada nesta etapa — só uma ordem de trabalho para uma
fase futura.

### Fase 1 — o que pode ser desligado de `ob_crm_dados` primeiro (risco mínimo)
Chaves **vazias e sem consumidor de dados reais** — desligar do
mecanismo de sync genérico (remover de `OB_SB_SYNC_KEYS`) sem qualquer
impacto visível, porque não têm conteúdo a perder:
`ob-fo-ausencias`, `ob-iva-dados`, `ob-rh-ferias-cfg`, `ob-rh-turnos`,
`ob-tes-cartoes`, `ob-tes-log`. (`ob-rh-colabs` também está vazia, mas
fica na Fase 2 porque ainda há código que a lê condicionalmente para
`rhColabs`.)
Além disso: **arquivar/remover a leitura morta de `ob_crm_dados['ob-uni-items']`** —
já não é lida nem escrita, só existe a limpeza do registo em si (fora do
âmbito de escrita desta etapa).

### Fase 2 — o que precisa de dual-read (ler das duas fontes e comparar, sem desligar nenhuma)
- **Colaboradores/RH:** confirmar definitivamente que `ob_colaboradores`
  cobre todos os casos de uso de `rhColabs`/`ob-rh-colabs` antes de
  remover o caminho antigo.
- **`ob-leads` / `ob_leads`:** antes de sequer considerar popular a
  tabela `ob_leads`, implementar leitura dupla temporária (ler de
  `ob_crm_dados` como hoje, e em paralelo gravar/comparar contra
  `ob_leads`) para validar que a migração de esquema (campos JSON → 
  colunas relacionais) não perde informação (a estrutura de `ob-leads`
  é rica e aninhada — `adjudicacao{}`, `proximaAcao{}` — não mapeia 1:1
  para as colunas simples de `ob_leads`).
- **`ob-clients` / `ob_clientes`:** mesmo raciocínio — 1243 clientes,
  estrutura simples mas em volume alto; validar dual-read antes de
  qualquer dual-write.

### Fase 3 — o que precisa de dual-write temporário (só depois da Fase 2 validar)
- **Clientes:** só depois de confirmado por dual-read que `ob_clientes`
  recebe corretamente todos os campos, ativar escrita simultânea
  (`ob_crm_dados['ob-clients']` continua a ser lida/fonte de verdade;
  `ob_clientes` passa a receber cópia em paralelo) — sem cortar a
  leitura antiga.
- **Leads:** mesmo padrão, só depois da Fase 2.

### Fase 4 — o que não deve ser mexido ainda
- **Atividades CRM (`ob-crm-atividades`, 1234 objetos)** e **Histórico
  (`ob-crm-historico`)** — maior volume de dados vivos sem tabela
  canónica desenhada; migrar sem um esquema relacional bem pensado
  arrisca perder estrutura. Fica para uma fase de desenho de esquema
  dedicada, não uma migração mecânica.
- **Tesouraria (`ob-tes-receber`/`ob-tes-contas`)** — 571 + 1 registos,
  sem tabela canónica no schema atual; precisa de desenho de tabela
  antes de qualquer migração.
- **Dados TOConline** — por design, deve continuar em JSONB (é um
  cache/snapshot de API externa); não é candidato a "canonicalização"
  relacional.
- **Visitas (`ob_visitas`)** — **INCERTO**: antes de qualquer ação,
  confirmar com quem geriu a criação desta tabela se ela tem um
  propósito futuro planeado, ou se é um resíduo de outra fase do
  projeto. Não mexer até essa confirmação.

### Fase 5 — funções/frontend a alterar em cada fase
- **Fase 1:** só `OB_SB_SYNC_KEYS` (remover 6 chaves) e, à parte,
  remover a linha `ob_crm_dados['ob-uni-items']` (limpeza de dados, não
  de código — fora do âmbito desta etapa de qualquer forma).
- **Fase 2:** `crmHidratarLeadsCanonico()` (adicionar leitura de
  `ob_leads` em paralelo, só para comparação/log, sem mudar o que é
  servido à UI); equivalente para `rhColabs`/`ob_colaboradores`; nenhuma
  função de Clientes precisa de mudar ainda (dual-read pode ser feito
  por um script/relatório externo, não necessariamente no frontend).
- **Fase 3:** `obSbPush('ob-clients')`/`obSbPushClientesInterno`,
  `obSbPushLeadsSeguro()` — adicionar escrita espelho para
  `ob_clientes`/`ob_leads`, mantendo a escrita atual em
  `ob_crm_dados` inalterada.
- **Fase 4:** sem alterações previstas nesta ronda — fica para quando
  houver desenho de esquema para Atividades/Histórico/Tesouraria, e
  confirmação sobre `ob_visitas`.

---

## 8. Riscos

- **Maior risco identificado:** nenhum dos domínios auditados tem hoje
  duas fontes com dados reais divergentes — o que significa que uma
  migração mal feita seria o primeiro ponto a introduzir esse risco,
  não a corrigir um já existente. Por isso a ordem acima prioriza
  dual-read antes de dual-write em todos os casos.
- **`ob-leads`:** estrutura aninhada rica (`adjudicacao`, `proximaAcao`)
  não mapeia trivialmente para as colunas simples de `ob_leads` — uma
  migração apressada perderia informação a menos que o esquema da
  tabela seja primeiro expandido ou passe a usar uma coluna `jsonb`
  auxiliar.
- **`ob_visitas`:** por não haver nenhum uso confirmado, existe o risco
  de ser (a) uma tabela órfã segura para remover, ou (b) uma tabela
  preparada para uma funcionalidade futura ainda não implementada —
  sem confirmação humana, tratá-la como qualquer uma das duas é
  arriscado.
- **`ob-followups`:** referência morta no código (`OB_SB_SYNC_KEYS`)
  sem linha correspondente na base de dados — risco baixo (não faz
  nada hoje), mas pode confundir quem ler o código sem esta auditoria.

---

## 9. Confirmação

**Nenhuma SQL de escrita foi executada** nesta auditoria — só `SELECT`
(introspeção do catálogo + leitura de `dados` em `ob_crm_dados`) e
leitura de `index.html`. Nenhum dado foi alterado, nenhuma chave foi
apagada, nenhuma migration foi criada. `main`, `preview` e produção não
foram tocados.
