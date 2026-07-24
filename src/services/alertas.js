// ─────────────────────────────────────────────────────────────
// Alertas de preço — GrãoCerto Fase 6
//
// "Me avise quando a soja chegar a R$ X." Os alertas vivem no Supabase
// (tabela `alertas`, RLS por usuário) e são checados pelo cron
// server/cron-alertas.mjs, que dispara WhatsApp e marca o status.
// Exige Supabase configurado E login — sem isso, as funções devolvem
// { erro } amigável e a interface explica o que falta.
// ─────────────────────────────────────────────────────────────

import { supabase, usuarioAtual } from "./supabase";

const SEM_NUVEM = { erro: "Alertas precisam da conta na nuvem — entre na aba Conta." };

export async function listarAlertas() {
  if (!supabase) return { alertas: [], ...SEM_NUVEM };
  const usuario = await usuarioAtual();
  if (!usuario) return { alertas: [], ...SEM_NUVEM };
  const { data, error } = await supabase
    .from("alertas")
    .select("*")
    .order("criado_em", { ascending: false });
  if (error) return { alertas: [], erro: error.message };
  return { alertas: data || [] };
}

export async function criarAlerta({ cultura, praca, precoAlvo, tipo, telefone }) {
  if (!supabase) return SEM_NUVEM;
  const usuario = await usuarioAtual();
  if (!usuario) return SEM_NUVEM;
  const { error } = await supabase.from("alertas").insert({
    user_id: usuario.id,
    cultura,
    praca: praca || null,
    preco_alvo: precoAlvo,
    tipo,
    telefone: telefone ? telefone.replace(/\D/g, "") : null,
  });
  if (error) return { erro: error.message };
  return { ok: true };
}

export async function excluirAlerta(id) {
  if (!supabase) return SEM_NUVEM;
  const { error } = await supabase.from("alertas").delete().eq("id", id);
  if (error) return { erro: error.message };
  return { ok: true };
}
