# Correção Final Direcionada — B1, H1, G1, Reabrir Orçamento, Pesquisa

Data: 2026-09-14
Branch: `dev-seguranca-f2-f3-12set` (sem commit/push nesta entrega — fica para
revisão de outra sessão).
Âmbito: SOMENTE os 5 pontos abaixo. Não repete a auditoria de
`docs/meu-painel-audit.md` (bugs B1/G1/H1, blocos A-H do Meu Painel) nem de
`docs/canonical-data-map.md` — usa-os como ponto de partida, com os números
de linha reconfirmados via Grep antes de cada edição.

---

## 1. Bug B1 — "meus orçamentos" por `owner_id`, não por `vendedor`

**Corrigido: sim.**

Causa original: várias funções decidiam "isto é meu" comparando
`o.vendedor` (texto livre, editável) com `CU.name`, em vez de comparar
`o.owner_id` (uuid, já disponível em `orcData` desde `_sbOrcLoadAll()`,
linha 17843) com `CU.id`. Caso real confirmado em produção no documento
anterior: `ORC-719-2026OB`, `owner_id`=Edna Faria, `vendedor`="Paulo Faria".

### Funções alteradas (linhas confirmadas por Grep nesta sessão, podem
ter mudado ligeiramente com os próprios patches — os números abaixo são
os do ficheiro já corrigido):

| Função | Antes | Depois |
|---|---|---|
| `renderMeuPainel()` (~30487-30507) | `minhas=function(v){return isAdmin\|\|!nome\|\|v===nome;}` aplicado a `o.vendedor` | `minhasOrcamentos=function(o){return isAdmin\|\|!meuId\|\|o.owner_id===meuId;}`, usado em `minhasOrc` (KPIs "Ticket médio"/"Pendentes") e `ativosMeus` (Follow-up "Faça agora"/"Clientes em risco" — corrige também o Bloco C herdado) |
| `fuMinhasOrc()` (~32825-32832) | `rows.filter(o=>o.vendedor===nome)` | `rows.filter(o=>o.owner_id===meuId)` |
| `agItensLeadsOrcamentos()` (~31740) | item de orçamento só tinha `comercial:o.vendedor` | item passa também a trazer `ownerId:o.owner_id\|\|null` |
| `agListaUnificada()` (~31812-31823) | `minhas(it.comercial)` (nome) | `minhas(it)`: usa `it.ownerId===meuId` quando o item tem `ownerId` (orçamentos); mantém `it.comercial===nomeCU` para itens sem `ownerId` (leads/clientes — ver limitação abaixo) |
| `agCandidatosTopHoje(comercialAlvo, ownerIdAlvo)` (~32074-32086) | `it.comercial===comercialAlvo` | aceita novo parâmetro opcional `ownerIdAlvo`; usa `it.ownerId===ownerIdAlvo` quando presente, senão cai no critério por nome |
| `agGerarTopHoje()`, `agObterTopHoje()` | — | passam a aceitar e propagar `ownerIdAlvo` até `agCandidatosTopHoje` |
| `agRenderTopHoje()` (~32232-32236) | `agObterTopHoje(nome)` | `agObterTopHoje(nome, meuId)` — o Top 10 do próprio painel passa a usar `CU.id` |

**`mp2RenderProximosSete()`**: revista, mas **não alterada** — não filtra
orçamentos por `vendedor` em nenhum ponto (usa `minhas(l.ass)` para leads e
`minhas(a.autor)` para lembretes/atividades). Como `ob_leads` não tem
`owner_id` populável (ver `docs/canonical-data-map.md` — tabela vazia, a
fonte real `ob-leads` usa só o campo de texto `ass`), não há uuid disponível
para trocar aqui sem migrar Leads primeiro — fica documentado como
limitação, não como bug de B1.

