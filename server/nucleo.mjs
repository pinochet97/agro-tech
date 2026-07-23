// ─────────────────────────────────────────────────────────────
// Núcleo do backend — GrãoCerto
//
// Toda a lógica de servidor num módulo só, usado por DOIS invólucros:
//   - server/cotacoes-proxy.mjs → servidor HTTP local (npm run dev:all)
//   - api/*.mjs                 → funções serverless na Vercel
//
// Contém: cotações ao vivo do CEPEA (via endpoint do widget, com
// cabeçalhos de navegador) e a extração de parâmetros por IA
// (SDK oficial da Anthropic; fallback no extrator local de regras).
// A IA só EXTRAI parâmetros — o cálculo é sempre do app.
// ─────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { extrairParametros, SCHEMA_PARAMETROS } from "../src/services/extrator.js";

// Carrega .env da raiz em dev (sem dependência de dotenv). Na Vercel o
// arquivo não existe e as variáveis vêm da plataforma — o catch cobre.
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

// ── Cotações CEPEA ───────────────────────────────────────────

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

let cache = null; // { dados, expira } — por instância (na Vercel, por lambda morna)

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
export async function obterCotacoes() {
  const agora = Date.now();
  if (cache && cache.expira > agora) return { ...cache.dados, cacheHit: true };
  try {
    const dados = await buscarNoCepea();
    cache = { dados, expira: agora + CACHE_MS };
    return { ...dados, cacheHit: false };
  } catch (e) {
    if (cache) return { ...cache.dados, cacheHit: true, stale: true };
    throw e;
  }
}

// ── Entrada conversacional (IA + fallback de regras) ─────────

const MODELO_IA = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

// Cliente só quando há credencial — sem ela o texto usa o extrator local.
const ia =
  process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
    ? new Anthropic()
    : null;

export function temIA() {
  return !!ia;
}

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

// Interpreta a frase: IA quando configurada, senão regras locais.
// Nunca lança — degradação sempre devolve algo utilizável.
export async function interpretarTextoNucleo(texto) {
  if (ia) {
    try {
      const { campos, resumo } = await interpretarTextoIA(texto);
      return { campos, resumo, fonte: "ia" };
    } catch (e) {
      console.warn("[interpretar] IA falhou, usando regras:", e.message || e);
    }
  }
  return {
    campos: extrairParametros(texto),
    resumo: null,
    fonte: "regras",
    aviso: ia
      ? "IA indisponível agora — interpretação por regras locais."
      : "Sem ANTHROPIC_API_KEY no servidor — interpretação por regras locais.",
  };
}

// Lê romaneio/NF por foto. Lança se a leitura falhar (o chamador decide o status).
export async function interpretarImagemNucleo(imagemB64, mediaType) {
  const { campos, resumo } = await interpretarImagemIA(imagemB64, mediaType);
  return { campos, resumo, fonte: "documento" };
}
