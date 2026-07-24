// ─────────────────────────────────────────────────────────────
// Cliente Supabase — GrãoCerto Fase 4
//
// Autenticação (magic link) + persistência de perfil e simulações.
// SEM as variáveis VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY o cliente
// fica null e o app segue 100% no localStorage, como sempre — mesma
// filosofia de degradação do resto do projeto. A anon key é pública por
// design (a segurança vem do RLS no banco), mas mesmo assim vive em
// variável de ambiente, não no código.
// ─────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";

// import.meta.env existe no Vite; o guard permite importar os serviços
// em Node puro (testes das funções que não usam nuvem)
const env = import.meta.env || {};
const url = (env.VITE_SUPABASE_URL || "").trim();
const anon = (env.VITE_SUPABASE_ANON_KEY || "").trim();

export const supabase = url && anon ? createClient(url, anon) : null;

export const supabaseConfigurado = () => !!supabase;

// Usuário logado (ou null). Nunca lança.
export async function usuarioAtual() {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user ?? null;
  } catch {
    return null;
  }
}
