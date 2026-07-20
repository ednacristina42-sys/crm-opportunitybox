# Staging

**Estado na Fase 1: não provisionado.** Este documento descreve o processo pretendido;
nenhuma infraestrutura de staging foi criada nesta sessão.

## Objetivo

Um ambiente que espelha a produção o mais fielmente possível, usado para validar
migrations, alterações de código e políticas de RLS antes de qualquer alteração
chegar a produção.

## Processo pretendido

1. Branch `develop` acumula as alterações integradas.
2. Deploy automático (ou manual) de `develop` para um ambiente de staging (ex.: Netlify
   deploy preview, ou site staging dedicado).
3. Projeto Supabase de staging separado do de produção — mesma estrutura, dados
   sintéticos/anonimizados.
4. Toda migration é aplicada primeiro aqui, testada, só depois vai para produção.
5. Smoke tests correm neste ambiente antes de qualquer release.

## Próximos passos (fora do escopo da Fase 1, sujeitos a aprovação)

- Criar branch `develop`.
- Criar/decidir o projeto Supabase de staging.
- Configurar deploy automático de `develop` para o ambiente de staging.
- Configurar `.env` de staging (nunca commitado).