### Limitação documentada (não é regressão nem bug novo)
Itens de **lead** e **cliente** no Centro de Prioridades/Top Hoje
continuam a decidir "é meu" pelo nome (`it.comercial`), porque não existe
`owner_id` fiável na origem desses dados hoje (`ob_leads` vazia; a fonte
real usa `ass`/texto). Só orçamentos (que têm `owner_id` real) foram
corrigidos para uuid. Corrigir leads exigiria migrar `ob-leads` para uma
tabela relacional com `owner_id` — fora do âmbito desta entrega.

### Testes B1 executados (reais, ver secção de testes)
4 casos pedidos, todos passaram — ver `test_b1_h1_reabrir_14set.js`.

---

## 2. Bug H1 — Meu Painel com dados stale no login

**Corrigido: sim.**

Abordagem escolhida: **opção B do enunciado** — refresco idempotente no
fim de `_orcInitFromSB()` (não se mexeu em `crmEnterAppWithProfile()`,
que continua a chamar `goPage(crmPaginaInicial())` de forma síncrona como
antes, preservando o comportamento existente de primeiro render rápido).

`_orcInitFromSB()` (linha 17879), no fim do caminho de sucesso (depois de
`orcData = res.rows` e `orcRenderList()`), passa a verificar se a página
`#page-meu-painel` está ativa (`classList.contains('on')` — o mesmo padrão
já usado no ficheiro, ex. linhas ~22572/~28501/~28629) e, se estiver, chama
`renderMeuPainel()` outra vez, agora com `orcData` já atualizado do
Supabase. Não usa `setTimeout`/polling — reaproveita a Promise
já existente (`await _sbOrcLoadAll()`), o mesmo padrão de callback que
`orcRenderList()` já usava dentro da própria função.

No caminho de **falha** (`!res.ok`), nada muda: não há novo render (dados
não mudaram) e a função já retornava sem lançar exceção — confirmado que
isto não trava o login (a chamada em `crmEnterAppWithProfile()` não é
`await`ada, está dentro de um `try{...}catch(e){}`).

Requisitos validados:
- login não mostra KPIs presos a stale — refrescam assim que `_orcInitFromSB` resolve, se o utilizador ainda estiver no Meu Painel;
- navegar para outro ecrã antes do fetch terminar não força um render indevido nesse outro ecrã (guarda por `classList.contains('on')`);
- falha de rede não trava nem duplica render;
- sem duplo render desnecessário (só 1 render extra, condicional à página ativa, depois do fetch real terminar).

### Teste H1 executado
Simulação da sequência real (render síncrono stale → fetch assíncrono →
2º render com dados reais → navegação para outro ecrã → falha de rede) —
6 asserções, todas passaram. Ver `test_b1_h1_reabrir_14set.js`.

---

## 3. G1 — privacidade de `ob-crm-atividades`

**Correção aplicada nesta entrega: nenhuma em `index.html`/RLS de produção.**
Entregue: auditoria cirúrgica dos dados (SQL, só leitura) + migration e
rollback **preparados mas não aplicados**.

### 3a. Auditoria cirúrgica (SQL de leitura, projeto `ddzlbmnmsdyodouqxbjx`)

**Total de atividades no blob `ob_crm_dados['ob-crm-atividades']`: 1234.**

Estrutura real confirmada (mais rica do que o documentado anteriormente
como "típica"): além de `{ts, tipo, autor, orcId, texto, leadId,
resultado}`, a maioria dos registos (1141/1234) também tem `acao, canal,
clienteId, data, due, extra, origem, prioridade, tags`. Os 93 restantes
(sobretudo `TopHojeItem`) não têm esses campos extra.

| Campo | Presente (chave existe) | Preenchido (não vazio) |
|---|---|---|
| `ts` | 1234 (100%) | 1234 |
| `tipo` | 1234 (100%) | 1234 |
| `texto` | 1234 (100%) | 1234 |
| `autor` | 1234 (100%) | 1234 (100%) |
| `orcId` | 1233 | **767 (62,2%)** |
| `leadId` | 1234 | **469 (38,0%)** |
| `resultado` | 1233 | 15 (1,2%) |

