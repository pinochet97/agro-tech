// ─────────────────────────────────────────────────────────────
// Serviço de cotações — GrãoCerto Fase 1
//
// Objetivo: preencher automaticamente o "preço hoje" com os
// indicadores diários de soja e milho (CEPEA/ESALQ), mantendo
// SEMPRE o preenchimento manual como fallback quando a fonte falha.
//
// Realidade da fonte (jul/2026): o CEPEA/ESALQ não expõe uma API
// pública, gratuita e aberta — a API oficial é paga e o site fica
// atrás de Cloudflare (bloqueia fetch direto do navegador por CORS
// + desafio de bot). Por isso o serviço é organizado em camadas
// (providers), da mais "ao vivo" para a mais estática:
//
//   1. VITE_COTACOES_ENDPOINT → backend próprio (fase futura) que
//      consome CEPEA/B3 e devolve JSON já normalizado. Sem CORS em
//      dev via proxy do Vite. Desligado por padrão.
//   2. /cotacoes.json         → snapshot de referência versionado
//      no projeto (mesma origem, sem CORS). Funciona hoje; deve ser
//      atualizado com a cotação do dia até o backend existir.
//   3. (no chamador)          → valores manuais padrão + edição do
//      produtor.
//
// Licença dos dados CEPEA/ESALQ: CC BY-NC 4.0 (exige atribuição e
// uso não-comercial). Manter a atribuição visível na interface.
// ─────────────────────────────────────────────────────────────

const TIMEOUT_MS = 6000;

// Culturas com cotação automática. Trigo permanece manual nesta fase.
export const CULTURAS_COM_COTACAO = ["soja", "milho"];

const ENDPOINT = (import.meta.env.VITE_COTACOES_ENDPOINT || "").trim();

function fetchComTimeout(url, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, {
    signal: ctrl.signal,
    headers: { Accept: "application/json" },
  }).finally(() => clearTimeout(t));
}

async function lerJson(url) {
  const resp = await fetchComTimeout(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ao buscar ${url}`);
  return resp.json();
}

// Normaliza a cotação de qualquer provider para a forma interna usada
// pela interface. Devolve null se o preço não for um número válido.
function normalizar(cultura, bruto, { fonte, referencia }) {
  if (!bruto || typeof bruto.preco !== "number" || !isFinite(bruto.preco)) {
    return null;
  }
  return {
    cultura,
    preco: bruto.preco,
    unidade: bruto.unidade || "R$/saca",
    praca: bruto.praca || "",
    data: bruto.data || null,
    fonte: bruto.fonte || fonte,
    referencia: bruto.referencia ?? referencia,
    url: bruto.url || null,
  };
}

function montarMapa(cot, { fonte, referencia, dataPadrao }) {
  const out = {};
  for (const c of CULTURAS_COM_COTACAO) {
    const item = cot[c];
    const bruto = item ? { ...item, data: item.data || dataPadrao } : null;
    const n = normalizar(c, bruto, { fonte, referencia });
    if (n) out[c] = n;
  }
  return out;
}

// Provider 1 — backend próprio (opcional, fase futura).
async function providerEndpoint() {
  if (!ENDPOINT) throw new Error("VITE_COTACOES_ENDPOINT não configurado");
  const dados = await lerJson(ENDPOINT);
  const out = montarMapa(dados.cotacoes || dados, {
    fonte: dados.fonte || "CEPEA/ESALQ",
    referencia: false,
    dataPadrao: dados.atualizadoEm || null,
  });
  if (!Object.keys(out).length) throw new Error("endpoint sem cotações válidas");
  return out;
}

// Provider 2 — snapshot de referência versionado no projeto (mesma origem).
async function providerSnapshot() {
  const base = import.meta.env.BASE_URL || "/";
  const dados = await lerJson(`${base}cotacoes.json`);
  const out = montarMapa(dados.cotacoes || {}, {
    fonte: dados.fonte || "CEPEA/ESALQ (referência)",
    referencia: true,
    dataPadrao: dados.atualizadoEm || null,
  });
  if (!Object.keys(out).length) throw new Error("snapshot sem cotações válidas");
  return out;
}

// Tenta os providers em ordem e devolve o primeiro que funcionar.
// Lança se nenhuma fonte responder — cabe ao chamador cair no manual.
export async function buscarCotacoes() {
  const providers = [providerEndpoint, providerSnapshot];
  let ultimoErro;
  for (const provider of providers) {
    try {
      return await provider();
    } catch (e) {
      ultimoErro = e;
    }
  }
  throw ultimoErro || new Error("nenhuma fonte de cotação disponível");
}
