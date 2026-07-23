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
vite.config.js                      # config do Vite + plugin React
```

## Build de produção

```bash
npm run build      # gera dist/
npm run preview    # serve o build localmente
```
