// ─────────────────────────────────────────────────────────────
// Histórico de simulações — GrãoCerto Fase 1
//
// Cada "Salvar simulação" guarda um retrato completo (entradas +
// resultado) no localStorage, com ID e timestamp. O produtor revisita
// e compara as últimas MAX_SIMULACOES. Sem backend por enquanto —
// localStorage basta para o MVP; quando houver contas, este módulo
// vira a camada de sincronização (mesma estratégia do perfil).
// ─────────────────────────────────────────────────────────────

const CHAVE = "graocerto.simulacoes.v1";
export const MAX_SIMULACOES = 5;

// Registros antigos guardavam UM lote com os campos soltos na raiz.
// Envelopa no formato de múltiplos lotes para não perder o histórico
// de quem já usava o app antes da Fase 1 "Fundação Real".
function migrar(s) {
  if (s.lotes && s.consolidado) return s;
  const r = s.resultado || {};
  const lote = {
    cultura: s.cultura,
    sacas: s.sacas,
    meses: s.meses,
    precoHoje: s.precoHoje,
    precoEsperado: s.precoEsperado,
    custos: s.custos,
    resultado: r,
  };
  return {
    ...s,
    lotes: [lote],
    consolidado: {
      nLotes: 1,
      totalSacas: s.sacas,
      vantagemTotal: r.vantagemTotal ?? 0,
      vantagemPorSaca: r.vantagemPorSaca ?? 0,
      custoTotalSegurar: 0, // não existia no formato antigo
      veredito: r.veredito || "vender",
      armazenar: r.veredito === "armazenar",
      culturas: s.cultura ? [s.cultura] : [],
    },
  };
}

function lerTodas() {
  try {
    const bruto = localStorage.getItem(CHAVE);
    const lista = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(lista) ? lista.map(migrar) : [];
  } catch {
    return []; // storage indisponível/corrompido → começa vazio
  }
}

function persistir(lista) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(lista));
  } catch {
    // sem storage: o app segue, só não persiste
  }
}

// Mais recente primeiro.
export function listarSimulacoes() {
  return lerTodas();
}

// Salva um retrato e devolve a lista atualizada. Mantém só as
// MAX_SIMULACOES mais recentes (a mais antiga sai).
export function salvarSimulacaoHistorico(retrato) {
  const nova = {
    id: `sim_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    criadaEm: new Date().toISOString(),
    ...retrato,
  };
  const lista = [nova, ...lerTodas()].slice(0, MAX_SIMULACOES);
  persistir(lista);
  return lista;
}

export function excluirSimulacao(id) {
  const lista = lerTodas().filter((s) => s.id !== id);
  persistir(lista);
  return lista;
}
