# Fase 4 — Plano de autenticação real no CRM (aguarda aprovação)

Baseado numa exploração completa e fresca do `index.html` (24.812 linhas), feita
especificamente para este plano — não reaproveitei números de linha de auditorias
anteriores sem confirmar. **Nada foi implementado.** Este documento é só o plano.

---

## 1. Diagnóstico do login atual — os 12 pontos pedidos

**1. Onde está o login falso atual**
- `USERS` (array com 2 entradas reais: Paulo, Edna) — `index.html:9935`.
- `LOGIN_PASSWORDS` (passwords em texto simples, incluindo entradas mortas de
  pessoas que já não estão em `USERS`) — `index.html:9966-9978`.
- `loginComSenha()` (a verificação real, ligada ao botão) — `index.html:9999-10041`.
- Ecrã de login: `<div id="login">` em `index.html:5983` (visível por omissão);
  `<div id="app">` em `index.html:6055` (escondido por omissão).

**2. Onde o utilizador é guardado no navegador**
- **Em lado nenhum, de forma persistente.** `CU` (`index.html:9956`) é uma variável
  JS em memória — reinicia a `null` sempre que a página recarrega. A única coisa que
  sobrevive a um reload é `localStorage['ob-impersonate']` (guarda só o "ver como"
  de um admin, não uma sessão). Isto confirma o que já sabíamos: hoje não há sessão
  real nenhuma, cada reload obriga a fazer login outra vez.

**3. Onde é definido/alterado o `owner_id`**
- **Não existe nenhum `owner_id` no código do `index.html`** — nem na leitura nem na
  escrita de orçamentos. O que existe é um campo de texto livre `vendedor`, derivado
  do falso utilizador local em `orcGetData()`:
  ```
  index.html:14940: const vendedor = (CU) ? CU.name : 'Equipa OpportunityBox';
  ```
  Nunca é editável pelo utilizador no formulário — mas também nunca é validado no
  servidor, porque a chamada que grava (`_sbOrcUpsert`, `index.html:14610-14639`) usa
  só a chave anon, sem sessão. **Nota importante:** a coluna `owner_id` já existe na
  base de dados (criada e preenchida para os 577 registos na Fase 2) — só o
  `index.html` é que nunca chegou a lê-la nem a escrevê-la. É exatamente isso que
  esta fase corrige.

**4. Todas as consultas ao Supabase que dependem da chave anon**
- Orçamentos: `_sbOrcUpsert` (grava, `14632-14634`) e `_sbOrcLoadAll` (lê **todos**
  os orçamentos, sem filtro nenhum, `14643-14645`) — ambas usam
  `apikey`/`Authorization: Bearer <chave anon>` em `fetch()` direto, sem passar pelo
  cliente `crmSB`.
- Mesma chave/padrão, outras tabelas (fora do âmbito desta fase, só para
  referência): `ob_uni_items` (14701-14715), `ob_uni_atividades` (14726-14733),
  `ob_stock` (17977-17991), `ob_crm_dados` (24179-24245).
- 3 clientes Supabase criados separadamente (`createClient`): `_avSB` (2223-2225,
  duplica a URL/chave do CRM), `crmSB` (2442-2445, o cliente do próprio CRM — sem
  nenhuma chamada `.auth.*` hoje), `ecSupabase` (2447-2457, projeto **diferente**,
  módulo "Equipa em Campo" — já tem login real, serve de modelo).

**5. Quais funcionalidades deixarão de funcionar sem sessão real**
- Já deixaram, parcialmente: desde a migration #8, `_sbOrcLoadAll()` já devolve 0
  orçamentos (a RLS bloqueia o pedido anónimo) — a lista de orçamentos no site
  publicado está hoje vazia, silenciosamente. Depois desta fase, volta a funcionar,
  mas só para quem tiver sessão real.

**6/7. Partes a alterar / funções reaproveitáveis**
Ver secção 3 (ficheiros e âmbito exato).

