# 🪄 Módulo de Vetorização Automática com IA (Vectorizer.AI)

Elimina o gargalo da vetorização manual: o comercial/designer carrega a imagem
em baixa resolução do cliente (PNG/JPG) na ficha de orçamento e recebe em
segundos um ficheiro vetorial limpo (**SVG/DXF**) pronto para as máquinas de
corte (CNC/Laser) — sem redesenhar curvas no Illustrator/Corel DRAW.

## Onde está no CRM

**Orçamentos → formulário de orçamento → painel "🪄 Vetorização IA — Imagem → Vetor de Corte"**
(logo abaixo do campo "Imagem da Obra").

Fluxo do utilizador:
1. Arrasta (ou clica para escolher) o PNG/JPG do cliente.
2. Escolhe o formato de saída — **SVG** (universal) ou **DXF** (CNC/CAD) — e o modo.
3. Clica em **⚡ Vetorizar agora**.
4. Em poucos segundos aparece a pré-visualização; o ficheiro pode ser
   **descarregado** e fica **anexado automaticamente ao orçamento** (campo
   `vetorAI`), guardado no localStorage e sincronizado com o Supabase
   (`ob_orcamentos.extra.vetorAI`) ao clicar em "Guardar".

## Arquitetura

```
Browser (CRM)                Netlify Function              Vectorizer.AI
┌──────────────┐  JSON/base64 ┌──────────────────┐  multipart ┌─────────────┐
│ Painel       │ ───────────► │ /.netlify/       │ ─────────► │ POST /api/  │
│ Vetorização  │              │ functions/       │  Basic auth│ v1/vectorize│
│ (upload UI)  │ ◄─────────── │ vectorize.mjs    │ ◄───────── │ (Bézier IA) │
└──────────────┘  SVG/DXF b64 └──────────────────┘   SVG/DXF  └─────────────┘
```

A função serverless (`netlify/functions/vectorize.mjs`) existe por duas razões:
- **Segurança** — a chave da API não fica exposta no HTML público;
- **CORS** — o browser não consegue chamar a API do Vectorizer.AI diretamente.

## Configuração (uma única vez)

1. Cria conta em https://vectorizer.ai e obtém as credenciais da API
   (**API Id** e **API Secret**) em https://vectorizer.ai/account.
2. No Netlify: **Site settings → Environment variables → Add variable**
   - `VECTORIZER_API_KEY` = `API_ID:API_SECRET` (os dois valores separados por `:`)
3. Faz redeploy do site (o deploy do commit deste módulo já cria a função).

Alternativa sem acesso ao Netlify: introduzir `API_ID:API_SECRET` no campo
🔑 do próprio painel — fica guardada no localStorage do browser e é enviada
à função pelo header `X-Vectorizer-Key`. (Menos seguro; usar apenas para testes.)

### Modos

| Modo | Custo | Uso |
|---|---|---|
| `production` | consome créditos | Linhas de corte precisas para produção |
| `test` | grátis | Testar a integração (resultado com marca de água) |

## API (referência técnica)

> Nota: a especificação interna indicava `https://api.vectorizer.ai/v1/vectorize`
> e o parâmetro `out.format`. A documentação oficial usa
> **`https://vectorizer.ai/api/v1/vectorize`** e **`output.file_format`** —
> foi isso que se implementou. O endpoint pode ser trocado sem alterar código
> através da variável `VECTORIZER_ENDPOINT`.

- **Endpoint:** `POST https://vectorizer.ai/api/v1/vectorize`
- **Auth:** HTTP Basic — `Authorization: Basic base64(API_ID:API_SECRET)`
- **Form-data:** `image` (binário), `mode` (`production`/`test`/…),
  `output.file_format` (`svg`/`dxf`/`eps`/`pdf`/`png`)
- **Resposta:** o próprio ficheiro vetorial (binário); headers
  `X-Credits-Charged` / `X-Credits-Calculated` com o consumo de créditos.

Teste rápido em linha de comandos:

```bash
curl https://vectorizer.ai/api/v1/vectorize \
  -u "API_ID:API_SECRET" \
  -F image=@logotipo.png \
  -F mode=test \
  -F output.file_format=svg \
  -o resultado.svg
```

## Alternativa no-code (Make.com / n8n)

Para quem preferir orquestrar fora do Netlify (ex.: receber imagens por
email/WhatsApp e devolver o vetor), o mapeamento de nós equivalente:

**Make.com**
1. **Webhook (Custom webhook)** — recebe `image` (ficheiro) + `orcamento_num`.
2. **HTTP → Make a request**
   - URL: `https://vectorizer.ai/api/v1/vectorize`
   - Method: `POST` · Body type: `Multipart/form-data`
   - Fields: `image` = *data* do webhook (tipo file); `mode` = `production`;
     `output.file_format` = `svg`
   - Auth: Basic — user = `API_ID`, password = `API_SECRET`
3. **Supabase → Update a row** (tabela `ob_orcamentos`, filtro `num = orcamento_num`)
   ou **Google Drive/Dropbox → Upload a file** para arquivar o SVG/DXF.
4. **Webhook response** — devolve o ficheiro/URL ao chamador.

**n8n** — mesmo desenho: `Webhook` → `HTTP Request` (POST multipart,
Basic Auth, campos acima, *Response Format: File*) → `Supabase`/`Drive` →
`Respond to Webhook`.

## Impacto operacional

- **Antes:** 30–60 min por logótipo para vetorizar manualmente.
- **Depois:** vetor gerado em < 5 s; o operador abre o ficheiro final,
  ajusta a escala métrica real aprovada e envia para a CNC.
