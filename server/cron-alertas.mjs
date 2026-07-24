// ─────────────────────────────────────────────────────────────
// Cron de alertas de preço — GrãoCerto Fase 6
//
// Roda de fora do app (GitHub Actions: .github/workflows/cron-alertas.yml,
// ou `node server/cron-alertas.mjs` na mão). A cada execução:
//   1. puxa as cotações atuais (obterCotacoes → CEPEA ao vivo);
//   2. lê os alertas `pendente` no Supabase (SERVICE ROLE — bypassa RLS,
//      por isso essa chave NUNCA vai para o front nem para o git);
//   3. para cada alerta atingido: envia WhatsApp (Meta Cloud API),
//      registra a notificação e marca o alerta como `disparado`.
//
// Degradações: sem SUPABASE_SERVICE_ROLE_KEY → sai explicando; sem
// chaves do WhatsApp → modo SIMULAÇÃO (loga a mensagem, registra a
// notificação como simulada e ainda marca o alerta — controlável com
// ALERTAS_SIMULAR=1 explícito para teste com chaves configuradas).
// ─────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";
import { obterCotacoes } from "./nucleo.mjs"; // também carrega o .env da raiz

const NOMES = { soja: "Soja", milho: "Milho", trigo: "Trigo" };

// ── Lógica pura (exportada para teste) ───────────────────────

// Alerta atingido? Devolve {preco, praca} ou null.
export function avaliarAlerta(alerta, cotacoes) {
  const cot = cotacoes?.[alerta.cultura];
  if (!cot || typeof cot.preco !== "number") return null;
  const atingido =
    alerta.tipo === "maior_que"
      ? cot.preco >= Number(alerta.preco_alvo)
      : cot.preco <= Number(alerta.preco_alvo);
  return atingido ? { preco: cot.preco, praca: alerta.praca || cot.praca || "sua praça" } : null;
}

export function mensagemAlerta(alerta, atingido) {
  const nome = NOMES[alerta.cultura] || alerta.cultura;
  // praça vem como "Soja Paranaguá" — tira a cultura repetida ("A Soja em Paranaguá")
  const praca = atingido.praca.replace(/^(soja|milho|trigo)\s+/i, "");
  const preco = atingido.preco.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `GrãoCerto: A ${nome} em ${praca} bateu R$ ${preco} hoje. Hora de revisar sua estratégia: https://graocerto-vortex-pay.vercel.app`;
}

// ── WhatsApp (Meta Cloud API) ────────────────────────────────

async function enviarWhatsApp(telefone, mensagem) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const simular = !token || !phoneId || process.env.ALERTAS_SIMULAR === "1";

  if (simular) {
    console.log(`  [SIMULAÇÃO] WhatsApp para ${telefone || "(sem telefone)"}: "${mensagem}"`);
    return { sucesso: true, detalhe: "simulado (sem WHATSAPP_TOKEN/PHONE_NUMBER_ID)" };
  }
  if (!telefone) return { sucesso: false, detalhe: "alerta sem telefone" };

  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: telefone,
        type: "text",
        text: { body: mensagem },
      }),
    });
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok) {
      return { sucesso: false, detalhe: `HTTP ${r.status}: ${JSON.stringify(corpo).slice(0, 200)}` };
    }
    return { sucesso: true, detalhe: corpo?.messages?.[0]?.id || "enviado" };
  } catch (e) {
    return { sucesso: false, detalhe: String(e.message || e) };
  }
}

// ── Execução ─────────────────────────────────────────────────

export async function rodarAlertas() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    console.error(
      "[cron-alertas] faltam SUPABASE_URL (ou VITE_SUPABASE_URL) e SUPABASE_SERVICE_ROLE_KEY — nada a fazer.",
    );
    // no-op, não erro: o workflow não deve ficar vermelho num repo sem secrets
    return { noop: true };
  }
  const banco = createClient(url, chave, { auth: { persistSession: false } });

  console.log("[cron-alertas] buscando cotações…");
  let cotacoes;
  try {
    const dados = await obterCotacoes();
    cotacoes = dados.cotacoes;
    console.log(
      `[cron-alertas] cotações de ${dados.atualizadoEm}:`,
      Object.entries(cotacoes)
        .map(([c, v]) => `${c}=${v.preco}`)
        .join(" "),
      dados.stale ? "(stale)" : "",
    );
  } catch (e) {
    console.error("[cron-alertas] cotações indisponíveis:", e.message || e);
    return { erro: "cotações indisponíveis" };
  }

  const { data: alertas, error } = await banco
    .from("alertas")
    .select("*")
    .eq("status", "pendente");
  if (error) {
    console.error("[cron-alertas] erro lendo alertas:", error.message);
    return { erro: error.message };
  }
  console.log(`[cron-alertas] ${alertas.length} alerta(s) pendente(s).`);

  let disparados = 0;
  for (const alerta of alertas) {
    const atingido = avaliarAlerta(alerta, cotacoes);
    if (!atingido) continue;

    const msg = mensagemAlerta(alerta, atingido);
    console.log(`[cron-alertas] alvo atingido (${alerta.cultura} ${alerta.tipo} ${alerta.preco_alvo}):`);
    const envio = await enviarWhatsApp(alerta.telefone, msg);

    const { error: eNotif } = await banco.from("notificacoes").insert({
      alerta_id: alerta.id,
      user_id: alerta.user_id,
      canal: "whatsapp",
      mensagem: msg,
      sucesso: envio.sucesso,
      detalhe: envio.detalhe,
    });
    if (eNotif) console.error("  erro registrando notificação:", eNotif.message);

    if (envio.sucesso) {
      const { error: eUp } = await banco
        .from("alertas")
        .update({ status: "disparado", disparado_em: new Date().toISOString() })
        .eq("id", alerta.id);
      if (eUp) console.error("  erro atualizando status:", eUp.message);
      else disparados++;
    } else {
      // envio falhou: alerta continua pendente e tenta de novo na próxima
      console.error("  envio falhou:", envio.detalhe);
    }
  }

  console.log(`[cron-alertas] concluído: ${disparados} disparado(s).`);
  return { pendentes: alertas.length, disparados };
}

// Só executa quando chamado direto (não em import de teste).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  rodarAlertas().then((r) => {
    if (r?.erro) process.exitCode = 1;
  });
}