**8/9. `owner_id` nunca escolhido pelo frontend, sempre da sessão**
Ver Etapa 6 (secção 4) — mesmo padrão que hoje já existe para `vendedor` (linha
14940), só que a substituir `CU.name` por `session.user.id`, nunca um campo de
formulário.

**10. Consultas a `ob_orcamentos` com sessão real + RLS**
Ver Etapa 6 — troca do cabeçalho `Authorization` da chave anon fixa para o
`access_token` da sessão da pessoa.

**11. Eliminar a dependência do login falso**
`LOGIN_PASSWORDS` e a verificação de password em `loginComSenha()` são removidas.
**Pergunta em aberto (preciso da tua decisão):** o array `USERS` também alimenta a
página "Equipa" (gestão de colaboradores, sincronizada com Google Sheets —
`gsSync()`, `index.html:17073-17082`), que é uma funcionalidade separada da
autenticação. Posso: (a) deixar `USERS`/Google Sheets como está para essa página por
agora, e migrar só a autenticação; ou (b) já ligar também a página "Equipa" a
`ob_profiles`. Recomendo (a) para esta fase, por ser mais localizado — (b) fica
proposto como fase seguinte, separada.

**12. Utilizador sem perfil / perfil inativo**
Ver Etapa 8 (secção 4) e a nota na secção "Migrations necessárias" — a verificação
de `active` ainda não está aplicada em nenhuma política (gap já identificado na Fase
2), e esta fase é a altura certa de a fechar, já que é um requisito explícito teu.

---

## 2. Arquitetura proposta

```
Login (email+password)
  → supabase.auth.signInWithPassword()          [crmSB, novo]
  → sessão Supabase (JWT, persistida em localStorage['ob-crm-auth'])
  → carregar linha de ob_profiles pelo id da sessão
  → validar active=true, senão bloquear com mensagem clara
  → construir CU no MESMO formato que o resto do ficheiro já espera
    ({id, name, admin, dept, color, email}) — assim os ~75 pontos do
    ficheiro que já leem CU.admin/CU.dept não precisam de ser tocados
    um a um
  → todas as chamadas a ob_orcamentos passam a usar o access_token da
    sessão em vez da chave anon fixa
  → RLS (já aplicada na migration #8) filtra os dados de verdade
```

A decisão de desenho mais importante: **construir um `CU` "de compatibilidade"** a
partir de `ob_profiles`, com os mesmos nomes de campo que o código já usa
(`admin`, `dept`, `name`, `color`, `id`) — isto é o que torna possível não reescrever
os ~75 sítios espalhados pelo ficheiro que leem `CU.*`. Só o que **cria/autentica**
`CU` muda; o que **lê** `CU` fica igual.

---

## 3. Ficheiros que serão alterados

**Só um ficheiro: `index.html`.** Nenhum ficheiro novo, nenhuma alteração ao
`netlify.toml`. Alterações localizadas às zonas identificadas na secção 1 — não uma
reescrita geral.

| Zona | Linhas aproximadas | O que muda |
|---|---|---|
| `crmSBClient()` | 2442-2445 | Acrescentar `auth:{persistSession:true, autoRefreshToken:true, storageKey:'ob-crm-auth'}` |
| Novo bloco de helpers de auth | perto de 2445 (novo código) | `crmAuthLogin`, `crmAuthLogout`, `crmAuthGetSession`, `crmAuthLoadProfile` |
| Boot (`renderLogin()`) | 17651-17656 | Verificar sessão existente antes de mostrar o login |
| `loginComSenha()` | 9999-10041 | Substituída por chamada a `crmAuthLogin` |
| `doLogout()` | 10100-10107 | Acrescentar `crmSB.auth.signOut()` |
| HTML do formulário de login | 6012-6035 | Trocar dropdown+password por campos email+password |
| `_sbOrcUpsert`/`_sbOrcLoadAll` | 14610-14672 | Cabeçalho de autenticação passa a usar o token da sessão; `owner_id`/`created_by` acrescentados ao objeto gravado |
| `orcGetData()` | 14928-14944 | `vendedor` continua igual (nome), mas passa a vir do perfil da sessão, não de `CU.name` local desligado |

