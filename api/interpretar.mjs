// Função serverless (Vercel): POST /api/interpretar
//
// Dois usos, dependendo do corpo:
//   { texto }         → extrai parâmetros da frase do produtor
//   { texto, lote }   → extrai + gera a frase de recomendação do lote
//   { lote }          → só a frase de recomendação
//
// `lote` traz o resultado JÁ CALCULADO pelo app; a IA só veste os números
// em linguagem de produtor (nunca calcula). Sem IA, cai no template local.
import { interpretarTextoNucleo, recomendarLoteNucleo } from "../server/nucleo.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "use POST" });
  }
  const { texto, lote } = req.body || {};
  const temTexto = typeof texto === "string" && texto.trim();

  if (!temTexto && !lote) {
    return res.status(400).json({ erro: "envie { texto } e/ou { lote }" });
  }
  if (lote && !lote.resultado) {
    return res.status(400).json({ erro: "lote precisa vir com o resultado já calculado" });
  }

  if (!temTexto) {
    return res.status(200).json(await recomendarLoteNucleo(lote));
  }
  res.status(200).json(await interpretarTextoNucleo(texto.trim(), lote || null));
}
