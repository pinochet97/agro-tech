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
// Além do proxy de cotações, expõe a ENTRADA CONVERSACIONAL:
//   POST /api/interpretar        {texto}              → parâmetros extraídos
//   POST /api/interpretar-imagem {imagem, mediaType}  → romaneio/NF por foto
// A extração usa a API do Claude (SDK oficial) quando ANTHROPIC_API_KEY
// está no ambiente/.env; sem chave, o texto cai no extrator local de
// regras (src/services/extrator.js) e a foto devolve erro claro.
// A IA só EXTRAI parâmetros — o cálculo é sempre do app, nunca do modelo.
//
// Rodar:  node server/cotacoes-proxy.mjs   (porta 8787 por padrão)
// ─────────────────────────────────────────────────────────────

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { extrairParametros, SCHEMA_PARAMETROS } from "../src/services/extrator.js";

// Carrega .env da raiz do projeto (sem dependência de dotenv).
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
try {
  for (const linha of readFileSync(join(RAIZ, ".env"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(linha);
    if (m && process.env[m[1]] == null) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // sem .env — segue só com o ambiente
}

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

// ── Entrada conversacional (IA + fallback de regras) ─────────────

const MODELO_IA = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

// Cliente só quando há credencial — sem ela o texto usa o extrator local.
const ia =
  process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
    ? new Anthropic()
    : null;

const SISTEMA_EXTRACAO = `Você extrai parâmetros de simulação de comercialização de grãos a partir de mensagens de produtores rurais brasileiros (fala coloquial) ou de fotos de documentos (romaneio de balança, nota fiscal).

Regras:
- Extraia SOMENTE o que estiver explícito; use null para o que não foi mencionado. Nunca invente valores.
- Converta unidades: "12 mil sacas" = 12000; toneladas ou kg → sacas de 60 kg.
- Percentual "ao mês" de dívida/banco/juros → jurosMes; de perda/quebra → perdaMes; tarifa R$/saca/mês de armazém/silo → custoArmz.
- Preço atual → precoHoje; preço esperado/futuro ("vai a", "na entressafra") → precoEsperado. Ambos em R$/saca.
- Você NÃO faz a simulação, NÃO calcula resultado e NÃO recomenda nada — só extrai. Todo cálculo é do aplicativo.
- "resumo": uma frase curta em pt-BR, linguagem simples de produtor, dizendo o que você entendeu (para o produtor confirmar antes de simular).`;

// Remove nulls e separa o resumo — devolve só os campos preenchidos.
function limparSaidaIA(saida) {
  const { resumo, ...resto } = saida || {};
  const campos = Object.fromEntries(
    Object.entries(resto).filter(([, v]) => v !== null && v !== undefined),
  );
  return { campos, resumo: resumo || null };
}

async function interpretarTextoIA(texto) {
  const resp = await ia.messages.create(
    {
      model: MODELO_IA,
      max_tokens: 2048,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SCHEMA_PARAMETROS },
      },
      system: SISTEMA_EXTRACAO,
      // A data entra na mensagem (não no system) para "até dezembro" virar
      // meses sem invalidar o cache do prompt fixo.
      messages: [
        {
          role: "user",
          content: `Hoje é ${new Date().toLocaleDateString("pt-BR")}. Frase do produtor: "${texto}"`,
        },
      ],
    },
    { timeout: 60_000 },
  );
  if (resp.stop_reason === "refusal") throw new Error("pedido recusado");
  const bloco = resp.content.find((b) => b.type === "text");
  return limparSaidaIA(JSON.parse(bloco.text));
}

async function interpretarImagemIA(imagemB64, mediaType) {
  const resp = await ia.messages.create(
    {
      model: MODELO_IA,
      max_tokens: 3072,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: SCHEMA_PARAMETROS },
      },
      system: SISTEMA_EXTRACAO,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: imagemB64 },
            },
            {
              type: "text",
              text: "Extraia os dados deste documento de grãos (romaneio de balança ou nota fiscal): cultura, quantidade (use o PESO LÍQUIDO em kg → sacas de 60 kg), data do documento (dataDocumento, DD/MM/AAAA) e, se houver, valor unitário em R$/saca como precoHoje. No resumo, diga que tipo de documento é e o que foi lido.",
            },
          ],
        },
      ],
    },
    { timeout: 90_000 },
  );
  if (resp.stop_reason === "refusal") throw new Error("leitura recusada");
  const bloco = resp.content.find((b) => b.type === "text");
  return limparSaidaIA(JSON.parse(bloco.text));
}

// Lê e parseia o corpo JSON de um POST (limite p/ fotos em base64).
function lerCorpo(req, limite = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let tam = 0;
    const partes = [];
    req.on("data", (c) => {
      tam += c.length;
      if (tam > limite) {
        reject(new Error("payload muito grande"));
        req.destroy();
      } else {
        partes.push(c);
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(partes).toString("utf8") || "{}"));
      } catch {
        reject(new Error("JSON inválido"));
      }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return res.end();
  }
  const json = (status, corpo) => {
    res.writeHead(status, { ...cors, "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(corpo));
  };

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

  // ── Entrada conversacional ──
  if (req.method === "POST" && url.pathname === "/api/interpretar") {
    try {
      const { texto } = await lerCorpo(req);
      if (!texto || typeof texto !== "string" || !texto.trim()) {
        return json(400, { erro: "envie { texto } com a frase do produtor" });
      }
      if (ia) {
        try {
          const { campos, resumo } = await interpretarTextoIA(texto.trim());
          return json(200, { campos, resumo, fonte: "ia" });
        } catch (e) {
          // IA falhou (rede, limite, recusa) → cai nas regras locais
          console.warn("[interpretar] IA falhou, usando regras:", e.message || e);
        }
      }
      const campos = extrairParametros(texto);
      return json(200, {
        campos,
        resumo: null,
        fonte: "regras",
        aviso: ia
          ? "IA indisponível agora — interpretação por regras locais."
          : "Sem ANTHROPIC_API_KEY no servidor — interpretação por regras locais.",
      });
    } catch (e) {
      return json(400, { erro: String(e.message || e) });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/interpretar-imagem") {
    if (!ia) {
      return json(503, {
        erro:
          "Leitura de foto exige IA no servidor: defina ANTHROPIC_API_KEY no .env e reinicie o backend.",
      });
    }
    try {
      const { imagem, mediaType } = await lerCorpo(req);
      if (!imagem || !/^image\/(jpeg|png|webp|gif)$/.test(mediaType || "")) {
        return json(400, { erro: "envie { imagem: base64, mediaType: image/jpeg|png|webp }" });
      }
      const { campos, resumo } = await interpretarImagemIA(imagem, mediaType);
      return json(200, { campos, resumo, fonte: "documento" });
    } catch (e) {
      return json(502, { erro: `não consegui ler o documento: ${String(e.message || e)}` });
    }
  }

  json(404, { erro: "rota não encontrada" });
});

server.listen(PORT, () => {
  console.log(`[cotacoes-proxy] no ar em http://localhost:${PORT}/api/cotacoes`);
});
