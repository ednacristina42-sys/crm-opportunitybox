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
  (chave natural = o `ts` original — ver correção abaixo, NÃO é `unique`
  sozinha), ts timestamptz, tipo, texto, autor (só exibição), owner_id uuid
  (nullable, `references ob_profiles`), orc_num text, lead_id text,
  resultado text, extra jsonb (acao/canal/clienteId/data/due/origem/
  prioridade/tags/extra), created_at, `unique(legacy_ts, orc_num)`
  composto`.
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
  jsonb_array_elements ... JOIN ob_orcamentos ... ON CONFLICT (legacy_ts,
  orc_num) DO NOTHING`), mas **só para as 767 atividades com `orcId` que
  casa** — idempotente, sem duplicar se corrida mais de uma vez. As 467 sem
  derivação segura **não são inseridas** por este script.
- A chave antiga `ob_crm_dados['ob-crm-atividades']` **não é tocada** —
  fica exatamente como está, blob completo, continua a ser a fonte real
  até uma fase futura decidir cortar/migrar o frontend.

### 3d. Bug encontrado e corrigido nesta sessão: `legacy_ts` não é chave
natural segura sozinha

Antes de aplicar a migration (nunca aplicada — só revalidada por `SELECT`,
projeto `ddzlbmnmsdyodouqxbjx`), foi feita uma segunda passagem de
validação sobre a própria migration preparada na sessão anterior, que
revelou um bug real no desenho da chave de idempotência:

| Métrica (SQL de leitura, revalidada nesta sessão) | Valor |
|---|---|
| Total de atividades no blob | **1234** |
| Valores de `ts` distintos, no total das 1234 | **1125** (109 duplicados — lotes `TopHojeItem` gerados de uma vez por `agGerarTopHoje()`, com o mesmo timestamp para várias atividades) |
| Atividades com `orcId` preenchido (subconjunto que o backfill insere) | **767** |
| Valores de `ts` distintos **dentro** desse subconjunto de 767 | **704** |
| Atividades desse subconjunto que um `unique(legacy_ts)` sozinho, com `ON CONFLICT (legacy_ts) DO NOTHING`, descartaria em silêncio | **63** |
| Valores distintos da chave composta `(ts, orcId)` dentro do mesmo subconjunto de 767 | **767** (0 colisões — confirmado também por `count(distinct md5(a::text))` = 767, o hash do objeto completo dá o mesmo resultado) |

**Conclusão**: a migration original (sessão anterior) definia `legacy_ts
text not null unique` e fazia `ON CONFLICT (legacy_ts) DO NOTHING` no
backfill. Isso teria descartado **63 atividades reais em silêncio** (sem
erro, sem aviso) logo na primeira aplicação da migration, porque 767
atividades com `orcId` só têm 704 valores de `ts` distintos entre si.

**Correção aplicada ao ficheiro** (ainda não aplicada à BD):
1. `legacy_ts` deixou de ter `unique` sozinha na definição da coluna.
2. Foi adicionado `constraint ob_crm_atividades_legacy_uniq unique
   (legacy_ts, orc_num)` — chave composta, confirmada com 767/767 valores
   distintos no subconjunto real que o backfill insere.
3. O `ON CONFLICT` do `INSERT` de backfill passou de `(legacy_ts)` para
   `(legacy_ts, orc_num)`, coerente com o novo constraint.
4. Comentário no topo do ficheiro atualizado com os números exatos acima.
5. `supabase/rollback/20260914_ob_crm_atividades_canonico_rollback.sql`
   **não precisou de alteração** — continua a fazer só `drop table public.
   ob_crm_atividades` (que remove automaticamente qualquer constraint/índice
   associado à tabela, incluindo o novo `unique` composto, que é inline na
   definição da tabela e não um índice nomeado à parte).
6. Revalidado por `SELECT` (sem `INSERT`) que o `JOIN` do backfill com a
   correção continua a produzir exatamente **767** linhas — a correção da
   chave de conflito não muda a contagem esperada de atividades migradas.

