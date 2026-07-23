# GrãoCerto

Ferramenta de decisão **"Armazenar ou Vender"** para o médio produtor rural brasileiro.
MVP da Fase 1 — ver [`CLAUDE.md`](CLAUDE.md) para o contexto completo do produto.

## Rodar localmente

Requer [Node.js](https://nodejs.org) 18+ (inclui o `npm`).

```bash
npm install
npm run dev
```

O Vite sobe em `http://localhost:5173` e abre o navegador automaticamente.

## Estrutura

```
index.html                          # ponto de entrada, monta #root
src/main.jsx                        # bootstrap React
src/decisao-armazenar-vender.jsx    # componente principal (tela única)
src/services/cotacoes.js            # serviço de cotações (auto-preenche o preço)
public/cotacoes.json                # snapshot de referência das cotações
vite.config.js                      # config do Vite + plugin React
.env.example                        # variáveis (endpoint de cotações, opcional)
```

## Cotações automáticas

O campo "preço hoje" é preenchido automaticamente para **soja** e **milho** a partir de
`public/cotacoes.json` (indicadores CEPEA/ESALQ de referência), sempre com **fallback
manual** — o campo continua editável e há um botão "Atualizar".

Para ligar cotações ao vivo (fase futura), aponte `VITE_COTACOES_ENDPOINT` para um backend
que consome o CEPEA/B3 e devolve JSON normalizado (ver `.env.example`). O CEPEA não tem API
pública gratuita e o site fica atrás de Cloudflare, então o dado ao vivo exige um proxy
próprio ou a API oficial paga. Dados CEPEA/ESALQ: **CC BY-NC 4.0** (atribuição obrigatória).

## Build de produção

```bash
npm run build      # gera dist/
npm run preview    # serve o build localmente
```
