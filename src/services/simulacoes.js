// ─────────────────────────────────────────────────────────────
// Histórico de simulações — GrãoCerto Fase 1
//
// Cada "Salvar simulação" guarda um retrato completo (entradas +
// resultado) no localStorage, com ID e timestamp. O produtor revisita
// e compara as últimas MAX_SIMULACOES. Sem backend por enquanto —
// localStorage basta para o MVP; quando houver contas, este módulo
// vira a camada de sincronização (mesma estratégia do perfil).
// ─────────────────────────────────────────────────────────────

import { supabase, usuarioAtual } from "./supabase";

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

// ── Nuvem (Supabase) — fire-and-forget; o localStorage é o cache ──

async function enviarSimulacaoNuvem(sim) {
  if (!supabase) return;
  try {
    const usuario = await usuarioAtual();
    if (!usuario) return;
    const { error } = await supabase.from("simulacoes").upsert({
      id: sim.id,
      user_id: usuario.id,
      dados: sim,
      criada_em: sim.criadaEm,
    });
    if (error) console.warn("[simulacoes] falha ao sincronizar:", error.message);
  } catch (e) {
    console.warn("[simulacoes] falha ao sincronizar:", e.message || e);
  }
}

async function excluirSimulacaoNuvem(id) {
  if (!supabase) return;
  try {
    const usuario = await usuarioAtual();
    if (!usuario) return;
    const { error } = await supabase.from("simulacoes").delete().eq("id", id);
    if (error) console.warn("[simulacoes] falha ao excluir da nuvem:", error.message);
  } catch (e) {
    console.warn("[simulacoes] falha ao excluir da nuvem:", e.message || e);
  }
}

// Ao logar: busca as simulações do usuário na nuvem. Se houver, elas
// vencem e atualizam o cache; se a nuvem estiver vazia e houver locais,
// sobe as locais. Sem Supabase/login, devolve as locais.
export async function sincronizarSimulacoes() {
  const locais = lerTodas();
  if (!supabase) return locais;
  try {
    const usuario = await usuarioAtual();
    if (!usuario) return locais;
    const { data, error } = await supabase
      .from("simulacoes")
      .select("dados")
      .eq("user_id", usuario.id)
      .order("criada_em", { ascending: false })
      .limit(MAX_SIMULACOES);
    if (error) {
      console.warn("[simulacoes] falha ao buscar da nuvem:", error.message);
      return locais;
    }
    const daNuvem = (data || []).map((r) => migrar(r.dados)).filter(Boolean);
    if (daNuvem.length) {
      persistir(daNuvem);
      return daNuvem;
    }
    for (const s of locais) await enviarSimulacaoNuvem(s);
    return locais;
  } catch (e) {
    console.warn("[simulacoes] falha ao sincronizar:", e.message || e);
    return locais;
  }
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
  void enviarSimulacaoNuvem(nova);
  return lista;
}

export function excluirSimulacao(id) {
  const lista = lerTodas().filter((s) => s.id !== id);
  persistir(lista);
  void excluirSimulacaoNuvem(id);
  return lista;
}
