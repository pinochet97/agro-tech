// ─────────────────────────────────────────────────────────────
// Resultado real — GrãoCerto Fase 7
//
// Fecha o ciclo da decisão: o produtor simulou, o app recomendou, e um
// dia ele VENDEU de verdade. "Vendi este lote" registra data e preço
// reais e compara o caminho tomado com a alternativa de ter vendido no
// dia da simulação original — usando o MESMO modelo de custos do app
// (armazenagem, capital, perda técnica), agora com o tempo que de fato
// passou. Nada aqui é projeção: só preços e datas que aconteceram.
//
// Padrão local-first igual a perfil/simulações: localStorage é a
// verdade imediata; com Supabase + login, cada fechamento sobe
// fire-and-forget para a tabela `lotes_fechados`
// (supabase/migrations/02_fechamentos.sql).
// ─────────────────────────────────────────────────────────────

import { supabase, usuarioAtual } from "./supabase.js";

const CHAVE = "graocerto.fechamentos.v1";
const MAX_FECHAMENTOS = 50;
const MS_MES = 30.44 * 24 * 3600 * 1000; // mês médio

// ── Lógica pura (também usada nos testes) ────────────────────

// Compara o que o produtor fez (vender em data_venda_real ao preço
// real, pagando os custos de segurar até lá) com vender no dia da
// simulação ao preço daquele dia. Mesmas fórmulas de calcularLote(),
// com `mesesReais` no lugar do horizonte planejado.
export function calcularResultadoReal(f) {
  const sacas = f.sacas;
  const { armazenagem, jurosMes, perdaMes } = f.custos;

  const inicio = new Date(f.dataSimulacao).getTime();
  const fim = new Date(f.dataVendaReal).getTime();
  const mesesReais = Math.max(0, (fim - inicio) / MS_MES);

  const receitaNoDia = f.precoSimulacao * sacas;

  const perdaTotal = 1 - Math.pow(1 - perdaMes / 100, mesesReais);
  const sacasFinais = sacas * (1 - perdaTotal);
  const custoArmazenagem = armazenagem * mesesReais * sacas;
  const custoCapital = receitaNoDia * (Math.pow(1 + jurosMes / 100, mesesReais) - 1);
  const receitaBrutaReal = f.precoVendaReal * sacasFinais;
  const liquidoReal = receitaBrutaReal - custoArmazenagem - custoCapital;

  const delta = liquidoReal - receitaNoDia;
  const deltaPorSaca = sacas > 0 ? delta / sacas : 0;

  const decisao = decisaoTomada(f.dataSimulacao, f.dataVendaReal);
  const seguiu =
    decisao === "vendeu" ? f.recomendacao === "vender" : f.recomendacao === "armazenar";

  // O acerto da recomendação só é verificável quando houve espera de
  // fato (janela observada). Venda no dia → sem contrafactual honesto.
  const verificavel = decisao === "segurou";
  const acertou = verificavel
    ? f.recomendacao === "armazenar"
      ? delta > 0
      : delta < 0
    : null;

  return {
    mesesReais,
    receitaNoDia,
    custoArmazenagem,
    custoCapital,
    custoSegurar: custoArmazenagem + custoCapital,
    perdaSacas: sacas - sacasFinais,
    receitaBrutaReal,
    liquidoReal,
    delta,
    deltaPorSaca,
    decisao,
    seguiu,
    verificavel,
    acertou,
  };
}

// Vendeu em até ~15 dias da simulação = "vendeu" (executou já);
// mais que isso = "segurou" antes de vender.
export function decisaoTomada(dataSimulacao, dataVendaReal) {
  const meses = (new Date(dataVendaReal) - new Date(dataSimulacao)) / MS_MES;
  return meses < 0.5 ? "vendeu" : "segurou";
}

const fmtR$ = (v) =>
  Math.abs(Math.round(v)).toLocaleString("pt-BR", { maximumFractionDigits: 0 });

// A frase-manchete do resultado, em linguagem de produtor. Honesta nos
// dois sentidos: contar quando seguir o app pagou E quando não pagou.
export function fraseResultado(f, r) {
  const x = `R$ ${fmtR$(r.delta)}`;
  if (r.decisao === "segurou") {
    if (r.seguiu) {
      return r.delta > 0
        ? `Você ganhou ${x} a mais por seguir o GrãoCerto.`
        : `Desta vez o mercado andou contra: segurar custou ${x}.`;
    }
    return r.delta > 0
      ? `Você segurou por conta própria e ganhou ${x}.`
      : `Você deixou ${x} na mesa ao segurar — a recomendação era vender no dia.`;
  }
  // vendeu no dia (ou quase)
  if (r.seguiu) {
    return `Venda no dia certo: R$ ${fmtR$(r.receitaNoDia)} garantidos, sem custo de espera.`;
  }
  return `Você vendeu antes da hora — a recomendação era segurar por ${f.mesesPlanejados} ${f.mesesPlanejados === 1 ? "mês" : "meses"}.`;
}

