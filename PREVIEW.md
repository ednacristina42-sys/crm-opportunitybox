# Branch `preview` — GitHub Pages (testes gratuitos)

Esta branch existe só para publicar versões intermédias no GitHub Pages,
para testar no browser sem consumir builds/créditos da Netlify.

- Fonte: `index.html` na raiz desta branch (ficheiro único, sem build).
- Fluxo: commits de teste aqui incluem `[skip netlify]` na mensagem, para
  que a Netlify ignore este push (não cria Deploy Preview nem gasta
  créditos) — sem alterar nenhuma configuração da Netlify.
- Quando uma versão for aprovada, o merge/commit final para `main` é
  feito SEM `[skip netlify]`, para permitir a publicação real na Netlify.
- `main`/produção nunca é tocado a partir desta branch.

Configuração pendente (uma vez só, feita no GitHub, não por código):
Settings → Pages → Source: "Deploy from a branch" → Branch: `preview` /
`(root)`. Depois disso, o GitHub publica automaticamente a cada push
aqui, sem intervenção adicional.
