// Função serverless (Vercel): GET /api/cotacoes
// Cotações CEPEA ao vivo, com cache por instância + CDN (s-maxage).
import { obterCotacoes } from "../server/nucleo.mjs";

export default async function handler(req, res) {
  try {
    const dados = await obterCotacoes();
    // CDN da Vercel segura por 30 min; navegador por 15.
    res.setHeader("Cache-Control", "public, max-age=900, s-maxage=1800");
    res.status(200).json(dados);
  } catch (e) {
    res.status(502).json({ erro: String(e.message || e) });
  }
}