// Monta o fechamento a partir do lote atual + histórico de simulações.
// A "simulação original" é a mais recente salva ANTES da venda que tem
// um lote da mesma cultura (o de sacas mais próximas). Sem nenhuma,
// compara com os números de hoje e marca `semBaseline`.
export function montarFechamento(lote, resultado, simulacoes, { dataVenda, precoVenda }) {
  let base = null;
  let sim = null;
  const fimDaVenda = new Date(`${dataVenda}T23:59:59`).getTime();
  const candidatas = (simulacoes || []).filter((s) =>
    (s.lotes || []).some((l) => l.cultura === lote.cultura),
  );
  // lista vem mais recente primeiro; preferir a mais recente que
  // antecede a venda, senão a mais antiga disponível
  sim =
    candidatas.find((s) => new Date(s.criadaEm).getTime() <= fimDaVenda) ||
    candidatas[candidatas.length - 1] ||
    null;
  if (sim) {
    base = sim.lotes
      .filter((l) => l.cultura === lote.cultura)
      .reduce((m, c) => (Math.abs(c.sacas - lote.sacas) < Math.abs(m.sacas - lote.sacas) ? c : m));
  }

  const dataSimulacao = sim ? sim.criadaEm : new Date().toISOString();
  return {
    id: `fech_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    criadoEm: new Date().toISOString(),
    simulacaoId: sim?.id ?? null,
    semBaseline: !base,
    cultura: lote.cultura,
    sacas: lote.sacas,
    precoSimulacao: base?.precoHoje ?? lote.precoHoje,
    dataSimulacao,
    recomendacao: base?.resultado?.veredito ?? resultado.veredito,
    precoEmpate: base?.resultado?.precoEmpate ?? resultado.precoEmpate,
    mesesPlanejados: base?.meses ?? lote.meses,
    custos: { ...(base?.custos ?? lote.custos) },
    precoVendaReal: precoVenda,
    dataVendaReal: dataVenda,
    decisaoTomada: decisaoTomada(dataSimulacao, dataVenda),
  };
}

// Agregado da seção "Seu Desempenho": soma os deltas separando o que
// aconteceu seguindo a recomendação do que aconteceu contrariando.
export function resumoDesempenho(fechamentos) {
  const itens = fechamentos.map((f) => ({ f, r: calcularResultadoReal(f) }));
  const soma = (lista) => lista.reduce((s, { r }) => s + r.delta, 0);

  const seguindo = itens.filter(({ r }) => r.seguiu && r.decisao === "segurou");
  const contrariando = itens.filter(({ r }) => !r.seguiu);
  const verificaveis = itens.filter(({ r }) => r.verificavel);

  return {
    n: itens.length,
    sacas: itens.reduce((s, { f }) => s + f.sacas, 0),
    receitaReal: itens.reduce((s, { r }) => s + r.receitaBrutaReal, 0),
    saldoTotal: soma(itens),
    ganhoSeguindo: soma(seguindo),
    nSeguindo: seguindo.length,
    saldoContrariando: soma(contrariando),
    nContrariando: contrariando.length,
    acertos: verificaveis.filter(({ r }) => r.acertou).length,
    nVerificaveis: verificaveis.length,
  };
}

// ── Persistência (localStorage + nuvem fire-and-forget) ──────

function lerTodos() {
  try {
    const bruto = localStorage.getItem(CHAVE);
    const lista = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

function persistir(lista) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(lista));
  } catch {
    // sem storage: o app segue, só não persiste
  }
}

export function listarFechamentos() {
  return lerTodos();
}

async function enviarFechamentoNuvem(f) {
  if (!supabase) return;
  try {
    const usuario = await usuarioAtual();
    if (!usuario) return;
    const { error } = await supabase.from("lotes_fechados").upsert({
      id: f.id,
      user_id: usuario.id,
      cultura: f.cultura,
      sacas: f.sacas,
      preco_simulacao: f.precoSimulacao,
      data_simulacao: f.dataSimulacao,
      recomendacao: f.recomendacao,
      preco_venda_real: f.precoVendaReal,
      data_venda_real: f.dataVendaReal,
      decisao_tomada: f.decisaoTomada,
      dados: f,
      criado_em: f.criadoEm,
    });
    if (error) console.warn("[fechamentos] falha ao sincronizar:", error.message);
  } catch (e) {
    console.warn("[fechamentos] falha ao sincronizar:", e.message || e);
  }
}

async function excluirFechamentoNuvem(id) {
  if (!supabase) return;
  try {
    const usuario = await usuarioAtual();
    if (!usuario) return;
    const { error } = await supabase.from("lotes_fechados").delete().eq("id", id);
    if (error) console.warn("[fechamentos] falha ao excluir da nuvem:", error.message);
  } catch (e) {
    console.warn("[fechamentos] falha ao excluir da nuvem:", e.message || e);
  }
}

// Mesmas regras de sync do resto do app: nuvem vence; nuvem vazia ←
// os locais sobem. Sem Supabase/login, devolve os locais.
export async function sincronizarFechamentos() {
  const locais = lerTodos();
  if (!supabase) return locais;
  try {
    const usuario = await usuarioAtual();
    if (!usuario) return locais;
    const { data, error } = await supabase
      .from("lotes_fechados")
      .select("dados")
      .eq("user_id", usuario.id)
      .order("criado_em", { ascending: false })
      .limit(MAX_FECHAMENTOS);
    if (error) {
      console.warn("[fechamentos] falha ao buscar da nuvem:", error.message);
      return locais;
    }
    const daNuvem = (data || []).map((r) => r.dados).filter(Boolean);
    if (daNuvem.length) {
      persistir(daNuvem);
      return daNuvem;
    }
    for (const f of locais) await enviarFechamentoNuvem(f);
    return locais;
  } catch (e) {
    console.warn("[fechamentos] falha ao sincronizar:", e.message || e);
    return locais;
  }
}

export function registrarFechamento(fechamento) {
  const lista = [fechamento, ...lerTodos()].slice(0, MAX_FECHAMENTOS);
  persistir(lista);
  void enviarFechamentoNuvem(fechamento);
  return lista;
}

export function excluirFechamento(id) {
  const lista = lerTodos().filter((f) => f.id !== id);
  persistir(lista);
  void excluirFechamentoNuvem(id);
  return lista;
}