Cruzamento **orcId → `ob_orcamentos.num` → `owner_id`** (join real,
`left join`, sem inventar nada):
- **767/767 atividades com `orcId` preenchido encontraram correspondência
  exata em `ob_orcamentos.num`, todas com `owner_id` não nulo.**
- 0 sem match, 0 com match mas `owner_id` nulo.
- **Conclusão: 767 atividades (62,2% do total) podem ter `owner_id`
  derivado com 100% de segurança via `orcId`.**

Cruzamento **leadId → dono** — **não é possível com segurança**:
- `ob_leads` (tabela canónica) tem 0 registos (confirmado no
  canonical-data-map).
- A fonte real, `ob_crm_dados['ob-leads']`, tem hoje **apenas 1 lead**
  (`id=1786458966430`) — a função `crmHidratarLeadsCanonico()` sempre
  **substitui** o array inteiro pelo remoto, nunca faz merge, por isso
  leads antigos referenciados por atividades passadas já não existem na
  fonte.
- Das 469 atividades com `leadId` preenchido, **só 22 (4,7%) correspondem
  ao único lead ainda vivo** — as outras 447 apontam para leads que já não
  existem em lado nenhum consultável.
- Mesmo para essas 22: o único lead vivo tem `assignees:["Humberto
  Estrelinha","Paulo Faria"]` — **dois** assignees, não um dono único. Não
  há forma de escolher um `owner_id` inequívoco a partir disso sem
  inventar uma correspondência (o que o enunciado proíbe explicitamente).
  **Confirmado e documentado: `leadId`/`ass`/`assignees` NÃO são uma fonte
  segura de `owner_id` para esta migração.**

**Resumo final:**

| Categoria | Quantidade | % do total (1234) |
|---|---|---|
| Owner_id derivável com 100% de segurança (via `orcId`) | **767** | **62,2%** |
| Sem owner_id derivável com segurança | **467** | **37,8%** |

Dos 467 sem derivação segura, por `tipo`: `TopHojeItem` 345, `nota` 65,
`estado` 19, `criado` 15, `editado` 13, `apagado` 6, `adjudicacao` 2,
`Chamada` 1, `orcamento` 1 (soma = 467). Destes, 466 têm `leadId` (sem
derivação segura, ver acima) e 1 não tem nem `orcId` nem `leadId`.

