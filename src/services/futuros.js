// ─────────────────────────────────────────────────────────────
// Futuros B3 — GrãoCerto Fase 5
//
// Consome /api/futuros (curvas de ajuste CCM/milho e SJC/soja, ambas
// já em R$/saca) e sugere o preço esperado do lote a partir do
// contrato cujo vencimento é o mais próximo do horizonte escolhido.
// Sem backend / B3 fora do ar: devolve null e o produtor segue no
// palpite manual do slider — fallback de sempre.
// ─────────────────────────────────────────────────────────────

const TIMEOUT_MS = 10_000;

// Busca a curva. Devolve null em qualquer falha — nunca lança.
export async function buscarFuturos() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch("/api/futuros", {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!resp.ok) return null;
    const dados = await resp.json();
    if (!dados?.curvas) return null;
    return dados;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Contrato da curva com vencimento mais próximo de (hoje + meses).
// Devolve {codigo, rotulo, vencimento, preco} ou null.
export function precoSugerido(curva, meses, agora = new Date()) {
  if (!Array.isArray(curva) || !curva.length) return null;
  const alvo = new Date(agora.getFullYear(), agora.getMonth() + Number(meses || 0), 15);
  let melhor = null;
  let melhorDist = Infinity;
  for (const c of curva) {
    const [ano, mes] = String(c.vencimento).split("-").map(Number);
    if (!ano || !mes) continue;
    const venc = new Date(ano, mes - 1, 15);
    const dist = Math.abs(venc - alvo);
    if (dist < melhorDist) {
      melhorDist = dist;
      melhor = c;
    }
  }
  return melhor;
}