Estado final: migration corrigida, **continua preparada mas NÃO aplicada**
(nenhuma chamada a `apply_migration` nesta sessão).

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

**Classificação: ✅ IMPLEMENTADO** (nesta sessão, 2026-09-14).

### Estado da entrega anterior (contexto)

`orcGuardar()` (linha 18371, na versão anterior) era o único ponto de
gravação ligado ao construtor visual, e **sempre criava** um orçamento
novo (`orcData.unshift(d)` + `_sbOrcUpsert(d, {isCreate:true})`).
`orcNew()` só limpava o formulário. O primitivo `_sbOrcUpsert(orc, opts)`
(linha 17683) já suportava tudo o necessário para um UPDATE seguro (mesmo
`id`/`num`, `owner_id`/`projectId`/históricos preservados via passthrough,
optimistic locking real por `updated_at`) — só faltava um caminho no
construtor visual que o chamasse com `isCreate:false` sobre um objeto já
existente.

### O que foi implementado

Reaproveitado **o mesmo formulário/construtor visual** já usado para criar
orçamentos (`#orc-cliente`, `#orc-lines-container`, etc.) — nenhum modal
ou sistema paralelo foi criado.

**Estado explícito de edição**: `var _orcEmEdicaoId = null;` (linha
~17638, declarada junto de `orcData`) — guarda o **próprio `orc.num`**
(que é o que a BD usa como coluna `id`: `_sbOrcUpsert` faz `row.id =
orc.num || orc.id`). Nunca é deduzido por nome/posição — é a **única**
condição que decide se `orcGuardar()` grava um UPDATE ou um INSERT.
Limpa-se: ao gravar uma edição com sucesso, ao cancelar
(`orcCancelarEdicao()`), e ao abrir "Novo Orçamento" (`orcNew()`).

**Funções alteradas/criadas** (linhas do ficheiro já corrigido):

| Função | Linha aprox. | O que faz |
|---|---|---|
| `orcGuardar()` | ~18371 | **Alterada**: no topo, verifica `_orcEmEdicaoId`; se aponta para um orçamento existente em `orcData`, entra no ramo de edição — `Object.assign(_orcExistente, d)` (só sobrescreve os campos que `orcGetData()` devolve; tudo o resto — `owner_id`, `projectId`, históricos, pagamentos, `st`/`stc`/`dt`, `_sbVersaoConhecida`, campos `extra` não mapeados no formulário — fica intacto por não ser tocado), reposiciona o **mesmo objeto** (nunca uma cópia) para `orcData[0]` (mantém a convenção já usada por wrappers existentes — materiais, agente de margem — que assumem `orcData[0]` = orçamento acabado de gravar), e chama `_sbOrcUpsert(_orcExistente, {isCreate:false})`. O caminho de criação original (sem `_orcEmEdicaoId`) fica **inalterado**, mais abaixo na mesma função. |
| `orcNew()` | ~18461 | **Alterada**: acrescentada uma linha `_orcEmEdicaoId = null;` + `orcCancelarEdicaoUI()` no início — garante que abrir "Novo Orçamento" nunca deixa um estado de edição pendurado. Resto da função **inalterado**. |
| `orcEditar(num)` | ~18491 | **Nova**. Procura `num` em `orcData` (só lá está o que a RLS já devolveu a esta sessão via `_sbOrcLoadAll()` — sem bypass de permissões possível); se não encontrar, avisa (`showToast`/`alert`) e não faz mais nada. Se encontrar: marca `_orcEmEdicaoId = orc.num`, pré-preenche cliente/morada/NIF/email/WhatsApp/prazo/prazo de entrega/validade/desconto/IVA, mostra o **número real** no badge (nunca `orcNextNum()`), reconstrói as linhas de produto a partir de `orc.linhas`, restaura imagem/imagem de fachada, e ativa a UI de modo edição (título do formulário + botão "Cancelar edição"). **Só lê `orcData` — nunca escreve nele.** |
| `orcCancelarEdicao()` | ~18559 | **Nova**. Limpa `_orcEmEdicaoId` e chama `orcNew()` — como `orcEditar()` nunca escreve em `orcData`, cancelar antes de gravar deixa o orçamento original intacto. |
| `orcMostrarEdicaoUI(num)` / `orcCancelarEdicaoUI()` | ~18568 / ~18574 | **Novas**, auxiliares — alternam o título do formulário ("Editar Orçamento X" vs "Novo Orçamento") e a visibilidade do botão "✖ Cancelar edição". |
| `orcRenderList()` | ~19543 (linha confirmada por Grep nesta sessão) | **Alterada**: acrescentado um botão `✏️ Editar` em cada linha da tabela, chamando `orcEditar('${o.num}')`. |
| HTML do formulário | ~7572 / ~7987 | `<h2>` do formulário ganhou `id="orc-form-titulo"`; acrescentado botão `#orc-cancel-edicao-btn` (escondido por omissão) junto ao botão "💾 Guardar". |

