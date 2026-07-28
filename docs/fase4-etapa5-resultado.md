# Fase 4 — Resultado da Etapa 5 (login e logout reais)

Nada publicado — tudo só no branch `claude/crm-opportunitybox-cleanup-q737hx`.

---

## Confirmação prévia (pedida antes de começar)

Verifiquei diretamente na base de dados, não assumido: o enum `ob_user_role` tem
exatamente 4 valores — `admin`, `manager`, `comercial`, `financeiro` — e é
exatamente essa a lista usada em `CRM_VALID_ROLES` desde a Etapa 4. Hoje só
`admin` e `comercial` estão em uso real (nos 5 perfis existentes). Nada foi
inventado nem convertido — uma role fora desta lista continua a bloquear o acesso.

---

## Funções alteradas

| Função | O que mudou |
|---|---|
| `crmValidateSessionAndEnter(session, myGen)` | **Nova** — extraída do interior de `crmAuthBootGate()` da Etapa 4, para ser partilhada entre o arranque e o login real. Nenhuma regra de validação mudou, só deixou de estar duplicada. |
| `crmAuthBootGate()` | Reduzida — a parte de validação de perfil foi para a função partilhada acima. |
| `crmRealLogin()` | **Nova** — handler do formulário: lê email/password, chama `crmAuthLogin`, limpa a password do campo, e delega em `crmValidateSessionAndEnter`. |
| `crmSetLoginFormBusy(busy)` | **Nova** — desliga/liga campos e texto do botão durante o pedido. |
| `crmRealLogout()` | **Nova** — chama `crmAuthLogout()` (Supabase) e, mesmo que falhe, chama sempre `doLogout()` a seguir. |
| `doLogout()` | Não tocada nesta etapa (já tinha a linha do `_crmAuthGen++` da Etapa 4). |
| `loginComSenha()`, `USERS`, `LOGIN_PASSWORDS`, `renderLogin()`, `loginSelectFromDropdown()` | **Não tocadas** — continuam no ficheiro, só deixaram de estar ligadas ao botão/campo visíveis. |

### HTML do formulário
- Acrescentado um campo `#login-email` (novo).
- O dropdown `#login-user-select` (escolha de utilizador local) foi **escondido**
  (`display:none` no HTML), não eliminado — `renderLogin()` continua a
  preenchê-lo sem erro, para quem reverter via `CRM_AUTH_GATE_ENABLED`.
- Botão `#login-btn`: `onclick` passou de `loginComSenha()` para `crmRealLogin()`;
  deixou de ter `disabled` fixo (a validação de campos vazios passa a ser feita
  dentro de `crmRealLogin`).
- Botão "Sair" (`.logout-btn`): `data-action` passou de `doLogout` para
  `crmRealLogout`.

---

## Fluxo completo de login

```
utilizador escreve email+password → clica "Entrar" (ou Enter)
  → crmRealLogin()
  → se já houver um pedido em curso, ignora (_crmLoginInFlight)
  → campos vazios → não faz nada (sem pedir nada ao servidor)
  → bloqueia o formulário (crmSetLoginFormBusy(true), botão "A entrar…")
  → crmAuthLogin(email, password) — só isto vai ao Supabase Auth;
    nunca é comparado a LOGIN_PASSWORDS, nunca procura em USERS
  → password limpa do campo imediatamente, sucesso ou falha
  → erro (credenciais erradas OU rede) → mensagem própria, formulário
    desbloqueado, PARA — nunca constrói CU aqui
  → sucesso → overlay "A verificar conta…"
  → crmValidateSessionAndEnter(session) — a MESMA validação da Etapa 4
    (ob_profiles, active, role, department, nome) → só no fim constrói
    o CU e entra na app
```

## Fluxo completo de logout

```
clique em "Sair" → crmRealLogout()
  → tenta crmAuthLogout() (supabase.auth.signOut())
  → falhar ou não, chama sempre doLogout() a seguir
  → doLogout(): incrementa _crmAuthGen (invalida qualquer login/arranque
    pendente), limpa CU/selectedUser/_adminUser, esconde a app, mostra
    o login
```

---

## O que deixou de usar o login falso
O **caminho ativo** (botão, Enter, logout) já não toca em `LOGIN_PASSWORDS` nem
em `USERS` para autenticar — email e password só são enviados a
`crmAuthLogin`/Supabase Auth. `CU` só é construído depois da sessão e do perfil
estarem validados (nunca logo a seguir ao formulário).

## O que continua no ficheiro, só para rollback
`USERS`, `LOGIN_PASSWORDS`, `loginComSenha()`, `doLogin()`, `selectUser()`,
`renderLogin()` (continua a ser chamada — só deixou de ser o único caminho),
e o dropdown `#login-user-select` (escondido, não eliminado). Página Equipa
continua exatamente como estava, ligada a `USERS`/Google Sheets — não foi
tocada.

**Nota sobre `CRM_AUTH_GATE_ENABLED=false`:** desde a Etapa 3 esta flag evita o
gate assíncrono no arranque. A partir desta etapa, isso já não é suficiente
para restaurar visualmente o fluxo antigo por completo — o dropdown continua
escondido em HTML e o botão continua ligado a `crmRealLogin()`. O rollback
funcional completo, a partir de agora, é o `git revert` deste commit — fica
igual ao que já estava previsto para a Etapa 9 (rever `CRM_AUTH_GATE_ENABLED`
antes de publicar), só que já vale também para hoje, não só para o futuro.

---

## Testes simulados — os 10 pedidos, todos executados e passaram

Mesma técnica da Etapa 4 (SDK do Supabase totalmente mockado via
`page.addInitScript`, sem depender de rede real), agora cobrindo também
`signInWithPassword`.

| # | Cenário | Resultado |
|---|---|---|
| 1 | Login correto, perfil ativo | ✅ `CU` construído, app mostrada, password limpa do campo |
| 2 | Credenciais inválidas | ✅ "Email ou password incorretos" — sem logout (não havia sessão) |
| 3 | Falha de rede no login | ✅ mensagem distinta ("não foi possível ligar"), nunca confundida com credenciais erradas |
| 4 | Login correto, perfil inexistente | ✅ logout chamado, mensagem própria |
| 5 | Perfil inativo | ✅ logout chamado, "conta desativada" |
| 6 | Dois cliques consecutivos | ✅ só 1 pedido ao Supabase (`signInCalls:1`), botão mostrou "A entrar…" e ficou desativado durante o pedido |
| 7 | Logout normal | ✅ `CU` limpo, app escondida, `signOut` chamado |
| 8 | Erro de rede durante o logout | ✅ estado local limpo à mesma (app escondida, `CU` nulo), mesmo com `signOut` a rebentar |
| 9 | Atualização da página com sessão persistida | ✅ entra direto na app, sem passar pelo formulário |
| 10 | Evento de autenticação recebido duas vezes (depois de login real) | ✅ sem exceção, idempotente, volta ao login com "sessão expirou" |

---

## Limitações sem Supabase real
Os mesmos de sempre nesta fase: o mock reproduz fielmente a forma das
respostas do SDK, mas não substitui um teste real com as 5 contas (Edna,
Paulo, Rui, Humberto, André) — isso continua reservado para a Etapa 8. Em
particular, nunca vi o comportamento real de `signInWithPassword` para um
email que exista mas com password errada vs. um email que não exista — confio
na documentação do Supabase de que a mensagem de erro é a mesma nos dois
casos (é por isso que não tento distinguir os dois no código), mas isto fica
por confirmar com uma conta real.

## Commit
Separado, só no branch de trabalho.