**Fora do âmbito, propositadamente:**
- O bloco `pdfHTML` (15291-15576) tem uma cópia **morta** e inerte de código de login
  antigo (string de um popup de impressão, nunca executa). Não vou tocar-lhe — mexer
  num template gigante desse tamanho é risco desnecessário para algo que não corre.
- Encontrei, por acaso, que não há nenhum `DOMContentLoaded` a chamar `ecInit()`/
  `ckInit()` no código vivo (só existe dentro do bloco morto acima) — pode ser um bug
  pré-existente, não relacionado com autenticação. Não mexo nisto agora; fico a
  registar para decidires separadamente se queres que investigue.
- Página "Equipa"/Google Sheets — ver ponto 11 acima, decisão em aberto.
- Importação de orçamentos por Excel (lê `vendedor` de uma coluna da folha) — não
  ganha `owner_id` automático nesta fase; fica com `owner_id null` até seres tu a
  associar manualmente (mesmo mecanismo da migration #7).

---

## 4. As 9 etapas, cada uma testável isoladamente

**Etapa 1 — Mapear** ✅ Feita (este documento).

**Etapa 2 — Adicionar Supabase Auth real (só infraestrutura, aditivo)**
Novas funções `crmAuthLogin/Logout/GetSession/LoadProfile`. Zero risco — nada as
chama ainda, o login antigo continua 100% funcional.
*Teste:* na consola do browser, chamar `crmAuthLogin(email,password)` com uma das
5 contas reais e confirmar que devolve sessão + perfil corretos.

**Etapa 3 — Bloquear o carregamento do CRM sem sessão**
Acrescenta a verificação de sessão no boot, antes de mostrar o login antigo.
*Teste:* com uma sessão ativa (da Etapa 2), recarregar a página e confirmar que salta
o ecrã de login.

**Etapa 4 — Carregar o perfil a partir de `ob_profiles`**
Construção do `CU` de compatibilidade a partir da linha de `ob_profiles`.
*Teste:* confirmar `CU.admin`/`CU.dept`/`CU.name` corretos para uma conta admin e uma
comercial; confirmar que o topo/menu lateral renderizam certo para as duas.

**Etapa 5 — Substituir o formulário de login**
Corta o `LOGIN_PASSWORDS`/dropdown, liga o formulário novo a `crmAuthLogin`; logout
real.
*Teste:* login real de ponta a ponta com uma conta comercial e uma admin.

**Etapa 6 — Corrigir consultas de orçamentos**
Token da sessão em vez da chave anon fixa; `owner_id`/`created_by` gravados a partir
da sessão.
*Teste:* Rui cria um orçamento de teste → confirmo no Supabase que `owner_id` é o
UUID do Rui; Rui só vê os seus; Humberto não vê o de teste do Rui.

**Etapa 7 — Logout e recuperação de password**
Fluxo "esqueci-me da password" via `resetPasswordForEmail`.
**Dependência a resolver contigo:** o link do email de recuperação aponta para o site,
que está atrás da password de Basic Auth (a que geraste para veres as alterações) —
quem clicar no link vê primeiro um pedido de password do browser, antes de chegar ao
CRM. Preciso que decidas: (a) eu isento esse caminho específico da Basic Auth, ou (b)
a recuperação de password fica, por agora, só através do admin no Dashboard (como já
está a acontecer), até tirarmos a Basic Auth de vez.

**Etapa 8 — Testes com contas reais**
Não tenho as passwords de ninguém (por desenho, nunca as vejo) — estes testes têm de
ser corridos por vocês, num browser real, seguindo um checklist que preparo (login
admin, login comercial, conta sem perfil, conta inativa, sem sessão). Detalho no
próximo documento de testes, antes de implementar.

**Etapa 9 — Publicar**
Proposta: publicar primeiro num branch separado (não `main`), para poderes ver o
resultado no URL de pré-visualização do Netlify antes de ir para produção — evita
teres de aprovar "às cegas". Só depois de validares aí é que passo para `main`.

---

## 5. Migrations necessárias

**Nenhuma migration de schema é obrigatória** — a estrutura (`ob_profiles`,
`owner_id`/`created_by`/`updated_by` em `ob_orcamentos`, RLS da migration #8) já está
toda pronta e testada. Uma migration **fica proposta**, por seres tu quem definiu o
requisito de "perfil inativo" ter de ser mesmo bloqueado, não só escondido:

```sql
-- já desenhada na Fase 2, nunca aplicada — fecha o gap do active=false
create or replace function public.ob_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' and active from public.ob_profiles where id = auth.uid()), false)
$$;
-- mesmo ajuste em ob_manages() e ob_can_see() (via a subquery de ob_profiles que já usam)
```
Sem isto, desativar alguém no `ob_profiles` (`active=false`) não bloqueia nada ao
nível da base de dados — só um "Ban user" no Supabase Auth bloqueia de facto hoje.
Recomendo aplicar esta migration junto com a Fase 4, já que é precisamente o
requisito 12 que pediste.

---

## 6. Riscos

| Risco | Mitigação |
|---|---|
| Construir mal o `CU` de compatibilidade parte os ~75 sítios que já leem `CU.*` | Testar exaustivamente as Etapas 4-5 com as 2 contas admin e as 3 comerciais antes de avançar |
| Link de recuperação de password embate na Basic Auth do site | Decisão explícita tua na Etapa 7 antes de implementar |
| `USERS`/Google Sheets (página Equipa) fica dessincronizado de `ob_profiles` | Fora do âmbito por agora (ponto 11) — duas fontes de verdade coexistem até decidires unificar |
| Importação de orçamentos por Excel não atribui `owner_id` automaticamente | Fica `owner_id null`, corrigido manualmente como na migration #7 — comportamento já conhecido e seguro (nunca invisível para admin) |
| Bloco `pdfHTML` (15291-15576) é enorme e frágil a editar por engano | Não é tocado nesta fase |

---

## 7. Plano de testes (detalhe completo na Etapa 8/documento seguinte)
- Admin: vê tudo, cria/edita/apaga.
- Comercial: só o seu, sem reatribuir a colegas, sem apagar.
- Conta sem `ob_profiles` (hipotética): mensagem clara, sem acesso à app.
- Conta inativa: mensagem clara, sem acesso à app (depende da migration da secção 5).
- Sem sessão: ecrã de login, zero dados carregados antes disso.

## 8. Rollback

Como esta fase só toca `index.html` (sem migrations obrigatórias), o rollback é o
mais simples de toda esta auditoria: reverter o commit no branch de pré-visualização,
ou, se já estiver em `main`, um `git revert` + novo deploy — sem nenhum dado na base
de dados em risco, porque a RLS e as colunas já existiam antes desta fase.

---

## Resumo

| Pedido | Estado |
|---|---|
| Diagnóstico completo (12 pontos) | ✅ Secção 1 |
| Arquitetura proposta | ✅ Secção 2 |
| Ficheiros a alterar | ✅ Secção 3 — só `index.html`, zonas localizadas |
| Migrations necessárias | ✅ Secção 5 — 0 obrigatórias, 1 proposta (enforcement de `active`) |
| Riscos | ✅ Secção 6 |
| Plano de testes | ✅ Secção 7 (detalhe na Etapa 8) |
| Rollback | ✅ Secção 8 |
| Implementação | ❌ Nada feito — aguarda a tua aprovação, etapa a etapa |

Duas decisões tuas em aberto antes de começar a Etapa 2: o ponto 11 (página Equipa) e
a Etapa 7 (Basic Auth vs. link de recuperação de password).