### Requisitos cumpridos
- reutiliza o mesmo formulário/modal existente — confirmado (nenhum HTML novo de formulário, só um título dinâmico e um botão de cancelar);
- ação clara "✏️ Editar" na lista (`orcRenderList()`);
- pré-preenche cliente, morada, NIF, email, WhatsApp, prazo, prazo de entrega, validade, desconto, IVA, linhas de produto, imagem e imagem de fachada a partir do objeto real em `orcData`;
- estado de edição explícito (`_orcEmEdicaoId`, o próprio `num`) — nunca deduzido por nome/posição;
- grava via `_sbOrcUpsert(orcAtualizado, {isCreate:false})` sobre o objeto já existente — nunca `orcData.unshift`/`isCreate:true` no caminho de edição;
- mantém `id`/`num` (nunca gera novo), `owner_id`, `created_by`, `projectId`, `leadId`, `historicoFinanceiro`/`historicoProducao`/`historicoLiquidacao`, `pagamentosAdiantamento`, informação TOConline/faturação e campos `extra` já conhecidos por este código (todo o conjunto que `_sbOrcLoadAll()` já sabe ler de volta — ver limitação abaixo) — passthrough automático por só sobrescrever o que `orcGetData()` devolve;
- respeita optimistic locking: conflito devolve `{ok:false, reason:'conflict'}`, mostra a mensagem já existente em `_sbOrcUpsert` (a mesma reutilizada por `orcChangeStatus`), e **não** limpa `_orcEmEdicaoId` nem sobrescreve nada — utilizador pode recarregar e tentar de novo;
- nunca gera novo número ao editar, nunca duplica;
- permissões: o botão "Editar" só pode agir sobre orçamentos já presentes em `orcData` (só o que a RLS já devolveu); sem bypass no frontend;
- modo de criação original **inalterado** — testado explicitamente (cenário 1 dos testes abaixo).

### Limitação conhecida, encontrada e documentada (não corrigida nesta entrega, fora do âmbito)
`_sbOrcUpsert()` reconstrói o campo `extra` (jsonb) a partir de uma lista
fixa de nomes (`dtProducao`, `aprovado_em`, `leadId`, `historicoFinanceiro`,
`projectId`, etc. — a mesma lista que `_sbOrcLoadAll()` sabe ler de volta).
Isto é **suficiente e seguro** para tudo o que este próprio ficheiro já
conhece (passthrough real, testado — ver cenário 9 abaixo), mas significa
que um campo **genuinamente novo** dentro de `extra`, nunca antes mapeado
por este JS (ex.: escrito diretamente na BD por outro sistema), **seria
perdido** numa escrita via `_sbOrcUpsert`. Esta é uma característica
**pré-existente e partilhada** do primitivo (usada tal e qual por
`orcChangeStatus`, `orcAtribuirProjectId`, etc. muito antes desta entrega)
— não foi introduzida pela funcionalidade de edição, e corrigi-la exigiria
alterar `_sbOrcUpsert()` para todos os seus 9 chamadores, o que está fora
do âmbito pedido ("só os 2 pontos", sem reabrir auditoria geral). Testado
e confirmado explicitamente (cenário "9b" no ficheiro de teste).

