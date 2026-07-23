// Função serverless (Vercel): POST /api/interpretar-imagem {imagem, mediaType}
// Leitura de romaneio de balança / nota fiscal por visão (exige IA).
import { interpretarImagemNucleo, temIA } from "../server/nucleo.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "use POST" });
  }
  if (!temIA()) {
    return res.status(503).json({
      erro: "Leitura de foto exige IA no servidor: configure ANTHROPIC_API_KEY no projeto da Vercel.",
    });
  }
  const { imagem, mediaType } = req.body || {};
  if (!imagem || !/^image\/(jpeg|png|webp|gif)$/.test(mediaType || "")) {
    return res.status(400).json({ erro: "envie { imagem: base64, mediaType: image/jpeg|png|webp }" });
  }
  try {
    res.status(200).json(await interpretarImagemNucleo(imagem, mediaType));
  } catch (e) {
    res.status(502).json({ erro: `não consegui ler o documento: ${String(e.message || e)}` });
  }
}
