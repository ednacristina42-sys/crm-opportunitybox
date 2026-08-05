# Fase 4 — Resultado da Etapa 7 (logout e recuperação de password)

Nada publicado — tudo só no branch `claude/crm-opportunitybox-cleanup-q737hx`.
**Esta etapa não alterou `index.html`.** É só documentação de uma decisão.

---

## Objetivo original da Etapa 7 (plano `fase4-plano-autenticacao.md`, secção 4)
"Logout e recuperação de password": logout real via Supabase Auth, e um fluxo
self-service de recuperação de password (`resetPasswordForEmail`).

## Estado de cada parte

### Logout
Já implementado na **Etapa 5** — `crmRealLogout()` chama `crmAuthLogout()`
(`supabase.auth.signOut()`) e limpa sempre o estado local, mesmo que o pedido
ao servidor falhe. Nada a fazer aqui.

### Recuperação de password — decisão tomada
O plano original já tinha identificado esta dependência, sem a resolver: o
link de recuperação de password enviado por email aponta sempre para o site,
que está atrás da Basic Auth (a password que a Edna usa para ver as
alterações antes de publicar). Quem clicasse no link do email receberia
primeiro um pedido de password do *browser* (Basic Auth), antes de sequer
chegar ao ecrã de "define a tua nova password" do CRM.

Duas opções foram apresentadas; **decisão explícita da Edna: manter a
recuperação de password só através do admin no Supabase Dashboard**, exatamente
como já acontece hoje. Consequências diretas desta decisão, também explícitas:
- **Não** foi criado nenhum fluxo self-service (`resetPasswordForEmail`) no CRM.
- **Não** foi isento nenhum caminho da Basic Auth.
- **`netlify/edge-functions/basic-auth.ts` não foi tocado.**
- Esta funcionalidade fica formalmente **adiada** para depois da publicação e
  da remoção ou revisão da Basic Auth (Etapa 9 ou posterior).

---

## Funções e áreas do `index.html` alteradas
**Nenhuma.** Zero linhas de código mudaram nesta etapa.

## Módulos intocados
Todo o `index.html`. `ob_stock`, `ob_despesas`, `ob_crm_dados` e a página
Equipa continuam, como sempre, fora do âmbito — nem seriam afetados por esta
etapa de qualquer forma.

## Migrations
Nenhuma criada. Nenhuma necessária.

## Testes
Não há código novo para testar.

## Rollback
Não aplicável — sem alteração de código, não há nada a reverter. Se esta
decisão for revista mais tarde, basta reabrir a Etapa 7 como uma etapa nova.

---

## Commit
Separado, só de documentação, só no branch de trabalho.
