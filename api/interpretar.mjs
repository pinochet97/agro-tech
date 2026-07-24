// Função serverless (Vercel): POST /api/interpretar
//
// Modos, conforme o corpo:
//   { mensagens, lote? } → CHAT com memória: histórico [{papel, texto}]
//                          → { resposta, campos, fonte }
//   { texto, lote? }     → extração de frase única (+ frase de recomendação)
//   { lote }             → só a frase de recomendação do lote
//
// `lote` traz o resultado JÁ CALCULADO pelo app; a IA nunca calcula —
// só conversa e extrai. Sem IA, tudo degrada para regras locais.
import {
  interpretarTextoNucleo,
  recomendarLoteNucleo,
  conversarNucleo,
} from "../server/nucleo.mjs";

const mensagensValidas = (ms) =>
  Array.isArray(ms) &&
  ms.length > 0 &&
  ms.every((m) => m && typeof m.texto === "string" && ["produtor", "graocerto"].includes(m.papel));

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "use POST" });
  }
  const { texto, lote, mensagens } = req.body || {};

  if (lote && !lote.resultado) {
    return res.status(400).json({ erro: "lote precisa vir com o resultado já calculado" });
  }

  // Modo chat (Fase 3)
  if (mensagens !== undefined) {
    if (!mensagensValidas(mensagens)) {
      return res.status(400).json({ erro: "mensagens deve ser [{papel: 'produtor'|'graocerto', texto}]" });
    }
    return res.status(200).json(await conversarNucleo(mensagens, lote || null));
  }

  const temTexto = typeof texto === "string" && texto.trim();
  if (!temTexto && !lote) {
    return res.status(400).json({ erro: "envie { mensagens }, { texto } e/ou { lote }" });
  }
  if (!temTexto) {
    return res.status(200).json(await recomendarLoteNucleo(lote));
  }
  res.status(200).json(await interpretarTextoNucleo(texto.trim(), lote || null));
}
