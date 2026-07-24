// ─────────────────────────────────────────────────────────────
// Lotes — GrãoCerto Fase 1 "Fundação Real"
//
// O produtor raramente vende tudo de uma vez. Aqui cada LOTE é uma
// unidade independente de decisão (cultura, volume, preços, horizonte
// e custos próprios) — dá para simular "vender 30% agora, segurar 70%"
// criando dois lotes.
//
// O MODELO DE CÁLCULO é o núcleo do produto e está reproduzido aqui
// exatamente como estava no componente (nenhuma fórmula mudou); só saiu
// de dentro da tela para poder rodar por lote e ser reaproveitado.
// ─────────────────────────────────────────────────────────────

export const CULTURAS = {
  soja: { nome: "Soja", precoHoje: 125, precoEsperado: 138, kgSaca: 60 },
  milho: { nome: "Milho", precoHoje: 58, precoEsperado: 67, kgSaca: 60 },
  trigo: { nome: "Trigo", precoHoje: 72, precoEsperado: 79, kgSaca: 60 },
};

const CUSTOS_PADRAO = { armazenagem: 1.2, jurosMes: 1.1, perdaMes: 0.25 };

function novoId() {
  return `lote_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// Cria um lote novo. `base` costuma vir do perfil do produtor (cultura
// principal e custos da região) e/ou de um lote existente ao duplicar.
export function criarLote(base = {}) {
  const cultura = base.cultura && CULTURAS[base.cultura] ? base.cultura : "soja";
  return {
    id: novoId(),
    cultura,
    sacas: base.sacas ?? 10000,
    precoHoje: base.precoHoje ?? CULTURAS[cultura].precoHoje,
    precoEsperado: base.precoEsperado ?? CULTURAS[cultura].precoEsperado,
    meses: base.meses ?? 6,
    custos: { ...CUSTOS_PADRAO, ...(base.custos || {}) },
    // true = o produtor digitou o preço; a cotação ao vivo não sobrescreve
    precoEditado: base.precoEditado ?? false,
    // true = o produtor mexeu no preço esperado; a curva B3 não sobrescreve
    precoEsperadoEditado: base.precoEsperadoEditado ?? false,
  };
}

// ── Modelo de cálculo (não alterar sem discutir — ver CLAUDE.md) ──
export function calcularLote(lote) {
  const { sacas, precoHoje, precoEsperado, meses } = lote;
  const { armazenagem: custoArmz, jurosMes, perdaMes } = lote.custos;

  const receitaAgora = precoHoje * sacas;

  const perdaTotal = 1 - Math.pow(1 - perdaMes / 100, meses);
  const sacasFinais = sacas * (1 - perdaTotal);
  const custoArmazenagem = custoArmz * meses * sacas;
  // custo de oportunidade: o dinheiro parado no grão deixa de render (ou paga juros de dívida)
  const custoCapital = receitaAgora * (Math.pow(1 + jurosMes / 100, meses) - 1);
  const receitaFutura = precoEsperado * sacasFinais - custoArmazenagem;
  const receitaFuturaLiquida = receitaFutura - custoCapital;

  const vantagemTotal = receitaFuturaLiquida - receitaAgora;
  const vantagemPorSaca = sacas > 0 ? vantagemTotal / sacas : 0;

  // preço de empate: quanto a saca precisa valer na entressafra para compensar
  const precoEmpate =
    sacasFinais > 0 ? (receitaAgora + custoArmazenagem + custoCapital) / sacasFinais : 0;

  return {
    receitaAgora,
    receitaFuturaLiquida,
    custoArmazenagem,
    custoCapital,
    // quanto custa, em dinheiro, segurar o lote pelo horizonte escolhido
    custoTotalSegurar: custoArmazenagem + custoCapital,
    perdaTotal,
    sacasFinais,
    perdaSacas: sacas - sacasFinais,
    vantagemTotal,
    vantagemPorSaca,
    precoEmpate,
    armazenar: vantagemTotal > 0,
    // |vantagem| < R$ 2/saca → zona cinzenta, sem veredito forte
    zonaCinzenta: Math.abs(vantagemPorSaca) < 2,
    veredito: vantagemTotal > 0 ? "armazenar" : "vender",
  };
}

// Soma os lotes numa visão da safra inteira. Não existe "preço de empate"
// consolidado (lotes podem ter culturas e preços diferentes), por isso ele
// fica de fora de propósito.
export function consolidar(lotes, resultados) {
  const totalSacas = lotes.reduce((s, l) => s + l.sacas, 0);
  const receitaAgora = resultados.reduce((s, r) => s + r.receitaAgora, 0);
  const receitaFuturaLiquida = resultados.reduce((s, r) => s + r.receitaFuturaLiquida, 0);
  const custoTotalSegurar = resultados.reduce((s, r) => s + r.custoTotalSegurar, 0);
  const vantagemTotal = receitaFuturaLiquida - receitaAgora;
  const vantagemPorSaca = totalSacas > 0 ? vantagemTotal / totalSacas : 0;

  return {
    nLotes: lotes.length,
    totalSacas,
    receitaAgora,
    receitaFuturaLiquida,
    custoTotalSegurar,
    vantagemTotal,
    vantagemPorSaca,
    armazenar: vantagemTotal > 0,
    zonaCinzenta: Math.abs(vantagemPorSaca) < 2,
    veredito: vantagemTotal > 0 ? "armazenar" : "vender",
    culturas: [...new Set(lotes.map((l) => l.cultura))],
  };
}

// Retrato enxuto de um lote + resultado, para mandar ao backend gerar a
// frase de recomendação. Só dados já calculados aqui — a IA não faz conta.
export function retratoParaIA(lote, resultado) {
  return {
    cultura: lote.cultura,
    culturaNome: CULTURAS[lote.cultura]?.nome || lote.cultura,
    sacas: lote.sacas,
    meses: lote.meses,
    precoHoje: lote.precoHoje,
    precoEsperado: lote.precoEsperado,
    custos: lote.custos,
    resultado: {
      veredito: resultado.veredito,
      zonaCinzenta: resultado.zonaCinzenta,
      vantagemPorSaca: Number(resultado.vantagemPorSaca.toFixed(2)),
      vantagemTotal: Math.round(resultado.vantagemTotal),
      precoEmpate: Number(resultado.precoEmpate.toFixed(2)),
      custoArmazenagem: Math.round(resultado.custoArmazenagem),
      custoCapital: Math.round(resultado.custoCapital),
      custoTotalSegurar: Math.round(resultado.custoTotalSegurar),
      perdaSacas: Math.round(resultado.perdaSacas),
      receitaAgora: Math.round(resultado.receitaAgora),
    },
  };
}
