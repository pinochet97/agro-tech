// ─────────────────────────────────────────────────────────────
// Backend leve de DESENVOLVIMENTO — GrãoCerto
//
// Servidor HTTP local (porta 8787) que expõe o núcleo compartilhado
// (server/nucleo.mjs) nas mesmas rotas das funções serverless da
// Vercel (api/*.mjs):
//   GET  /api/cotacoes           → cotações CEPEA ao vivo
//   POST /api/interpretar        → {texto} → parâmetros extraídos
//   POST /api/interpretar-imagem → {imagem, mediaType} → romaneio/NF
//
// Em produção quem responde são as funções em api/; este arquivo só
// roda no `npm run dev:all` (o proxy /api do Vite aponta pra cá).
// ─────────────────────────────────────────────────────────────

import { createServer } from "node:http";
import {
  obterCotacoes,
  interpretarTextoNucleo,
  interpretarImagemNucleo,
  temIA,
} from "./nucleo.mjs";

const PORT = Number(process.env.PORT) || 8787;

// Lê e parseia o corpo JSON de um POST (limite p/ fotos em base64).
function lerCorpo(req, limite = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let tam = 0;
    const partes = [];
    req.on("data", (c) => {
      tam += c.length;
      if (tam > limite) {
        reject(new Error("payload muito grande"));
        req.destroy();
      } else {
        partes.push(c);
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(partes).toString("utf8") || "{}"));
      } catch {
        reject(new Error("JSON inválido"));
      }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return res.end();
  }
  const json = (status, corpo) => {
    res.writeHead(status, { ...cors, "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(corpo));
  };

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/health") return json(200, { ok: true });

  if (url.pathname === "/api/cotacoes" || url.pathname === "/cotacoes") {
    try {
      const dados = await obterCotacoes();
      res.setHeader("Cache-Control", "public, max-age=900");
      return json(200, dados);
    } catch (e) {
      return json(502, { erro: String(e.message || e) });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/interpretar") {
    try {
      const { texto } = await lerCorpo(req);
      if (!texto || typeof texto !== "string" || !texto.trim()) {
        return json(400, { erro: "envie { texto } com a frase do produtor" });
      }
      return json(200, await interpretarTextoNucleo(texto.trim()));
    } catch (e) {
      return json(400, { erro: String(e.message || e) });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/interpretar-imagem") {
    if (!temIA()) {
      return json(503, {
        erro:
          "Leitura de foto exige IA no servidor: defina ANTHROPIC_API_KEY no .env e reinicie o backend.",
      });
    }
    try {
      const { imagem, mediaType } = await lerCorpo(req);
      if (!imagem || !/^image\/(jpeg|png|webp|gif)$/.test(mediaType || "")) {
        return json(400, { erro: "envie { imagem: base64, mediaType: image/jpeg|png|webp }" });
      }
      return json(200, await interpretarImagemNucleo(imagem, mediaType));
    } catch (e) {
      return json(502, { erro: `não consegui ler o documento: ${String(e.message || e)}` });
    }
  }

  json(404, { erro: "rota não encontrada" });
});

server.listen(PORT, () => {
  console.log(`[cotacoes-proxy] no ar em http://localhost:${PORT}/api/cotacoes`);
});