### Testes executados (mock isolado, nunca dados reais — ver Parte 3 abaixo)
Extraídas as funções reais (`_sbOrcUpsert`, `orcGuardar`, `orcNew`,
`orcEditar`, `orcCancelarEdicao`, `orcMostrarEdicaoUI`,
`orcCancelarEdicaoUI`) diretamente de `index.html` e executadas em sandbox
Node, com um cliente Supabase falso em memória (nunca liga à rede/BD
real). Ver `test_reabrir_orcamento_14set.js` — 56 asserções, **56/56
PASS**. Resultados detalhados na Parte 3 abaixo.

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

## Anexo — Sessão seguinte (2026-09-14): G1 corrigido + Reabrir orçamento implementado

Sessão dedicada só a dois pontos: (1) validar/corrigir o bug de chave
natural da migration G1 (secção 3d acima) e (2) implementar de facto
"Reabrir orçamento existente" (secção 4 acima, atualizada de ❌ para ✅).
Não reabriu nenhuma auditoria geral nova — usou este documento como
ponto de partida, mesma regra da sessão anterior.

### Testes desta sessão — execução real

**1. Sintaxe integral de `index.html` (depois das alterações de Reabrir Orçamento)**
Mesmo método já usado na sessão anterior — todo o JS inline extraído
(17 blocos, 1.660.418 caracteres) para um `.js` único e corrido:
```
node --check index_inline.js
EXIT CODE: 0
```

