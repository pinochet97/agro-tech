// ─────────────────────────────────────────────────────────────
// Backend leve de cotações — GrãoCerto
//
// Proxy que busca os indicadores diários de soja e milho no CEPEA/ESALQ
// e devolve JSON normalizado para o front (VITE_COTACOES_ENDPOINT).
//
// Por que existe: o site do CEPEA fica atrás de Cloudflare e bloqueia
// fetch direto do navegador (CORS + desafio de bot). Porém o endpoint
// do WIDGET de embed (widgetproduto.js.php) é liberado para requisições
// com cabeçalhos de navegador — inclusive server-side. Este proxy faz
// exatamente isso: chama o widget com User-Agent/Referer de navegador,
// faz o parse da tabela HTML e entrega os números já prontos.
//
// Dados CEPEA/ESALQ: CC BY-NC 4.0 (atribuição obrigatória, uso não
// comercial). A atribuição é repassada no campo "fonte" e exibida na UI.
//
// Zero dependências: usa só o http e o fetch nativos do Node (18+).
// Rodar:  node server/cotacoes-proxy.mjs   (porta 8787 por padrão)
// ─────────────────────────────────────────────────────────────

import { createServer } from "node:http";

const PORT = Number(process.env.PORT) || 8787;
const CACHE_MS = 30 * 60 * 1000; // indicadores saem ~1x/dia; 30 min é folgado
const UPSTREAM_TIMEOUT_MS = 8000;

// id_indicador do widget CEPEA → cultura do app.
// 92 = Soja Paranaguá (CEPEA/ESALQ-B3), 77 = Milho (ESALQ/BM&F).
const PRODUTOS = [
  { cultura: "soja", id: 92, casa: /soja/i },
  { cultura: "milho", id: 77, casa: /milho/i },
];

const WIDGET_BASE = "https://www.cepea.org.br/br/widgetproduto.js.php";

// Cabeçalhos de navegador — SEM eles o Cloudflare devolve 403.
const HEADERS_NAVEGADOR = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
  Referer: "https://www.cepea.org.br/br/widget.aspx",
};

let cache = null; // { dados, expira, obtidoEm }

// "22/07/2026" → "2026-07-22"
function dataBrParaIso(br) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(br || "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// "1.234,56" → 1234.56
function precoBrParaNumero(br) {
  if (!br) return null;
  const n = Number(String(br).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const semTags = (s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// Extrai as linhas da tabela do widget: [{ data, produto, valor }]
function parseTabela(html) {
  const linhas = [];
  const tbody = html.slice(html.indexOf("<tbody"), html.indexOf("</tbody>") + 1);
  const alvo = tbody || html;
  for (const tr of alvo.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const tds = [...tr.matchAll(/<td[\s\S]*?<\/td>/gi)].map((m) => m[0]);
    if (tds.length < 3) continue;
    const data = dataBrParaIso(semTags(tds[0]));
    // nome do produto = <span class="maior"> dentro do 2º td; ignora a unidade
    const nomeMatch = /<span[^>]*class="maior"[^>]*>([\s\S]*?)<\/span>/i.exec(tds[1]);
    const produto = nomeMatch ? semTags(nomeMatch[1]) : semTags(tds[1]).replace(/sc de.*/i, "").trim();
    const valorMatch = /(\d{1,3}(?:\.\d{3})*,\d{2})/.exec(semTags(tds[2]));
    if (produto && valorMatch) {
      linhas.push({ data, produto, valor: precoBrParaNumero(valorMatch[1]) });
    }
  }
  return linhas;
}

async function buscarNoCepea() {
  const query = PRODUTOS.map((p) => `id_indicador[]=${p.id}`).join("&");
  const url = `${WIDGET_BASE}?output=html&${query}`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  let html;
  try {
    const resp = await fetch(url, { headers: HEADERS_NAVEGADOR, signal: ctrl.signal });
    if (!resp.ok) throw new Error(`CEPEA respondeu HTTP ${resp.status}`);
    html = await resp.text();
  } finally {
    clearTimeout(t);
  }
  if (/_cf_chl_opt|Just a moment/i.test(html)) {
    throw new Error("CEPEA devolveu desafio do Cloudflare");
  }

  const linhas = parseTabela(html);
  const cotacoes = {};
  let dataMaisRecente = null;
  for (const p of PRODUTOS) {
    const linha = linhas.find((l) => p.casa.test(l.produto));
    if (!linha || typeof linha.valor !== "number") continue;
    cotacoes[p.cultura] = {
      preco: linha.valor,
      praca: linha.produto, // ex.: "Soja Paranaguá", "Milho"
      unidade: "R$/saca",
      data: linha.data,
      url: "https://www.cepea.org.br/br/indicador/" + p.cultura + ".aspx",
    };
    if (linha.data && (!dataMaisRecente || linha.data > dataMaisRecente)) {
      dataMaisRecente = linha.data;
    }
  }

  if (!Object.keys(cotacoes).length) {
    throw new Error("nenhuma cotação reconhecida na resposta do CEPEA");
  }

  return {
    fonte: "CEPEA/ESALQ · CC BY-NC 4.0",
    atualizadoEm: dataMaisRecente,
    cotacoes,
  };
}

// Busca com cache; em caso de falha, serve o último sucesso (se houver).
async function obterCotacoes() {
  const agora = Date.now();
  if (cache && cache.expira > agora) return { ...cache.dados, cacheHit: true };
  try {
    const dados = await buscarNoCepea();
    cache = { dados, expira: agora + CACHE_MS, obtidoEm: agora };
    return { ...dados, cacheHit: false };
  } catch (e) {
    if (cache) return { ...cache.dados, cacheHit: true, stale: true };
    throw e;
  }
}

const server = createServer(async (req, res) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/health") {
    res.writeHead(200, { ...cors, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (url.pathname === "/api/cotacoes" || url.pathname === "/cotacoes") {
    try {
      const dados = await obterCotacoes();
      res.writeHead(200, {
        ...cors,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=900",
      });
      return res.end(JSON.stringify(dados));
    } catch (e) {
      res.writeHead(502, { ...cors, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ erro: String(e.message || e) }));
    }
  }

  res.writeHead(404, { ...cors, "Content-Type": "application/json" });
  res.end(JSON.stringify({ erro: "rota não encontrada" }));
});

server.listen(PORT, () => {
  console.log(`[cotacoes-proxy] no ar em http://localhost:${PORT}/api/cotacoes`);
});
