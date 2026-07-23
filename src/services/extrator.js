// ─────────────────────────────────────────────────────────────
// Extrator local de parâmetros (pt-BR) — GrãoCerto
//
// Interpreta frases do produtor ("colhi 12 mil sacas de soja, tô
// devendo no banco a 1,2 ao mês") e extrai os parâmetros da
// simulação por REGRAS locais, sem IA. É o fallback do endpoint
// /api/interpretar quando não há ANTHROPIC_API_KEY configurada —
// e também roda no navegador, então precisa ser JS puro.
//
// A IA (quando configurada) faz o mesmo papel com mais robustez;
// o CÁLCULO nunca sai daqui do app — modelo algum faz conta.
// ─────────────────────────────────────────────────────────────

// "1.234,56" | "1234,56" | "12" → número JS. Devolve null se inválido.
function numeroBr(s) {
  if (s == null) return null;
  const n = Number(String(s).trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const NUM = "(\\d{1,3}(?:\\.\\d{3})+|\\d+(?:,\\d+)?)"; // número pt-BR

const MESES_NOME = {
  janeiro: 0, fevereiro: 1, "março": 2, marco: 2, abril: 3, maio: 4, junho: 5,
  julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
};

// Quantos meses até o mês nomeado (mínimo 1). `agora` injetável p/ teste.
function mesesAte(nomeMes, agora = new Date()) {
  const alvo = MESES_NOME[nomeMes.toLowerCase()];
  if (alvo == null) return null;
  let diff = alvo - agora.getMonth();
  if (diff <= 0) diff += 12;
  return diff;
}

// Extrai os parâmetros encontrados na frase. Devolve só o que achou.
export function extrairParametros(texto, agora = new Date()) {
  const t = ` ${String(texto || "").toLowerCase()} `;
  const campos = {};

  // ── cultura ──
  for (const c of ["soja", "milho", "trigo"]) {
    if (t.includes(c)) {
      campos.cultura = c;
      break;
    }
  }

  // ── quantidade: sacas (com "mil") ou toneladas (→ sacas de 60 kg) ──
  let m =
    t.match(new RegExp(`${NUM}\\s*mil\\s*(?:sacas?|sc\\b)`)) ||
    t.match(new RegExp(`${NUM}\\s*(?:sacas?|sc\\b)`));
  if (m) {
    const bruto = numeroBr(m[1]);
    if (bruto != null) campos.sacas = Math.round(/mil/.test(m[0]) ? bruto * 1000 : bruto);
  } else {
    m = t.match(new RegExp(`${NUM}\\s*mil\\s*tonelada`)) || t.match(new RegExp(`${NUM}\\s*tonelada`));
    if (m) {
      const ton = numeroBr(m[1]);
      if (ton != null) campos.sacas = Math.round((/mil/.test(m[0]) ? ton * 1000 : ton) * 1000 / 60);
    }
  }

  // ── horizonte: "6 meses", "meio ano", "um ano", "até março" ──
  m = t.match(/(\d{1,2})\s*(?:meses|m[êe]s)/);
  if (m) campos.meses = parseInt(m[1], 10);
  else if (/meio\s*ano/.test(t)) campos.meses = 6;
  else if (/\b(um|1)\s*ano\b/.test(t)) campos.meses = 12;
  else {
    m = t.match(/at[ée]\s+(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/);
    if (m) {
      const n = mesesAte(m[1], agora);
      if (n) campos.meses = n;
    }
  }

  // ── percentuais ao mês: juros vs. perda técnica vs. armazenagem ──
  // Decide pela palavra-chave MAIS PRÓXIMA antes do número (não a primeira
  // da janela — "perda de 0,3 ao mês ... devendo a 1,4 ao mês" tem as duas).
  const CATEGORIAS = [
    ["perdaMes", /perda|quebra|deteriora/g],
    ["jurosMes", /juro|devendo|d[íi]vida|banco|financ|custeio|capital|pagando/g],
    ["custoArmz", /armazenagem|armaz[ée]m|silo/g],
  ];
  const categoriaMaisProxima = (antes) => {
    let melhor = null;
    let melhorIdx = -1;
    for (const [campo, re] of CATEGORIAS) {
      re.lastIndex = 0;
      let mm;
      while ((mm = re.exec(antes)) !== null) {
        if (mm.index > melhorIdx) {
          melhorIdx = mm.index;
          melhor = campo;
        }
      }
    }
    return melhor;
  };

  const percRe = new RegExp(`${NUM}\\s*(?:%|por\\s*cento)?\\s*(?:a\\.?\\s?m\\.?|ao\\s*m[êe]s)`, "g");
  let pm;
  while ((pm = percRe.exec(t)) !== null) {
    const valor = numeroBr(pm[1]);
    if (valor == null) continue;
    const antes = t.slice(Math.max(0, pm.index - 40), pm.index);
    const campo = categoriaMaisProxima(antes) || "jurosMes"; // solto: juros é o mais comum na fala
    if (campos[campo] == null) campos[campo] = valor;
  }

  // ── custo de armazenagem: "R$ 1,50 por saca por mês" perto de armazenagem/silo ──
  m = t.match(new RegExp(`(?:armazenagem|armaz[ée]m|silo)[^.;]{0,50}?${NUM}\\s*(?:reais|r\\$)?\\s*(?:por|a|\\/)\\s*saca`));
  if (!m) m = t.match(new RegExp(`${NUM}\\s*(?:reais|r\\$)?\\s*(?:por|a|\\/)\\s*saca[^.;]{0,20}(?:m[êe]s|armazenagem)`));
  if (m && campos.custoArmz == null) {
    const v = numeroBr(m[1]);
    if (v != null && v < 20) campos.custoArmz = v; // sanidade: tarifa/saca/mês é baixa
  }

  // ── preços por saca: hoje vs. esperado (decide pelo contexto) ──
  const precoRe = new RegExp(`(?:r\\$\\s*)?${NUM}\\s*(?:reais\\s*)?(?:a|por|\\/)\\s*saca|saca\\s*(?:a|por|em)\\s*(?:r\\$\\s*)?${NUM}|(?:t[áa]|est[áa]|hoje\\s*a|vendendo\\s*a|pre[çc]o\\s*de)\\s*(?:r\\$\\s*)?${NUM}|(?:vai|chega(?:r)?|subir)\\s*(?:a|pra|para|em)\\s*(?:r\\$\\s*)?${NUM}`, "g");
  while ((pm = precoRe.exec(t)) !== null) {
    const valor = numeroBr(pm[1] ?? pm[2] ?? pm[3] ?? pm[4]);
    if (valor == null || valor < 10 || valor > 1000) continue; // faixa plausível de R$/saca
    const antes = t.slice(Math.max(0, pm.index - 55), pm.index);
    // O 4º padrão ("vai/chegar a X") já indica preço futuro por si só.
    const esperado =
      pm[4] != null ||
      /esper|entressafra|futuro|vai\s*(?:a|pra|para)|chegar|acho\s*que|se\s*segurar|mais\s*pra\s*frente|l[áa]\s*em/.test(antes);
    if (esperado) {
      if (campos.precoEsperado == null) campos.precoEsperado = valor;
    } else if (campos.precoHoje == null) {
      campos.precoHoje = valor;
    }
  }

  return campos;
}

// Schema JSON dos parâmetros — usado pelo backend para a extração via IA
// (structured outputs) e como contrato entre as duas vias.
// Campos anuláveis usam anyOf — o validador de structured outputs não
// aceita enum junto com tipo união ["string","null"].
const anulavel = (schema, description) => ({
  anyOf: [schema, { type: "null" }],
  description,
});

export const SCHEMA_PARAMETROS = {
  type: "object",
  properties: {
    cultura: anulavel(
      { type: "string", enum: ["soja", "milho", "trigo"] },
      "Cultura mencionada",
    ),
    sacas: anulavel({ type: "number" }, "Quantidade em sacas de 60 kg (toneladas → sacas: kg ÷ 60; ex.: 300 t = 5000 sacas)"),
    precoHoje: anulavel({ type: "number" }, "Preço atual em R$/saca, se mencionado"),
    precoEsperado: anulavel({ type: "number" }, "Preço esperado no futuro em R$/saca, se mencionado"),
    meses: anulavel({ type: "integer" }, "Horizonte de armazenagem em meses"),
    jurosMes: anulavel({ type: "number" }, "Custo do dinheiro em % ao mês (juros de dívida ou rendimento)"),
    custoArmz: anulavel({ type: "number" }, "Custo de armazenagem em R$/saca/mês"),
    perdaMes: anulavel({ type: "number" }, "Perda técnica em % ao mês"),
    dataDocumento: anulavel(
      { type: "string" },
      "Data do documento (romaneio/nota fiscal) no formato DD/MM/AAAA, se visível",
    ),
    resumo: { type: "string", description: "Uma frase curta em pt-BR resumindo o que foi entendido" },
  },
  required: ["cultura", "sacas", "precoHoje", "precoEsperado", "meses", "jurosMes", "custoArmz", "perdaMes", "dataDocumento", "resumo"],
  additionalProperties: false,
};
