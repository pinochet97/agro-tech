# GrãoCerto

Ferramenta de decisão **"Armazenar ou Vender"** para o médio produtor rural brasileiro.
MVP da Fase 1 — ver [`CLAUDE.md`](CLAUDE.md) para o contexto completo do produto.

## Rodar localmente

Requer [Node.js](https://nodejs.org) 18+ (inclui o `npm`).

```bash
npm install
npm run dev:all
```

Sobe **duas coisas juntas**: o front (Vite em `http://localhost:5173`, abre o navegador
sozinho) e o backend de cotações (`server/cotacoes-proxy.mjs` na porta 8787). Com isso o
"preço hoje" de soja e milho vem **ao vivo do CEPEA/ESALQ**.

Só o front (cotação cai no snapshot de referência): `npm run dev`.
Só o backend de cotações: `npm run dev:api`.

## Estrutura

```
index.html                          # ponto de entrada, monta #root
src/main.jsx                        # bootstrap React
src/decisao-armazenar-vender.jsx    # componente principal (tela única)
src/services/cotacoes.js            # serviço de cotações (auto-preenche o preço)
server/cotacoes-proxy.mjs           # backend leve que consome o CEPEA (porta 8787)
public/cotacoes.json                # snapshot de referência (fallback das cotações)
vite.config.js                      # config do Vite + proxy /api
.env.development                     # aponta o front para /api/cotacoes (dev)
.env.example                        # documenta VITE_COTACOES_ENDPOINT
```

## Cotações automáticas

O campo "preço hoje" é preenchido automaticamente para **soja** e **milho**, sempre com
**fallback manual** — o campo continua editável e há um botão "Atualizar". O serviço tenta,
nesta ordem:

1. **`VITE_COTACOES_ENDPOINT`** — o backend `server/cotacoes-proxy.mjs`, que busca o
   indicador **ao vivo** no CEPEA/ESALQ (via o endpoint do widget de embed, com cabeçalhos
   de navegador para contornar o Cloudflare) e devolve JSON normalizado em `/api/cotacoes`.
2. **`public/cotacoes.json`** — snapshot de referência versionado, usado quando o backend
   está fora.
3. **Manual** — o produtor digita o preço.

Em produção (build estático, sem backend), o passo 1 fica desligado e o app usa o snapshot;
no deploy, transformar o proxy em função serverless (ex.: `/api` na Vercel) reativa o ao vivo.

Dados CEPEA/ESALQ: **CC BY-NC 4.0** (atribuição obrigatória, uso não-comercial). A API
oficial do CEPEA é paga; este projeto usa a rota gratuita do widget.

## Build de produção

```bash
npm run build      # gera dist/
npm run preview    # serve o build localmente
```
