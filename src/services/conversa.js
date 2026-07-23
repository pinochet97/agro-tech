// ─────────────────────────────────────────────────────────────
// Entrada conversacional — GrãoCerto
//
// O produtor manda uma frase (digitada ou por voz) ou a foto de um
// romaneio de balança / nota fiscal; daqui saem os PARÂMETROS da
// simulação, que a interface confirma com ele antes de aplicar.
//
// - Texto: POST /api/interpretar (IA no backend; regras como fallback).
//   Se o backend estiver fora, roda o MESMO extrator de regras aqui
//   no navegador — a feature nunca fica indisponível.
// - Foto: POST /api/interpretar-imagem (exige IA no backend).
// - Voz: Web Speech API do navegador (pt-BR), sem custo e sem backend;
//   nem todo navegador suporta (Chrome/Edge sim, Firefox não).
// ─────────────────────────────────────────────────────────────

import { extrairParametros } from "./extrator";

const TIMEOUT_MS = 90_000;

async function postJson(caminho, corpo) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(caminho, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      signal: ctrl.signal,
    });
    const dados = await resp.json();
    if (!resp.ok) throw new Error(dados.erro || `HTTP ${resp.status}`);
    return dados;
  } finally {
    clearTimeout(t);
  }
}

// Interpreta a frase. Nunca lança: sem backend, cai nas regras locais.
export async function interpretarTexto(texto) {
  try {
    return await postJson("/api/interpretar", { texto });
  } catch {
    return {
      campos: extrairParametros(texto),
      resumo: null,
      fonte: "regras",
      aviso: "Backend fora do ar — interpretação por regras, no seu navegador.",
    };
  }
}

// Reduz a foto (máx. 1568 px no maior lado, JPEG) e manda pro backend.
// Lança com mensagem amigável quando a leitura não é possível.
export async function interpretarImagem(arquivo) {
  const { base64, mediaType } = await redimensionarImagem(arquivo);
  return postJson("/api/interpretar-imagem", { imagem: base64, mediaType });
}

const LADO_MAX = 1568; // suficiente p/ OCR de documento sem estourar payload

function redimensionarImagem(arquivo) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const escala = Math.min(1, LADO_MAX / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * escala);
      canvas.height = Math.round(img.height * escala);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      resolve({ base64: dataUrl.split(",")[1], mediaType: "image/jpeg" });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("não consegui abrir essa imagem — tente uma foto JPG ou PNG"));
    };
    img.src = url;
  });
}

// ── Voz (Web Speech API) ─────────────────────────────────────

export function vozSuportada() {
  return typeof window !== "undefined" &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// Cria um reconhecedor pt-BR. onTexto recebe o texto acumulado;
// onFim é chamado quando a captura termina (inclusive por erro).
export function criarReconhecimentoVoz(onTexto, onFim) {
  const Reconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Reconhecimento) return null;
  const rec = new Reconhecimento();
  rec.lang = "pt-BR";
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (e) => {
    let texto = "";
    for (const resultado of e.results) texto += resultado[0].transcript;
    onTexto(texto.trim());
  };
  rec.onend = () => onFim();
  rec.onerror = () => onFim();
  return rec;
}
