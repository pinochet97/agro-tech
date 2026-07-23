// Função serverless (Vercel): POST /api/interpretar {texto}
// Extração de parâmetros por IA, com fallback no extrator de regras.
import { interpretarTextoNucleo } from "../server/nucleo.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "use POST" });
  }
  const { texto } = req.body || {};
  if (!texto || typeof texto !== "string" || !texto.trim()) {
    return res.status(400).json({ erro: "envie { texto } com a frase do produtor" });
  }
  res.status(200).json(await interpretarTextoNucleo(texto.trim()));
}
