# Fase 4 — Resultado da Etapa 6 (leitura/escrita autenticada de ob_orcamentos)

Nada publicado — tudo só no branch `claude/crm-opportunitybox-cleanup-q737hx`.

---

## 1. Mapeamento — todas as funções que tocam `ob_orcamentos` (feito antes de qualquer alteração)

| Função | O que fazia | Tocada nesta etapa? |
|---|---|---|
| `_sbOrcHeaders()` | Cabeçalhos com a chave anon fixa | **Não** — partilhada com `ob_uni_items` (fora do âmbito) |
| `_sbOrcUpsert(orc)` | Cria/atualiza um orçamento no Supabase | **Sim** — passou a usar `crmSBClient()` autenticado |
| `_sbOrcLoadAll()` | Lê todos os orçamentos | **Sim** — passou a usar `crmSBClient()` autenticado |
| `_orcInitFromSB()` | Corria sozinho ao carregar a página, antes de qualquer login | **Sim** — deixou de correr sozinho; passou a ser chamado só depois de sessão+perfil validados |
| `orcGetData()` | Lê os campos do formulário, define `vendedor` a partir de `CU.name` | Não — só passou a ser usada por `orcGuardar` sem alterações próprias |
| `orcGuardar()` | **Cria** um orçamento novo (nunca edita um existente — sempre `unshift`) | **Sim** — passou a aguardar o resultado da sincronização e a avisar se falhar |
| `orcChangeStatus(orcId, novoEstado)` | **Altera o estado** de um orçamento existente (única função de edição que existe) | **Sim** — idem |
| `orcRenderList()` | Lista os orçamentos; botão "ficha técnica" só visível se `CU.admin` (cosmético — a barreira real já era o RLS desde a migration #8) | Não |
| `importarOrcamentos2026()` | Importação em massa de um histórico fixo | Não — nunca chamou `_sbOrcUpsert`; só grava em local/localStorage (falha pré-existente, fora do âmbito) |
| `importarOrcamentosExcel(file)` | Importação de Excel | Não — pela mesma razão; confirmado por leitura completa da função |
| linha ~4146 (faturação) | Marca `orc.st='Faturado'` | Não — já não chamava `_sbOrcUpsert` antes desta etapa (falha pré-existente, fora do âmbito) |
| `crmEnterAppWithProfile(profile)` | Ponto de entrada na app depois de sessão+perfil validados (Etapa 3/4) | **Sim** — ganhou 1 chamada a `_orcInitFromSB()` |
| `crmRealLogout()` (Etapa 5) | Termina sessão e limpa `CU` | **Sim** — ganhou a limpeza da cópia local de orçamentos |
| `doLogout()` | Função antiga de logout, reaproveitada só para limpar `CU`/esconder a app | **Não tocada** nesta etapa (continua só com a linha do `_crmAuthGen` da Etapa 4) |

**Confirmado por grep exaustivo**: não existe, em lado nenhum do ficheiro, uma função de **apagar** um orçamento nem de **mudar o dono** de um orçamento já existente — nem botão, nem `onclick`, nem endpoint chamado. As únicas duas escritas em `ob_orcamentos` são a criação (`orcGuardar`) e a mudança de estado (`orcChangeStatus`).

---

## 2. O que mudou

### `_sbOrcUpsert(orc, opts)`
- Deixou de usar `fetch()` + chave anon fixa. Passa a usar `crmSBClient().from('ob_orcamentos').upsert(...)` — a mesma sessão autenticada do login real.
- **Sem sessão (`CU` inexistente), nem tenta ir à rede** — devolve `{ok:false, reason:'no-session'}` de imediato.
- `owner_id` **nunca vem do formulário**: se `CU.admin !== true`, é sempre forçado a `CU.id`, mesmo que algo tente passar outro valor (testado — ver teste 7). Só um admin, e só se passar explicitamente `opts.reassignOwnerId`, consegue gravar um dono diferente — e mesmo assim é a política RLS de `INSERT`/`UPDATE` da base de dados que decide se é permitido, não este código.
- `created_by` só é enviado quando `opts.isCreate === true` (chamado por `orcGuardar`) — nunca reescrito numa atualização de estado, para não apagar o valor gravado na criação.
- Erros deixam de ser só um `console.warn` — a função devolve sempre `{ok, reason, message}`, com 4 categorias distintas (ver secção 4).

### `_sbOrcLoadAll()`
- Mesma mudança: `crmSBClient()` autenticado em vez de `fetch()` com a chave anon. Sem sessão, não tenta ir à rede.
- Passa a devolver `{ok, rows, reason, message}` em vez de `array|null` — quem chama sabe sempre distinguir "0 orçamentos, mas sem erro" de "falhou".

### `_orcInitFromSB()`
- **Deixou de correr sozinho ao carregar a página.** Antes era uma IIFE (`(async function(){...})()`) que disparava mal o `<script>` era interpretado, antes de existir qualquer sessão — desde a migration #8, isto já nem funcionava (a chave anon já não vê nenhuma linha, RLS bloqueia), mas continuava a tentar.
- Agora é chamada explicitamente por `crmEnterAppWithProfile()`, e só depois de sessão + perfil terem sido validados (mesmo ponto de entrada usado tanto pelo arranque com sessão persistida como por um login novo).
- **Mudança de comportamento relevante, sinalizada aqui de propósito**: deixou de existir o ramo antigo de "se o Supabase estiver vazio, migra tudo o que está local para lá". Esse comportamento fazia sentido só na primeira vez que a tabela existiu; hoje "vazio" pode simplesmente significar "este comercial não tem orçamentos seus" — continuar a tratar isso como "faltam dados, sobe tudo o que está no browser" era ativamente errado com RLS. Agora a lista local **é sempre substituída pela resposta da base de dados**, mesmo vazia — nunca fica com uma mistura da sessão anterior.

### `orcGuardar()` (criação) e `orcChangeStatus()` (mudança de estado)
- Ambas passaram a `async` e a **aguardar** o resultado de `_sbOrcUpsert` (antes era "dispara e esquece").
- Continuam a guardar sempre em localStorage primeiro — nunca perdem o trabalho do utilizador só porque a rede falhou.
- Se a sincronização falhar, o utilizador é avisado de forma visível e específica (mensagem no formulário para `orcGuardar`; `showToast` para `orcChangeStatus`) — nunca em silêncio.

### `crmEnterAppWithProfile()` — 1 linha acrescentada
Chama `_orcInitFromSB()` depois dos outros passos de arranque da app (mesmo padrão dos outros `try{...}catch(e){}` já ali existentes). Não mexe no resto da função.

### `crmRealLogout()` (Etapa 5) — limpeza acrescentada
Depois de `doLogout()`, limpa `orcData` e a chave `ob-orcamentos` do `localStorage`. **Justificação**: sem isto, um segundo utilizador a entrar no mesmo browser logo a seguir podia ver por instantes a cache de orçamentos da conta anterior, antes da nova sincronização terminar — o que contraria diretamente o requisito de nunca mostrar dados de outra pessoa. Só `ob_orcamentos` é limpo; nenhum outro módulo (Equipa, stock, despesas, etc.) é tocado. `doLogout()` em si **não foi alterada**.

### O que não foi tocado
`_sbOrcHeaders()`, `_ORC_SB_URL`, `_ORC_SB_KEY` — continuam exatamente como estavam, ainda usados por `ob_uni_items` (produção), `ob_stock` (cópia própria da mesma função) e `ob_crm_dados`. `doLogout()`, `USERS`, `LOGIN_PASSWORDS`, a página Equipa, `ob_stock`, `ob_despesas` — nada disto foi tocado.

---

## 3. Como `owner_id` passa a ser tratado

```
comercial cria/edita  → owner_id = CU.id, sempre — mesmo que o objeto local
                          tenha outro valor, é ignorado
admin cria/edita       → owner_id = CU.id, a não ser que passe explicitamente
                          opts.reassignOwnerId (não existe UI para isto — ver
                          secção 6)
qualquer escrita        → a política RLS (INSERT: created_by=auth.uid() AND
                          (admin OR owner_id=auth.uid()); UPDATE: exige
                          ob_can_see() tanto na linha antiga como na nova)
                          é sempre a decisão final — este código só evita
                          pedidos que já sabemos de antemão que iam falhar
```

---

## 4. Fluxo de leitura

```
sessão + perfil validados (crmEnterAppWithProfile)
  → _orcInitFromSB()
  → _sbOrcLoadAll()
     → sem CU/sessão → {ok:false, reason:'no-session'} — nunca vai à rede
     → crmSBClient().from('ob_orcamentos').select('*')...
       → RLS decide as linhas devolvidas (admin/manager vê tudo o que gere,
         comercial só as suas) — o código não filtra nada, só mostra o que veio
     → erro 401 → 'session-expired' → "A tua sessão expirou..."
     → erro de rede (exceção) → 'network' → "Não foi possível ligar..."
     → sucesso, 0 linhas → resposta legítima, NÃO é tratada como erro
  → substitui sempre orcData pela resposta da BD (nunca mistura com cache
    de uma sessão anterior) → orcRenderList()
```

## 5. Fluxo de criação/edição

```
CRIAR (orcGuardar):
  formulário → orcGetData() → guarda local (localStorage) primeiro
  → _sbOrcUpsert(d, {isCreate:true})
     → sem sessão → aviso, fica só local
     → owner_id = CU.id (comercial) — nunca escolhido pelo formulário
     → created_by = CU.id (só agora, é uma criação verdadeira)
     → RLS aceita (created_by=próprio E (admin OU owner_id=próprio))
  → sucesso → "✓ guardado com sucesso"
  → falha (rede/RLS/dados inválidos) → "⚠ guardado só neste dispositivo — <motivo>"

EDITAR ESTADO (orcChangeStatus — única forma de "editar" que existe):
  → altera local + localStorage primeiro
  → _sbOrcUpsert(orc)  [sem isCreate — created_by nunca reescrito]
     → owner_id = CU.id (comercial) ou explícito (admin com reassignOwnerId)
     → RLS UPDATE verifica ob_can_see() na linha ANTIGA — um comercial a
       tentar alterar um orçamento que já não é dele é bloqueado aqui,
       mesmo que o pedido tenha sido forjado diretamente na consola do
       browser (não só através da UI)
  → falha → showToast com o motivo; sucesso → segue o fluxo normal
    (webhook ClickUp, baixa de stock, etc. — inalterados)
```

---

## 6. Decisão registada: não foi criada uma função/UI de reatribuição de dono

O mapeamento (secção 1) confirmou que não existe hoje nenhum botão nem função para um admin mudar o dono de um orçamento já existente. O requisito era sobre **como** essa reatribuição deve funcionar *se/quando existir* (explícita, só admin, validada pelo RLS) — não pedia a construção de uma interface nova. `_sbOrcUpsert` já está preparado para receber `opts.reassignOwnerId` (testado no cenário 10, chamando a função diretamente), mas **não foi acrescentado nenhum botão/ecrã** para isso — seria uma funcionalidade nova, não uma correção do que já existia, e ficaria fora de "altera apenas os pontos necessários". Fica registado como possível próximo passo, a pedir separadamente se for para avançar.

---

## 7. Testes simulados — os 15 pedidos, todos cobertos e a passar

Mesma técnica das Etapas 4/5 (SDK do Supabase totalmente mockado via `page.addInitScript`, sem rede real), desta vez com um mock que reproduz fielmente as políticas RLS **reais** lidas diretamente da base de dados (`ob_can_see`, `ob_is_admin`, e as 4 políticas de `ob_orcamentos` — insert/select/update/delete) — não são respostas fixas, é a mesma lógica de autorização a decidir.

| # | Cenário pedido | Resultado |
|---|---|---|
| 1 | Admin carrega todos os orçamentos | ✅ 2/2 devolvidos |
| 2 | Comercial carrega só os seus | ✅ 1/2 devolvido (só o próprio) |
| 3 | Sem sessão bloqueado | ✅ `{ok:false, reason:'no-session'}`, **0 pedidos à rede** |
| 4 | Sessão expira durante a leitura | ✅ `reason:'session-expired'`, mensagem própria, nunca confundida com credenciais |
| 5 | Falha de rede | ✅ `reason:'network'`, mensagem própria |
| 6 | Comercial cria com owner correto | ✅ `owner_id`/`created_by` = o próprio, sempre |
| 7 | Comercial tenta atribuir a outro | ✅ ignorado pelo próprio código — grava sempre o próprio id, mesmo que se tente forçar outro |
| 8 | Editar (mudar estado) o próprio orçamento | ✅ permitido |
| 9 | Tentar editar orçamento de outro comercial (via consola, não a UI — que já nem mostra o orçamento de outro) | ✅ bloqueado pelo RLS (`reason:'rls-denied'`), orçamento alvo **inalterado** |
| 10 | Admin muda o dono explicitamente | ✅ `owner_id` gravado passa a ser o novo dono |
| 11 | Comercial tenta apagar (não existe botão — testado diretamente contra a tabela, o mesmo que aconteceria numa manipulação de consola) | ✅ bloqueado pelo RLS, linha continua lá |
| 12 | Admin apaga | ✅ permitido, linha removida |
| 13 | Resposta vazia legítima | ✅ `{ok:true, rows:[]}` — não gera nenhum aviso de erro |
| 14 | Erro de RLS devolve mensagem distinta | ✅ combinado com o teste 9 — mensagem "Não tens permissão para esta operação neste orçamento.", diferente da de sessão expirada e da de rede |
| 15 | Duas sincronizações simultâneas do mesmo orçamento | ✅ ambas resolvem sem exceção; estado final consistente (uma das duas escritas "ganha", sem corrupção nem duplicação) |

**14 chamadas de teste, 15/15 cenários cobertos, 14/14 passaram** (o teste 9 cobre também o 14).

---

## 8. Limitações sem Supabase real
Os mesmos limites de sempre nesta fase: o mock reproduz a *lógica* das políticas RLS tal como lidas da base de dados (`ob_can_see`, `ob_is_admin`, e as 4 políticas de `ob_orcamentos`), mas não substitui correr isto contra o Supabase verdadeiro com as 5 contas reais — isso continua reservado para a Etapa 8. Em particular:
- Nunca vi o formato exato de um erro real de RLS devolvido pelo PostgREST/Supabase (código `42501`, mensagem "row-level security policy") nem de um JWT expirado a meio de um pedido real — a classificação de erros (`_sbOrcClassificarErro`) foi construída a partir da documentação/comportamento conhecido do PostgREST, não observada ao vivo.
- Não testei a interação real com `autoRefreshToken` durante uma escrita longa.
- Confirmei diretamente na base de dados (antes de escrever qualquer código) as 4 políticas de `ob_orcamentos` e as colunas `owner_id`/`created_by`/`updated_by` (nullable, sem default) — não assumidas.

## Commit
Separado, só no branch de trabalho.