`autor` (nome de texto, 100% preenchido, 8 valores distintos: Rui Mota 376,
Humberto Estrelinha 372, Paulo Faria 368, Edna Faria 44, "Leonor
(WhatsApp)" 43, "WhatsApp (Leonor)" 17, Sistema 10, "Instagram (Leonor)" 4)
**não foi usado** como fonte de `owner_id` — usar nome de texto para
decidir dono é exatamente a causa raiz do Bug B1 que acabou de ser
corrigido; reintroduzi-la em `ob-crm-atividades` seria o mesmo erro
noutra tabela.

### 3b. Funções que leem/escrevem `crmAtividades`/`ob-crm-atividades`

| Função/local | Linha aprox. | O que faz |
|---|---|---|
| inicialização de `crmAtividades` | 13729 | lê de `localStorage['ob-crm-atividades']` |
| `saveCrmAtividades()` | 13730 | escreve em `localStorage['ob-crm-atividades']`; mais tarde (33681) fica "wrapped" para também disparar `obSbPush('ob-crm-atividades')` a cada chamada |
| `crmDeleteAtividade(ts)` | 13740-13760 | admin-only; remove uma atividade do array, chama `saveCrmAtividades()`, re-renderiza Meu Painel/Centro Unificado |
| `crmAddAtividade(leadId, tipo, texto, autor, opts)` | 13764-13781 | cria nova atividade (`unshift`), chama `saveCrmAtividades()` |
| boot sync (dispositivo novo, local vazio) | ~33536 | adota o blob remoto inteiro para `crmAtividades` quando o local está vazio |
| merge sync (`obSbMesclarPorChave`, chave `ts`) | ~33652-33659 | funde local+remoto por `ts` |
| wrapper de auto-push | 33681 | `wrap('saveCrmAtividades','ob-crm-atividades')` — toda gravação local dispara push para o Supabase |

### 3c. Migration + rollback preparados (NÃO aplicados)

Como 62,2% dos dados têm `owner_id` 100% seguro, foi preparada (escrita em
ficheiro, **nunca executada** — nenhuma chamada a `apply_migration`):

- `supabase/migrations/20260914150000_ob_crm_atividades_canonico.sql`
- `supabase/rollback/20260914_ob_crm_atividades_canonico_rollback.sql`

Conteúdo da migration:
- `create table public.ob_crm_atividades` com `id uuid pk, legacy_ts text
  unique (chave natural = o `ts` original, evita duplicar num re-run),
  ts timestamptz, tipo, texto, autor (só exibição), owner_id uuid
  (nullable, `references ob_profiles`), orc_num text, lead_id text,
  resultado text, extra jsonb (acao/canal/clienteId/data/due/origem/
  prioridade/tags/extra), created_at`.
- RLS: `ob_crm_atividades_select` usa o mesmo padrão já estabelecido em
  `ob_orcamentos`/`ob_orcamento_triagem` (`ob_can_see(owner_id)`) — **mais**
  uma cláusula extra para as linhas com `owner_id is null` (dono não
  derivável): essas só ficam visíveis a `ob_is_admin()`, nunca a um
  comercial qualquer — o oposto do problema original (RLS só por role).
- Sem GRANTs de escrita para `authenticated` nesta entrega (só `SELECT`) —
  escrita ficaria para uma fase futura via RPC `SECURITY DEFINER`, mesmo
  padrão das RPCs `fu_*` já existentes; não implementado agora (sem
  dual-write, como pedido).
- **Backfill incluído na própria migration** (`INSERT ... SELECT ...
  jsonb_array_elements ... JOIN ob_orcamentos ... ON CONFLICT (legacy_ts)
  DO NOTHING`), mas **só para as 767 atividades com `orcId` que casa** —
  idempotente, sem duplicar se corrida mais de uma vez. As 467 sem
  derivação segura **não são inseridas** por este script.
- A chave antiga `ob_crm_dados['ob-crm-atividades']` **não é tocada** —
  fica exatamente como está, blob completo, continua a ser a fonte real
  até uma fase futura decidir cortar/migrar o frontend.

**Tratamento proposto para as 467 sem dono seguro**: ficam de fora do
backfill inicial (não migradas agora) e continuam disponíveis apenas na
chave antiga. A tabela nova aceita `owner_id NULL` para o dia em que
houver um critério seguro de derivação (ex.: reconstruir `ob-leads` como
histórico append-only, ou uma migração de Leads que dê `owner_id` real) —
até lá, ficam visíveis só a admin na tabela nova (nunca expostas
indiscriminadamente a um comercial, que era exatamente o problema original
do Bug G1).

**Por que não aplicar agora**: aplicar exige (a) rodar a migration em
produção — fora do que foi pedido nesta entrega (SQL de escrita proibido);
(b) decidir e implementar o corte/dual-write do frontend, que tem impacto
direto na experiência de quem usa "Lembretes de Hoje"/"Últimas
atividades" hoje — decisão de produto, não só técnica, que fica para uma
entrega dedicada.

---

## 4. Reabrir orçamento existente

**Classificação: ❌ NÃO EXISTE** (fluxo de edição completo do orçamento).

Investigação (Grep exaustivo por `orcEditar`, `orcAbrirEdicao`, padrões de
pré-preenchimento de `#orc-cliente` a partir de um orçamento existente,
`modoEdicao`/`orcamentoEmEdicao`): **não existe nenhuma função** que carregue
um orçamento já existente de volta no formulário/construtor
(`#orc-cliente`, `#orc-lines-container`, materiais, etc.) para o utilizador
editar e regravar.

`orcGuardar()` (linha 18371) é o único ponto de gravação ligado ao
construtor visual, e **sempre cria um orçamento novo**:
```js
orcData.unshift(d);
...
const _syncRes = await _sbOrcUpsert(d, { isCreate: true });
```
`orcNew()` (linha 18408) só limpa o formulário para um orçamento em
branco — não há contraparte que o preencha a partir de um `orcData`
existente.

O que **já existe e funciona bem** é o primitivo de escrita
`_sbOrcUpsert(orc, opts)` (linha 17683), usado hoje só por fluxos
pontuais e de campo único (`orcChangeStatus`, `orcAtribuirProjectId`,
`orcRegistarFaturaFinal`, `orcConfirmarAdiantamento`,
`orcForcarProducaoSemAdiantamento`, `orcMarcarNecessitaDesign`,
`orcMarcarSemDesign`, `orcRegistarProforma`,
`orcForcarLiquidacaoConcluida`) — mas que já suporta tudo o que seria
preciso para "reabrir e editar":
- mesmo `id`/`num` (nunca cria um novo);
- `owner_id` preservado (`(cu.admin===true && opts.reassignOwnerId) ?
  opts.reassignOwnerId : cu.id` — nunca vem livre do formulário);
- `projectId`, `historicoFinanceiro`, `historicoProducao`,
  `historicoLiquidacao` preservados (passthrough do objeto `orc`, dentro de
  `extra` jsonb);
- **optimistic locking real por `updated_at`**: `orc._sbVersaoConhecida`
  (marca local, nunca enviada como coluna, vem de `_sbOrcLoadAll()` —
  linha 17808 — ou da resposta da escrita anterior) é usada como condição
  `.eq('updated_at', versaoConhecida)` num UPDATE condicional; se 0 linhas
  forem afetadas e havia uma versão conhecida, devolve
  `{ok:false, reason:'conflict'}` **sem sobrescrever nada** — nunca funde
  campos financeiros/fases às cegas.

**O que falta acrescentar** (não implementado, por instrução explícita de
não inventar módulo novo): uma função tipo `orcEditar(num)` que (1)
encontre o orçamento em `orcData`, (2) pré-preencha os campos do
construtor a partir dele, (3) marque um "modo edição" (o próprio `num`,
para saber que a próxima gravação é update, não create), e (4) troque a
chamada de `orcGuardar()` para, nesse modo, chamar `_sbOrcUpsert(orcAtualizado,
{isCreate:false})` sobre o objeto já existente em `orcData` (preservando
`_sbVersaoConhecida`) em vez de `orcData.unshift(d)` + `isCreate:true`. Um
botão "✏️ Editar" na lista (`orcRenderList()`, linha 19543) chamaria essa
função.

### Teste executado (mock isolado, nunca dados reais)
Extraída a lógica real de `_sbOrcUpsert()` (via Grep/leitura do código) e
simulada em Node com um objeto `orcExistente` mock — confirmando: mesmo
id/num mantido, `owner_id` preservado, `projectId`/históricos
preservados, e que uma condição de `updated_at` divergente (simulando
outra sessão a gravar entretanto) é recusada com `reason:'conflict'`, sem
sobrescrever. Ver `test_b1_h1_reabrir_14set.js`, secção "Reabrir
orçamento".

---

## 5. Pesquisa em Leads e Tarefas

### Leads — classificação: era 🐞 QUEBRADO → **corrigido nesta entrega**

A pesquisa global (`#global-search`, função `globalSearch()`, linha
19702) já tentava cobrir Leads, mas usava campos que **nunca existiram**
nos objetos reais de `crmLeads` — `l.title` e `l.company` (a estrutura
real usa `n`/`emp`/`tel`/`email`/`numLead`, confirmado no
canonical-data-map e no próprio `ob-leads` lido nesta sessão). Isto
significava:
1. a pesquisa de leads nunca encontrava nada (campos undefined não batem
   com o texto pesquisado — mas o problema real era pior);
2. `l.title.toLowerCase()` com `l.title===undefined` **lança
   `TypeError`** no primeiro lead real do array, interrompendo
   `globalSearch()` antes de chegar ao bloco seguinte (Membros de equipa).

Corrigido: agora pesquisa por **nome/empresa** (`l.emp||l.n`, e também
`l.n` isoladamente), **telefone** (`l.tel`), **email** (`l.email`),
**nº lead** (`l.numLead`) e **orçamento relacionado** (cruza `orcData`
por `o.leadId===l.id` e pesquisa também `o.num`). O clique no resultado
passou a abrir o lead real (`obAbrirLead(l.id)`) em vez de só navegar
para a página genérica do Pipeline.

### Tarefas — classificação: ⚠️ PARCIAL → **melhorado nesta entrega**

Confirmado (por leitura de código, reconfirmando o achado do documento
anterior): `ob_tasks` (tabela) nunca é referenciada em `index.html` — zero
ocorrências — e não existe secção "Tarefas" no Meu Painel. **Mas existe,
sim, uma página de Tarefas própria fora do Meu Painel**: `#page-home`
("Todas as tarefas" — título em `#home-title`), alimentada por
`homeTasksData` (array em `localStorage['ob-home-tasks']`, com
`homeAppTasks` fundido via `homeSyncApp()`), com vistas Lista/Quadro/
Calendário/Gantt e filtros por Responsável/Estado/Prioridade/Data
(`HOME_FILTERS`, `homeApplyFilters()`).

Essa página já tinha filtros (dropdowns), mas **nenhum campo de pesquisa
livre por texto**. Como pediu o enunciado ("se faltar apenas um filtro de
interface sobre dados já carregados em memória"), foi adicionado:
- `HOME_FILTERS.texto` (novo campo, default `''`);
- um `<input id="hflt-texto">` na barra de filtros de `#page-home`;
- em `homeGetFilteredTasks()`, um filtro adicional que pesquisa por
  **título** (`t.title`), **responsável** (`t.assNome`/`t.ass`),
  **estado** (`t.status`) e **texto/notas** (`t.extras.descricao`, quando
  existe). Não existe um campo "cliente" nas tarefas genéricas de
  `#page-home` (são tarefas por departamento, não ligadas a um cliente —
  diferente de `ob_uni_items`/Design-Produção-Instalações, que também têm
  "page" e "client" mas são ecrãs completamente separados, fora do âmbito
  desta correção), por isso não foi pesquisado — documentado, não
  inventado.

Nenhuma nova query, nenhuma nova tabela — o filtro opera só sobre
`homeTasksData`, já em memória.

### Testes executados
`test_pesquisa_leads_tarefas_14set.js`: 24 asserções (16 para Leads, 8
para Tarefas), todas passaram — casos incluem match por nome/empresa,
telefone, email, nº lead, orçamento relacionado, ausência de match, e
confirmação de que um lead com campos em falta já não lança `TypeError`;
e para Tarefas, match por título/responsável/estado/notas e "sem texto
devolve tudo".

---

## Testes obrigatórios — execução real

### 1. Sintaxe integral de `index.html`
Método: `node --check` não lê HTML diretamente, por isso foi extraído
todo o JS inline (`<script>` sem `src=`, 17 blocos, 1.652.335 caracteres
no total) para um único ficheiro `.js` concatenado, e corrido:
```
node --check inline_all.js
EXIT CODE: 0
```
Corrido duas vezes (antes e depois das correções de pesquisa Leads/
Tarefas) — ambas com exit code 0, sem erro de sintaxe.

### 2. Regressão de suite de testes existente
Procurado `package.json` e ficheiros `*.test.*` na raiz e subpastas do
repositório: **não existe `package.json`** e **não existe framework de
testes formal** (Jest/Mocha/etc.) no projeto. Existe uma convenção
informal de scripts `test_*.js` avulsos no scratchpad de sessões
anteriores (não versionados no repo, não uma suite corrida
automaticamente) — confirmado, documentado, nada para "correr" como
regressão formal além do que esta sessão já escreveu e correu.

### 3. Teste dedicado B1
`node test_b1_h1_reabrir_14set.js`, secções B1 (3 blocos): **17
asserções, todas OK**. Cobre os 4 cenários pedidos: (1) orçamento com
`owner_id=CU.id` e `vendedor` de outro nome aparece; (2) orçamento com
`vendedor` igual ao nome mas `owner_id` de outro utilizador não aparece;
(3) admin vê tudo; (4) confirmado por leitura de código que
`fuMinhasOrc()`/Follow-up usam o mesmo critério corrigido.

### 4. Teste dedicado H1
Mesmo ficheiro, secção H1: **6 asserções, todas OK** — sequência
render-stale → fetch assíncrono → 2º render com dados reais → navegação
para outro ecrã (sem duplo render) → falha de rede (sem travar, sem
render extra).

### 5. Teste de pesquisa Leads
`node test_pesquisa_leads_tarefas_14set.js`, secção Leads: **16
asserções, todas OK**.

### 6. Teste de pesquisa Tarefas
Mesmo ficheiro, secção Tarefas: **8 asserções, todas OK**.

### 7. Teste de reabrir orçamento (mock)
`test_b1_h1_reabrir_14set.js`, secção "Reabrir orçamento": **12
asserções, todas OK** — confirma que `orcGuardar()` só cria, que
`_sbOrcUpsert()` preserva id/num/owner_id/projectId/históricos, e que o
optimistic locking recusa gravações em conflito. Nenhum UPDATE real foi
executado — tudo simulado em memória Node.

### 8. Optimistic locking de `ob_orcamentos`
**Confirmado que existe e funciona** (não é uma alteração desta entrega —
já estava implementado antes): `_sbOrcUpsert()` usa
`orc._sbVersaoConhecida` (populado por `_sbOrcLoadAll()` a partir de
`row.updated_at`) como condição `.eq('updated_at', versaoConhecida)` num
UPDATE condicional; zero linhas afetadas + versão conhecida = conflito
explícito (`reason:'conflict'`), nunca sobrescreve nem funde às cegas.
Testado no ponto 7 acima com um cenário de `updated_at` divergente.

### Resumo dos totais de testes
57 asserções automatizadas correram nesta sessão (33 em
`test_b1_h1_reabrir_14set.js` + 24 em
`test_pesquisa_leads_tarefas_14set.js`), **0 falhas**. Scripts guardados
em `/tmp/.../scratchpad/` (fora do repositório, como pedido para
ficheiros de teste avulsos deste projeto).

---

## Ficheiros alterados/criados nesta entrega

- `index.html` — editado (92 inserções, 20 remoções, `git diff --stat`):
  B1 (renderMeuPainel, fuMinhasOrc, agItensLeadsOrcamentos, agListaUnificada,
  agCandidatosTopHoje, agGerarTopHoje, agObterTopHoje, agRenderTopHoje), H1
  (`_orcInitFromSB`), pesquisa Leads (`globalSearch`), pesquisa Tarefas
  (HTML de `#page-home` + `homeGetFilteredTasks` + `HOME_FILTERS`).
- `supabase/migrations/20260914150000_ob_crm_atividades_canonico.sql` —
  novo, **não aplicado**.
- `supabase/rollback/20260914_ob_crm_atividades_canonico_rollback.sql` —
  novo, corresponde à migration acima.
- `docs/final-gaps-audit.md` — este ficheiro.

## Confirmação explícita

Nenhuma SQL de escrita foi executada (só `SELECT`/`jsonb_array_elements`
via `mcp__Supabase__execute_sql`, projeto `ddzlbmnmsdyodouqxbjx`). Nenhuma
migration foi aplicada (`apply_migration` nunca foi chamada). Nada foi
tocado em `main`, `preview`, nem em produção. Nenhum commit nem push foi
feito — o repositório fica com as alterações no working tree, para
revisão por outra sessão, conforme instruído.
