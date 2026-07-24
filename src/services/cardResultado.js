// ─────────────────────────────────────────────────────────────
// Card de resultado real — GrãoCerto Fase 7
//
// Desenha em <canvas> um card 1080×1350 (formato de feed/WhatsApp) com
// o resultado real de um lote fechado, pronto para baixar como PNG ou
// compartilhar (Web Share API). Canvas puro, sem dependência: fontes e
// paleta são as mesmas do app, e o visual ecoa o "romaneio de decisão"
// (picote e furos de ticket). É o card que o produtor mostra pro
// vizinho — o argumento de venda do app.
// ─────────────────────────────────────────────────────────────

import { CULTURAS } from "./lotes";
import { fraseResultado } from "./fechamentos";

export const CARD_L = 1080;
export const CARD_A = 1350;

const CAMPO = "#F2F4EF";
const TINTA = "#1E2A22";
const DOURADO = "#C99B2F";
const VERDE = "#3E6B4F";
const ALERTA = "#A4432E";
const CINZA = "#5A6B5D";
const BORDA = "#C6CFBF";

const fmtN = (v, casas = 0) =>
  Number(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const fmtDataCurta = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? "—" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
};

function quebrar(ctx, texto, larguraMax) {
  const palavras = texto.split(" ");
  const linhas = [];
  let atual = "";
  for (const p of palavras) {
    const tentativa = atual ? `${atual} ${p}` : p;
    if (ctx.measureText(tentativa).width > larguraMax && atual) {
      linhas.push(atual);
      atual = p;
    } else {
      atual = tentativa;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

function pilula(ctx, x, y, largura, altura, cor, texto, corTexto, fonte) {
  ctx.fillStyle = cor;
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(x, y, largura, altura, altura / 2);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, largura, altura); // navegador antigo: sem cantos redondos
  }
  ctx.fillStyle = corTexto;
  ctx.font = fonte;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(texto, x + largura / 2, y + altura / 2 + 2);
}

// Desenha o card completo. Async porque espera as fontes da página.
export async function desenharCard(canvas, f, r) {
  canvas.width = CARD_L;
  canvas.height = CARD_A;
  const ctx = canvas.getContext("2d");

  try {
    await Promise.all([
      document.fonts.load("800 130px Archivo"),
      document.fonts.load("700 56px Archivo"),
      document.fonts.load("600 46px Archivo"),
      document.fonts.load("400 30px 'IBM Plex Mono'"),
      document.fonts.load("600 30px 'IBM Plex Mono'"),
    ]);
  } catch {
    // sem as fontes web, segue com as do sistema
  }

  // fundo
  ctx.fillStyle = CAMPO;
  ctx.fillRect(0, 0, CARD_L, CARD_A);

  // faixa superior (tinta) com a marca
  ctx.fillStyle = TINTA;
  ctx.fillRect(0, 0, CARD_L, 170);
  ctx.fillStyle = CAMPO;
  ctx.font = "800 58px Archivo";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("GRÃOCERTO", 72, 78);
  ctx.font = "400 26px 'IBM Plex Mono'";
  ctx.fillStyle = BORDA;
  ctx.fillText("armazenar ou vender — na prática", 74, 126);
  pilula(ctx, CARD_L - 72 - 300, 56, 300, 60, DOURADO, "RESULTADO REAL", TINTA, "600 28px 'IBM Plex Mono'");

  const positivo = r.delta >= 0;
  const corDelta = positivo ? VERDE : ALERTA;
  const vendeuNoDia = r.decisao === "vendeu";

  // linha-resumo do lote
  const nomeCultura = (CULTURAS[f.cultura]?.nome || f.cultura).toUpperCase();
  ctx.fillStyle = CINZA;
  ctx.font = "600 30px 'IBM Plex Mono'";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(`${nomeCultura} · ${fmtN(f.sacas)} SACAS`, 72, 268);

  // número-manchete: delta vs. vender no dia da simulação (ou, na venda
  // imediata alinhada, a receita garantida)
  const manchete =
    vendeuNoDia && r.seguiu
      ? `R$ ${fmtN(r.receitaNoDia)}`
      : `${positivo ? "+" : "−"} R$ ${fmtN(Math.abs(r.delta))}`;
  const rotuloManchete =
    vendeuNoDia && r.seguiu
      ? "garantidos vendendo no dia certo"
      : "em relação a vender no dia da simulação";
  ctx.fillStyle = vendeuNoDia && r.seguiu ? TINTA : corDelta;
  let corpoFonte = 130;
  ctx.font = `800 ${corpoFonte}px Archivo`;
  while (ctx.measureText(manchete).width > CARD_L - 144 && corpoFonte > 64) {
    corpoFonte -= 8;
    ctx.font = `800 ${corpoFonte}px Archivo`;
  }
  ctx.fillText(manchete, 72, 408);
  ctx.fillStyle = CINZA;
  ctx.font = "600 30px 'IBM Plex Mono'";
  ctx.fillText(rotuloManchete.toUpperCase(), 72, 462);

  // frase em linguagem de produtor
  ctx.fillStyle = TINTA;
  ctx.font = "600 46px Archivo";
  // no máximo 2 linhas — mantém o bloco de dados e o rodapé no lugar
  const linhas = quebrar(ctx, fraseResultado(f, r), CARD_L - 144).slice(0, 2);
  let y = 560;
  for (const linha of linhas) {
    ctx.fillText(linha, 72, y);
    y += 62;
  }
  if (linhas.length === 1) y += 31; // frase curta: centraliza o respiro

  // selo: seguiu ou não a recomendação
  y += 18;
  if (r.seguiu) {
    pilula(ctx, 72, y - 40, 500, 66, VERDE, "✓ SEGUIU A RECOMENDAÇÃO", CAMPO, "600 28px 'IBM Plex Mono'");
  } else {
    pilula(ctx, 72, y - 40, 520, 66, DOURADO, "DECISÃO POR CONTA PRÓPRIA", TINTA, "600 28px 'IBM Plex Mono'");
  }

  // picote de romaneio (linha tracejada + furos nas bordas)
  const yPicote = y + 96;
  ctx.strokeStyle = BORDA;
  ctx.lineWidth = 3;
  ctx.setLineDash([14, 12]);
  ctx.beginPath();
  ctx.moveTo(40, yPicote);
  ctx.lineTo(CARD_L - 40, yPicote);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = TINTA;
  for (const x of [0, CARD_L]) {
    ctx.beginPath();
    ctx.arc(x, yPicote, 26, 0, Math.PI * 2);
    ctx.fill();
  }

  // bloco de dados (mono, 2 colunas), estilo romaneio
  const yDados = yPicote + 84;
  const col2 = CARD_L / 2 + 20;
  ctx.textBaseline = "alphabetic";
  const par = (x, yy, rotulo, valor, corValor = TINTA) => {
    ctx.fillStyle = CINZA;
    ctx.font = "400 26px 'IBM Plex Mono'";
    ctx.textAlign = "left";
    ctx.fillText(rotulo, x, yy);
    ctx.fillStyle = corValor;
    ctx.font = "700 44px Archivo";
    ctx.fillText(valor, x, yy + 52);
  };
  par(72, yDados, "SIMULOU EM", fmtDataCurta(f.dataSimulacao));
  par(col2, yDados, "VENDEU EM", fmtDataCurta(`${f.dataVendaReal}T12:00:00`));
  par(72, yDados + 130, "PREÇO NO DIA", `R$ ${fmtN(f.precoSimulacao, 2)}/sc`);
  par(col2, yDados + 130, "PREÇO DA VENDA", `R$ ${fmtN(f.precoVendaReal, 2)}/sc`, corDelta);
  const custoTxt =
    r.mesesReais >= 0.05
      ? `${fmtN(r.mesesReais, 1)} meses · custou R$ ${fmtN(r.custoSegurar)} segurar`
      : "venda no dia — sem custo de espera";
  par(72, yDados + 260, "TEMPO SEGURADO", custoTxt);

  // rodapé: 3 linhas curtas fixas (cabem folgadas na largura)
  ctx.fillStyle = CINZA;
  ctx.font = "400 22px 'IBM Plex Mono'";
  ctx.fillText("Conta do app: armazenagem + custo do capital + perda técnica.", 72, CARD_A - 116);
  ctx.fillText("Não é recomendação de investimento · CEPEA/ESALQ (CC BY-NC 4.0)", 72, CARD_A - 82);
  ctx.fillText("graocerto-vortex-pay.vercel.app", 72, CARD_A - 48);
}

function paraBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export async function baixarCard(canvas, nomeArquivo = "graocerto-resultado.png") {
  const blob = await paraBlob(canvas);
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

// Compartilhar nativo (WhatsApp etc.) quando o navegador suporta
// compartilhar arquivos; senão o chamador cai no "Baixar".
export async function compartilharCard(canvas) {
  const blob = await paraBlob(canvas);
  if (!blob || !navigator.canShare) return false;
  const arquivo = new File([blob], "graocerto-resultado.png", { type: "image/png" });
  if (!navigator.canShare({ files: [arquivo] })) return false;
  try {
    await navigator.share({ files: [arquivo], title: "Meu resultado no GrãoCerto" });
    return true;
  } catch {
    return false; // usuário cancelou ou o SO negou
  }
}
