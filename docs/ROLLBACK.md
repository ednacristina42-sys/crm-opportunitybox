# Rollback

## Código (GitHub)

- Nunca fazer `git push --force` nem reescrever o histórico de `main`.
- Para desfazer uma alteração já fundida em `main`: `git revert <commit-ou-merge-commit>`
  e abrir PR normal com o revert — nunca editar o histórico diretamente.
- Para uma alteração ainda não fundida: simplesmente não fazer merge do PR.

## Base de dados (Supabase)

- Toda migration deve ser reversível OU vir acompanhada de instruções explícitas de
  rollback no próprio ficheiro/PR (ex.: script SQL de reversão, ou passos manuais
  documentados quando a reversão automática não é possível).
- Antes de qualquer migration que altere dados ou estrutura: backup confirmado.
- Nunca apagar tabelas/colunas/dados sem backup e aprovação humana — mesmo em rollback.

## Deploy

- Reverter para a versão anterior do build/deploy (tag de release anterior).
- Confirmar com smoke test que a versão revertida está saudável.

## Fase 1 (este PR)

Todas as alterações desta fase são aditivas (ficheiros novos + um *append* ao
`.gitignore`). Rollback = não fazer merge, ou `git revert` se já fundido. Não há
dados, schema ou infraestrutura externa envolvidos.