**2. Regressão — scripts de teste da sessão anterior, corridos de novo**
Ambos encontrados no mesmo scratchpad de sessão e corridos sem alteração,
depois das edições desta sessão a `index.html`, para confirmar que nada
regrediu:
```
node test_b1_h1_reabrir_14set.js
PASS: 33   FAIL: 0   EXIT: 0

node test_pesquisa_leads_tarefas_14set.js
PASS: 24   FAIL: 0   EXIT: 0
```
Nota: `test_b1_h1_reabrir_14set.js` tem uma asserção antiga cuja
**etiqueta** de texto ("orcGuardar() confirmado: SEMPRE cria um novo
orçamento... não há caminho de edição no construtor") ficou desatualizada
em relação à nova funcionalidade — mas a asserção em si só verifica que os
padrões literais `orcData.unshift(d);` e `_sbOrcUpsert(d, { isCreate: true
})` **continuam presentes** no ficheiro, o que é verdade (o caminho de
criação original foi mantido 100% intacto) — por isso continua a passar
legitimamente, sem falso positivo. Documentado aqui para transparência;
não foi alterado o script da sessão anterior (fora do âmbito desta
entrega).

**3. Teste novo — "Reabrir orçamento existente" (14 cenários pedidos)**
`node test_reabrir_orcamento_14set.js` — **56 asserções, 56 PASS, 0 FAIL**
(8 de verificação de código-fonte + 46 de comportamento, cobrindo os 14
cenários pedidos + 1 limitação conhecida documentada à parte). Extrai as
funções reais de `index.html` (`_sbOrcUpsert`, `orcGuardar`, `orcNew`,
`orcEditar`, `orcCancelarEdicao`, `orcMostrarEdicaoUI`,
`orcCancelarEdicaoUI`) e corre-as em sandbox Node com um cliente Supabase
falso em memória (nunca liga à rede/BD real — nenhum UPDATE real em
nenhum momento). Mapeamento cenário → resultado:

| # | Cenário pedido | Resultado |
|---|---|---|
| 1 | criar orçamento novo continua a criar 1 registo | PASS — orcData 1→2, servidor recebe 1 linha nova |
| 2 | editar existente não cria segundo registo | PASS — orcData length inalterado, servidor com 1 única linha |
| 3 | `id` permanece após editar | PASS |
| 4 | `num` permanece após editar | PASS |
| 5 | `owner_id` permanece após editar | PASS (local e no valor gravado no servidor) |
| 6 | `projectId` permanece após editar | PASS (local e no servidor) |
| 7 | históricos (financeiro/produção/liquidação) permanecem | PASS (local e no servidor) |
| 8 | pagamentos/adiantamentos permanecem | PASS — `pagamentosAdiantamento` passthrough real; `pagamento50`/`sinal`/`saldo` recalculados a partir do `prazo` tal como na criação (inalterados porque o `prazo` não mudou no cenário) |
| 9 | campos `extra` desconhecidos (não mapeados no formulário) permanecem | PASS — testado com `recebimentoTesourariaId` (campo real, não editável em UI nenhuma) |
| 10 | optimistic locking bloqueia edição com versão antiga | PASS — servidor não sobrescrito, `updated_at` inalterado, `_orcEmEdicaoId` não limpo, mensagem de conflito reutilizada |
| 11 | editar funciona sobre `orcData` recarregado do zero | PASS — `orcEditar()` chamado sobre um objeto "fresco" (sem estado de sessões anteriores) funciona igual |
| 12 | cancelar edição não altera nada | PASS — `orcData[0]` byte-a-byte igual antes/depois de `orcEditar()`+`orcCancelarEdicao()` |
| 13 | editar e guardar sem modificar nada não destrói dados | PASS — todos os campos (form + passthrough) idênticos antes/depois |
| 14 | utilizador sem permissão não ganha acesso | PASS — orçamento fora de `orcData` nunca fica editável; `_orcEmEdicaoId` continua `null`; nenhum bypass |

Bónus (fora dos 14, documentado à parte, não escondido): um cenário "9b"
confirma a limitação conhecida de `_sbOrcUpsert()` descrita na secção 4
acima (campo `extra` **genuinamente novo**, nunca antes mapeado por este
JS, não sobrevive — característica pré-existente e partilhada do
primitivo, não introduzida por esta funcionalidade).

### Resumo dos totais de testes desta sessão
`node --check`: 1 execução, exit 0. Regressão: 2 scripts, 57 asserções,
0 falhas. Teste novo: 1 script, 56 asserções, 0 falhas. **Total: 113
asserções automatizadas, 0 falhas.**

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

### Sessão seguinte (2026-09-14) — adicionalmente:
- `index.html` — editado de novo: `_orcEmEdicaoId` (estado global, linha
  ~17638), `orcGuardar()` (~18371, ramo de edição acrescentado),
  `orcNew()` (~18461, limpa `_orcEmEdicaoId`), `orcEditar()` (~18491,
  nova), `orcCancelarEdicao()`/`orcMostrarEdicaoUI()`/
  `orcCancelarEdicaoUI()` (~18559-18578, novas), `orcRenderList()`
  (~19543, botão "✏️ Editar"), HTML do formulário (~7572 título dinâmico,
  ~7987 botão "Cancelar edição"). `node --check` ao JS inline completo:
  exit 0.
- `supabase/migrations/20260914150000_ob_crm_atividades_canonico.sql` —
  corrigido (chave `(legacy_ts, orc_num)` composta em vez de `legacy_ts`
  sozinha — ver secção 3d). **Continua não aplicado.**
- `supabase/rollback/20260914_ob_crm_atividades_canonico_rollback.sql` —
  revisto, **sem alterações necessárias** (`drop table` já remove o
  constraint composto automaticamente).
- `docs/final-gaps-audit.md` — este ficheiro (secções 3c/3d e 4
  reescritas, anexo de testes acrescentado).

## Confirmação explícita

Nenhuma SQL de escrita foi executada em nenhuma das duas sessões (só
`SELECT`/`jsonb_array_elements` via `mcp__Supabase__execute_sql`, projeto
`ddzlbmnmsdyodouqxbjx`). Nenhuma migration foi aplicada (`apply_migration`
nunca foi chamada, em nenhuma das duas sessões). Nada foi tocado em
`main`, `preview`, nem em produção. Nenhum commit nem push foi feito em
nenhuma das duas sessões — o repositório fica com todas as alterações no
working tree (`git status --short` confirma só `index.html` e a migration
modificados, nada staged/committed), para revisão por outra sessão,
conforme instruído.
