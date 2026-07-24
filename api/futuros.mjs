// Função serverless (Vercel): GET /api/futuros
// Curva de futuros B3 (CCM milho R$/saca; SJC soja convertida p/ R$),
// com cache por instância + CDN.
import { obterFuturosB3 } from "../server/nucleo.mjs";

export default async function handler(req, res) {
  try {
    const dados = await obterFuturosB3();
    res.setHeader("Cache-Control", "public, max-age=900, s-maxage=1800");
    res.status(200).json(dados);
  } catch (e) {
    res.status(502).json({ erro: String(e.message || e) });
  }
}
