import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { buscarCotacoes } from "./services/cotacoes";
import { REGIOES, defaultsDaRegiao, carregarPerfil, atualizarPerfil } from "./services/perfil";
import {
  interpretarTexto,
  interpretarImagem,
  gerarRecomendacao,
  vozSuportada,
  criarReconhecimentoVoz,
} from "./services/conversa";
import { listarSimulacoes, salvarSimulacaoHistorico, excluirSimulacao, MAX_SIMULACOES } from "./services/simulacoes";
import { CULTURAS, criarLote, calcularLote, consolidar, retratoParaIA } from "./services/lotes";

// ─────────────────────────────────────────────────────────────
// GrãoCerto — MVP Fase 1: Armazenar ou Vender
// Ferramenta de decisão de comercialização para o médio produtor
// Paleta: campo claro #F2F4EF · tinta #1E2A22 · milho #C99B2F ·
//         soja #3E6B4F · alerta #A4432E
//
// A safra é modelada como LOTES independentes (services/lotes.js):
// cada um tem cultura, volume, preços, horizonte e custos próprios,
// e é calculado separadamente. Com mais de um lote, aparece também a
// visão consolidada da safra.
// ─────────────────────────────────────────────────────────────

const fmtBRL = (v, dec = 0) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });

// "2026-07-23" → "23/07/2026" (sem depender de fuso horário)
const fmtData = (iso) => {
  if (!iso) return "";
  const [a, m, d] = String(iso).split("-");
  return d && m && a ? `${d}/${m}/${a}` : String(iso);
};

// ISO → "23/07 17:40" (hora local do produtor)
const fmtDataHora = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const plMeses = (n) => `${n} ${n === 1 ? "mês" : "meses"}`;

// Linhas da tabela de comparação de simulações salvas (visão consolidada).
const LINHAS_COMPARACAO = [
  ["Lotes", (s) => String(s.consolidado.nLotes)],
  ["Culturas", (s) => (s.consolidado.culturas || []).map((c) => CULTURAS[c]?.nome || c).join(", ")],
  ["Sacas", (s) => fmtBRL(s.consolidado.totalSacas)],
  ["Veredito", (s) => (s.consolidado.veredito === "armazenar" ? "Armazenar" : "Vender")],
  [
    "Vantagem/saca",
    (s) => `${s.consolidado.vantagemPorSaca >= 0 ? "+" : "−"} R$ ${fmtBRL(Math.abs(s.consolidado.vantagemPorSaca), 2)}`,
  ],
  [
    "Vantagem total",
    (s) => `${s.consolidado.vantagemTotal >= 0 ? "+" : "−"} R$ ${fmtBRL(Math.abs(s.consolidado.vantagemTotal))}`,
  ],
  ["Custo de segurar", (s) => `R$ ${fmtBRL(s.consolidado.custoTotalSegurar)}`],
];

// Como exibir cada parâmetro extraído no card "foi isso que entendi".
const ROTULOS_CAMPOS = {
  cultura: ["Cultura", (v) => CULTURAS[v]?.nome || v],
  sacas: ["Quantidade", (v) => `${fmtBRL(v)} sacas`],
  precoHoje: ["Preço hoje", (v) => `R$ ${fmtBRL(v, 2)}/saca`],
  precoEsperado: ["Preço esperado", (v) => `R$ ${fmtBRL(v, 2)}/saca`],
  meses: ["Horizonte", (v) => plMeses(v)],
  jurosMes: ["Custo do dinheiro", (v) => `${fmtBRL(v, 2)}% a.m.`],
  custoArmz: ["Armazenagem", (v) => `R$ ${fmtBRL(v, 2)}/saca/mês`],
  perdaMes: ["Perda técnica", (v) => `${fmtBRL(v, 2)}% ao mês`],
  dataDocumento: ["Data do documento", (v) => String(v)],
};

// Assinatura das entradas de um lote — muda quando o resultado muda, e é
// assim que sabemos que a frase de recomendação ficou desatualizada.
const assinaturaLote = (l) =>
  JSON.stringify([l.cultura, l.sacas, l.precoHoje, l.precoEsperado, l.meses, l.custos]);

function Campo({ rotulo, sufixo, valor, onChange, passo = 1, min = 0, ajuda }) {
  return (
    <label style={st.campo}>
      <span style={st.campoRotulo}>{rotulo}</span>
      <span style={st.campoLinha}>
        <input
          type="number"
          value={valor}
          step={passo}
          min={min}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          style={st.campoInput}
        />
        {sufixo && <span style={st.campoSufixo}>{sufixo}</span>}
      </span>
      {ajuda && <span style={st.campoAjuda}>{ajuda}</span>}
    </label>
  );
}

export default function App() {
  // ── Perfil persistente do produtor ────────────────────────────
  // null = primeira visita → mostra o formulário de perfil antes da
  // primeira simulação. Depois, tudo nasce pré-preenchido dele.
  const [perfil, setPerfil] = useState(() => carregarPerfil());
  const [simSalva, setSimSalva] = useState(false);

  // ── Aba ativa do dashboard (Fase 2) ───────────────────────────
  // "home" | "operacao" | "inteligencia" | "conta"
  const [abaAtiva, setAbaAtiva] = useState("home");
  const [contaSalva, setContaSalva] = useState(false);

  // ── Lotes: o estado central da safra ──────────────────────────
  const [lotes, setLotes] = useState(() => [
    criarLote({
      cultura: perfil?.culturaPrincipal,
      sacas: perfil?.sacas,
      meses: perfil?.meses,
      custos: perfil?.custos && {
        armazenagem: perfil.custos.armazenagem,
        jurosMes: perfil.custos.jurosMes,
        perdaMes: perfil.custos.perdaMes,
      },
    }),
  ]);

  const resultados = useMemo(() => lotes.map(calcularLote), [lotes]);
  const consolidado = useMemo(() => consolidar(lotes, resultados), [lotes, resultados]);

  // Altera campos de um lote (mescla `custos` quando vier).
  const mudarLote = useCallback((id, campos) => {
    setLotes((ls) =>
      ls.map((l) =>
        l.id === id
          ? { ...l, ...campos, custos: campos.custos ? { ...l.custos, ...campos.custos } : l.custos }
          : l,
      ),
    );
  }, []);

  const adicionarLote = () => {
    // Novo lote herda cultura e custos do último — o produtor costuma
    // fatiar a mesma safra ("vendo 30% agora, seguro 70%").
    const ultimo = lotes[lotes.length - 1];
    setLotes((ls) => [
      ...ls,
      criarLote({
        cultura: ultimo?.cultura,
        precoHoje: ultimo?.precoHoje,
        precoEsperado: ultimo?.precoEsperado,
        meses: ultimo?.meses,
        custos: ultimo?.custos,
        precoEditado: ultimo?.precoEditado,
      }),
    ]);
  };

  const excluirLote = (id) => {
    setLotes((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls));
    setFrases((f) => {
      const { [id]: _fora, ...resto } = f;
      return resto;
    });
  };

  // ── Cotação automática (CEPEA/ESALQ) ──────────────────────────
  const [cotacoes, setCotacoes] = useState(null);
  const [statusCot, setStatusCot] = useState("carregando");

  const carregarCotacoes = useCallback(async () => {
    setStatusCot("carregando");
    try {
      const dados = await buscarCotacoes();
      setCotacoes(dados);
      setStatusCot("ok");
      return dados;
    } catch {
      setStatusCot("erro"); // fonte indisponível → segue no manual
      return null;
    }
  }, []);

  useEffect(() => {
    carregarCotacoes();
  }, [carregarCotacoes]);

  // Aplica a cotação a cada lote cujo preço o produtor ainda não digitou.
  useEffect(() => {
    if (!cotacoes) return;
    setLotes((ls) => {
      let mudou = false;
      const novo = ls.map((l) => {
        if (l.precoEditado) return l;
        const cot = cotacoes[l.cultura];
        if (cot && typeof cot.preco === "number" && l.precoHoje !== cot.preco) {
          mudou = true;
          return { ...l, precoHoje: cot.preco };
        }
        return l;
      });
      return mudou ? novo : ls; // mesma referência = sem re-render em loop
    });
  }, [cotacoes]);

  // Rebusca a cotação e reaplica no lote, descartando a edição manual.
  const reaplicarCotacao = async (id) => {
    const dados = await carregarCotacoes();
    const lote = lotes.find((l) => l.id === id);
    if (dados && lote && dados[lote.cultura]) {
      mudarLote(id, { precoHoje: dados[lote.cultura].preco, precoEditado: false });
    }
  };

  const trocarCultura = (id, c) => {
    const cot = cotacoes?.[c];
    mudarLote(id, {
      cultura: c,
      precoHoje: cot?.preco ?? CULTURAS[c].precoHoje,
      precoEsperado: CULTURAS[c].precoEsperado,
      precoEditado: false,
    });
  };

  // Aplica o perfil do onboarding — cria o primeiro lote e cai na Home.
  const aplicarPerfil = (p) => {
    setPerfil(p);
    setAbaAtiva("home");
    const cot = cotacoes?.[p.culturaPrincipal];
    setLotes([
      criarLote({
        cultura: p.culturaPrincipal,
        sacas: p.sacas,
        meses: p.meses,
        precoHoje: cot?.preco,
        custos: p.custos,
      }),
    ]);
    setFrases({});
  };

  const salvarPerfilDoForm = (dados) => aplicarPerfil(atualizarPerfil(dados));

  // ── Frases de recomendação, por lote ──────────────────────────
  // { [loteId]: { texto, fonte, aviso, assinatura } } — a assinatura diz
  // se a frase ainda corresponde aos números na tela.
  const [frases, setFrases] = useState({});
  const [gerando, setGerando] = useState(null); // id do lote em geração

  const pedirRecomendacao = async (lote, resultado) => {
    setGerando(lote.id);
    try {
      const r = await gerarRecomendacao(retratoParaIA(lote, resultado));
      setFrases((f) => ({
        ...f,
        [lote.id]: {
          texto: r.frase,
          fonte: r.fonte,
          aviso: r.aviso,
          assinatura: assinaturaLote(lote),
        },
      }));
    } finally {
      setGerando(null);
    }
  };

  // ── Histórico de simulações (localStorage) ────────────────────
  const [simulacoes, setSimulacoes] = useState(() => listarSimulacoes());
  const [comparando, setComparando] = useState(false);

  // Salvar: atualiza o perfil (a partir do 1º lote) e grava a safra inteira.
  const salvarSimulacao = () => {
    const principal = lotes[0];
    const novo = atualizarPerfil({
      culturaPrincipal: principal.cultura,
      sacas: principal.sacas,
      meses: principal.meses,
      custos: { ...principal.custos },
    });
    setPerfil(novo);
    setSimulacoes(
      salvarSimulacaoHistorico({
        lotes: lotes.map((l, i) => ({
          cultura: l.cultura,
          sacas: l.sacas,
          meses: l.meses,
          precoHoje: l.precoHoje,
          precoEsperado: l.precoEsperado,
          custos: { ...l.custos },
          resultado: {
            veredito: resultados[i].veredito,
            vantagemPorSaca: resultados[i].vantagemPorSaca,
            vantagemTotal: resultados[i].vantagemTotal,
            precoEmpate: resultados[i].precoEmpate,
          },
        })),
        consolidado,
      }),
    );
    setSimSalva(true);
    setTimeout(() => setSimSalva(false), 2500);
  };

  // Reabre uma simulação salva: todos os lotes voltam como estavam,
  // e a tela vai para a Operação (é lá que se mexe nos lotes).
  const abrirSimulacao = (s) => {
    setLotes(s.lotes.map((l) => criarLote({ ...l, precoEditado: true })));
    setFrases({});
    setAbaAtiva("operacao");
  };

  // Salvar na aba Conta: atualiza o perfil SEM resetar os lotes em edição
  // (os novos custos valem como sugestão para os próximos lotes).
  const salvarConta = (dados) => {
    setPerfil(atualizarPerfil(dados));
    setContaSalva(true);
    setTimeout(() => setContaSalva(false), 2500);
  };

  // ── Alertas da Home, derivados do estado real ─────────────────
  const alertas = useMemo(() => {
    const a = [];
    if (statusCot === "erro") {
      a.push("Cotação automática indisponível — os preços na tela podem estar defasados.");
    }
    if (perfil?.capacidadeSacas > 0 && consolidado.totalSacas > perfil.capacidadeSacas) {
      a.push(
        `Sua safra (${fmtBRL(consolidado.totalSacas)} sacas) passa da capacidade de armazenagem (${fmtBRL(perfil.capacidadeSacas)}) — o excedente precisaria de armazém de terceiro.`,
      );
    }
    resultados.forEach((r, i) => {
      if (r.zonaCinzenta) {
        a.push(`Lote ${i + 1} está na zona de empate (menos de R$ 2/saca de diferença) — qualquer variação de preço muda a conta.`);
      }
    });
    return a;
  }, [statusCot, perfil, consolidado, resultados]);

  // ── Entrada conversacional (texto, voz, foto) ─────────────────
  // A frase/foto vira parâmetros extraídos; o produtor CONFIRMA o que
  // foi entendido antes de qualquer coisa mudar na simulação.
  const [fraseConversa, setFraseConversa] = useState("");
  const [interpretando, setInterpretando] = useState(false);
  const [entendimento, setEntendimento] = useState(null); // {campos, resumo, fonte, aviso}
  const [erroConversa, setErroConversa] = useState(null);
  const [gravando, setGravando] = useState(false);
  const [vozOk] = useState(() => vozSuportada());
  const [alvo, setAlvo] = useState("novo"); // id do lote destino ou "novo"
  const reconhecimentoRef = useRef(null);
  const fotoInputRef = useRef(null);

  const enviarFrase = async () => {
    const texto = fraseConversa.trim();
    if (!texto) return;
    setErroConversa(null);
    setEntendimento(null);
    setInterpretando(true);
    try {
      const r = await interpretarTexto(texto);
      if (!Object.keys(r.campos).length) {
        setErroConversa(
          'Não achei números nem cultura nessa frase — tente algo como "colhi 12 mil sacas de soja, devendo 1,2 ao mês no banco".',
        );
      } else {
        setEntendimento(r);
      }
    } finally {
      setInterpretando(false);
    }
  };

  const enviarFoto = async (e) => {
    const arquivo = e.target.files?.[0];
    e.target.value = ""; // permite escolher o mesmo arquivo de novo
    if (!arquivo) return;
    setErroConversa(null);
    setEntendimento(null);
    setInterpretando(true);
    try {
      const r = await interpretarImagem(arquivo);
      if (!Object.keys(r.campos).length) {
        setErroConversa("Não consegui ler dados úteis nesse documento — tente uma foto mais nítida.");
      } else {
        setEntendimento(r);
      }
    } catch (err) {
      setErroConversa(String(err.message || err));
    } finally {
      setInterpretando(false);
    }
  };

  const alternarVoz = () => {
    if (gravando) {
      reconhecimentoRef.current?.stop();
      return;
    }
    const rec = criarReconhecimentoVoz(setFraseConversa, () => setGravando(false));
    if (!rec) return;
    reconhecimentoRef.current = rec;
    setGravando(true);
    rec.start();
  };

  // Aplica os parâmetros confirmados — num lote existente ou num novo.
  const aplicarEntendimento = () => {
    const c = entendimento.campos;
    const custos = {};
    if (c.custoArmz != null) custos.armazenagem = c.custoArmz;
    if (c.jurosMes != null) custos.jurosMes = c.jurosMes;
    if (c.perdaMes != null) custos.perdaMes = c.perdaMes;

    if (alvo === "novo") {
      const base = lotes[lotes.length - 1];
      const cultura = c.cultura && CULTURAS[c.cultura] ? c.cultura : base.cultura;
      const cot = cotacoes?.[cultura];
      const novo = criarLote({
        cultura,
        sacas: c.sacas ?? base.sacas,
        meses: c.meses ?? base.meses,
        precoHoje: c.precoHoje ?? cot?.preco ?? CULTURAS[cultura].precoHoje,
        precoEsperado: c.precoEsperado ?? CULTURAS[cultura].precoEsperado,
        custos: { ...base.custos, ...custos },
        precoEditado: c.precoHoje != null,
      });
      setLotes((ls) => [...ls, novo]);
      setAlvo(novo.id);
    } else {
      const atual = lotes.find((l) => l.id === alvo);
      if (!atual) return;
      const trocouCultura = c.cultura && CULTURAS[c.cultura] && c.cultura !== atual.cultura;
      const cultura = trocouCultura ? c.cultura : atual.cultura;
      const campos = { cultura };
      if (c.sacas != null) campos.sacas = c.sacas;
      if (c.meses != null) campos.meses = c.meses;
      if (Object.keys(custos).length) campos.custos = custos;

      if (c.precoHoje != null) {
        campos.precoHoje = c.precoHoje;
        campos.precoEditado = true; // veio do produtor: cotação não sobrescreve
      } else if (trocouCultura) {
        campos.precoHoje = cotacoes?.[cultura]?.preco ?? CULTURAS[cultura].precoHoje;
        campos.precoEditado = false;
      }
      if (c.precoEsperado != null) campos.precoEsperado = c.precoEsperado;
      else if (trocouCultura) campos.precoEsperado = CULTURAS[cultura].precoEsperado;

      mudarLote(alvo, campos);
    }
    setEntendimento(null);
    setFraseConversa("");
  };

  const nomeLote = (l, i) => `Lote ${i + 1} · ${CULTURAS[l.cultura]?.nome || l.cultura}`;

  return (
    <div style={st.pagina}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&family=IBM+Plex+Mono:wght@400;600&display=swap');
        * { box-sizing: border-box; }
        input:focus, button:focus-visible, select:focus, textarea:focus { outline: 2px solid #C99B2F; outline-offset: 2px; }
        input[type=range] { accent-color: #C99B2F; }
        details > summary { cursor: pointer; list-style: none; }
        details > summary::-webkit-details-marker { display: none; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
      `}</style>

      {/* Cabeçalho */}
      <header style={st.topo}>
        <div style={st.marca}>
          GRÃO<span style={{ color: "#C99B2F" }}>CERTO</span>
        </div>
        <div style={st.marcaSub}>decisão de comercialização · protótipo fase 1</div>
      </header>

      {!perfil ? (
        <main style={st.gradeUnica}>
          <FormPerfil inicial={null} onSalvar={salvarPerfilDoForm} onCancelar={null} />
        </main>
      ) : (
        <>
          {/* ══ ABA HOME — visão do dia ══════════════════════════ */}
          {abaAtiva === "home" && (
            <main style={st.gradeUnica}>
              <div style={st.homeStats}>
                <div style={st.homeCard}>
                  <span style={st.consolidadoRotulo}>Sacas na simulação</span>
                  <span style={st.homeNum}>{fmtBRL(consolidado.totalSacas)}</span>
                  <span style={st.consolidadoSub}>
                    {lotes.length} {lotes.length === 1 ? "lote" : "lotes"} ·{" "}
                    {consolidado.culturas.map((c) => CULTURAS[c]?.nome || c).join(" + ")}
                  </span>
                </div>
                <div style={st.homeCard}>
                  <span style={st.consolidadoRotulo}>Valor hoje</span>
                  <span style={st.homeNum}>R$ {fmtBRL(consolidado.receitaAgora)}</span>
                  <span style={st.consolidadoSub}>vendendo tudo ao preço de hoje</span>
                </div>
                <div style={st.homeCard}>
                  <span style={st.consolidadoRotulo}>Cotação do dia</span>
                  {cotacoes ? (
                    <>
                      {["soja", "milho"].map((c) =>
                        cotacoes[c] ? (
                          <span key={c} style={st.homeCotLinha}>
                            {CULTURAS[c].nome}: R$ {fmtBRL(cotacoes[c].preco, 2)}
                          </span>
                        ) : null,
                      )}
                      <span style={st.consolidadoSub}>
                        {cotacoes.soja?.referencia || cotacoes.milho?.referencia
                          ? "referência"
                          : "CEPEA/ESALQ"}
                        {" · "}
                        {fmtData(cotacoes.soja?.data || cotacoes.milho?.data)}
                      </span>
                    </>
                  ) : (
                    <span style={st.consolidadoSub}>
                      {statusCot === "erro" ? "indisponível agora" : "carregando…"}
                    </span>
                  )}
                </div>
              </div>

              {/* Recomendação principal do dia */}
              <div
                style={{
                  ...st.ticket,
                  borderColor: consolidado.armazenar ? "#3E6B4F" : "#A4432E",
                }}
              >
                <div style={st.ticketFuro} aria-hidden="true" />
                <div style={st.ticketEyebrow}>RECOMENDAÇÃO DO DIA · SAFRA INTEIRA</div>
                <div
                  style={{
                    ...st.ticketVeredito,
                    color: consolidado.armazenar ? "#3E6B4F" : "#A4432E",
                  }}
                >
                  {consolidado.armazenar ? "ARMAZENAR" : "VENDER AGORA"}
                </div>
                {consolidado.zonaCinzenta && (
                  <div style={st.ticketAviso}>
                    Diferença menor que R$ 2/saca — zona de empate. Vale olhar lote a lote na
                    Operação.
                  </div>
                )}
                <div style={st.ticketDelta}>
                  <span style={st.ticketDeltaNum}>
                    {consolidado.vantagemPorSaca >= 0 ? "+" : "−"} R${" "}
                    {fmtBRL(Math.abs(consolidado.vantagemPorSaca), 2)}
                  </span>
                  <span style={st.ticketDeltaRotulo}>
                    por saca {consolidado.armazenar ? "segurando" : "vendendo já"}
                  </span>
                </div>
                <div style={st.ticketTotal}>
                  {consolidado.vantagemTotal >= 0 ? "+" : "−"} R${" "}
                  {fmtBRL(Math.abs(consolidado.vantagemTotal))} no total · segurar custa R${" "}
                  {fmtBRL(consolidado.custoTotalSegurar)}
                </div>
                <div style={st.ticketRodape}>
                  <button
                    type="button"
                    style={st.recomendacaoBtn}
                    onClick={() => setAbaAtiva("operacao")}
                  >
                    Abrir a operação →
                  </button>
                </div>
              </div>

              {/* Alertas */}
              <div style={st.painel}>
                <h2 style={st.tituloSecao}>Alertas</h2>
                {alertas.length === 0 ? (
                  <p style={st.semAlerta}>Nenhum alerta por agora.</p>
                ) : (
                  alertas.map((a, i) => (
                    <div key={i} style={st.alertaItem}>
                      <span style={st.alertaPonto} aria-hidden="true">
                        !
                      </span>
                      <span>{a}</span>
                    </div>
                  ))
                )}
              </div>
            </main>
          )}

          {/* ══ ABA OPERAÇÃO — lotes e simulação ═════════════════ */}
          {abaAtiva === "operacao" && (
          <>
          <section style={st.conversaPainel}>
            <h2 style={st.tituloSecao}>Fale com o GrãoCerto</h2>
            <p style={st.formIntro}>
              Conte como está sua safra — por texto, voz ou foto de romaneio de balança / nota
              fiscal — que eu preencho a simulação. Ex.: “colhi 12 mil sacas de soja, tô devendo
              no banco a 1,2 ao mês”.
            </p>
            <textarea
              value={fraseConversa}
              onChange={(e) => setFraseConversa(e.target.value)}
              rows={2}
              style={st.conversaInput}
              placeholder={gravando ? "Ouvindo… pode falar" : "Escreva aqui ou use o microfone…"}
              disabled={interpretando}
            />
            <div style={st.conversaAcoes}>
              <button
                type="button"
                style={st.btnPrimario}
                onClick={enviarFrase}
                disabled={interpretando || !fraseConversa.trim()}
              >
                {interpretando ? "Interpretando…" : "Interpretar"}
              </button>
              {vozOk && (
                <button
                  type="button"
                  style={{ ...st.btnSecundario, ...(gravando ? st.btnGravando : {}) }}
                  onClick={alternarVoz}
                  disabled={interpretando}
                >
                  {gravando ? "■ Parar" : "🎤 Falar"}
                </button>
              )}
              <button
                type="button"
                style={st.btnSecundario}
                onClick={() => fotoInputRef.current?.click()}
                disabled={interpretando}
              >
                📷 Foto de romaneio/NF
              </button>
              <input
                ref={fotoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: "none" }}
                onChange={enviarFoto}
              />
            </div>

            <label style={st.alvoLinha}>
              <span style={st.alvoRotulo}>Aplicar em</span>
              <select value={alvo} onChange={(e) => setAlvo(e.target.value)} style={st.alvoSelect}>
                <option value="novo">＋ Novo lote</option>
                {lotes.map((l, i) => (
                  <option key={l.id} value={l.id}>
                    {nomeLote(l, i)}
                  </option>
                ))}
              </select>
            </label>

            {erroConversa && <div style={st.conversaErro}>{erroConversa}</div>}

            {entendimento && (
              <div style={st.entendimento}>
                <div style={st.entendimentoTitulo}>
                  Foi isso que eu entendi
                  {entendimento.fonte === "documento"
                    ? " do documento"
                    : entendimento.fonte === "regras"
                      ? " (por regras, sem IA)"
                      : ""}
                  :
                </div>
                {entendimento.resumo && (
                  <p style={st.entendimentoResumo}>“{entendimento.resumo}”</p>
                )}
                <ul style={st.entendimentoLista}>
                  {Object.entries(entendimento.campos).map(([k, v]) =>
                    ROTULOS_CAMPOS[k] ? (
                      <li key={k} style={st.entendimentoItem}>
                        <span>{ROTULOS_CAMPOS[k][0]}</span>
                        <strong style={st.entendimentoValor}>{ROTULOS_CAMPOS[k][1](v)}</strong>
                      </li>
                    ) : null,
                  )}
                </ul>
                <p style={st.entendimentoNota}>
                  Vai ser aplicado em{" "}
                  <strong>
                    {alvo === "novo"
                      ? "um lote novo"
                      : nomeLote(
                          lotes.find((l) => l.id === alvo) || lotes[0],
                          lotes.findIndex((l) => l.id === alvo),
                        )}
                  </strong>
                  . O que não foi dito continua como está.
                </p>
                {entendimento.aviso && <p style={st.entendimentoAviso}>{entendimento.aviso}</p>}
                <div style={st.formAcoes}>
                  <button type="button" style={st.btnPrimario} onClick={aplicarEntendimento}>
                    Confirmar e simular
                  </button>
                  <button type="button" style={st.btnSecundario} onClick={() => setEntendimento(null)}>
                    Descartar
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Visão da safra inteira — só faz sentido com mais de um lote */}
          {lotes.length > 1 && (
            <section style={st.consolidadoPainel}>
              <div style={st.simsCabecalho}>
                <h2 style={{ ...st.tituloSecao, margin: 0 }}>
                  Safra inteira · {consolidado.nLotes} lotes
                </h2>
                <span style={st.consolidadoSacas}>
                  {fmtBRL(consolidado.totalSacas)} sacas ·{" "}
                  {consolidado.culturas.map((c) => CULTURAS[c]?.nome || c).join(" + ")}
                </span>
              </div>
              <div style={st.consolidadoGrade}>
                <div>
                  <span style={st.consolidadoRotulo}>Resultado somado</span>
                  <span
                    style={{
                      ...st.consolidadoVeredito,
                      color: consolidado.armazenar ? "#3E6B4F" : "#A4432E",
                    }}
                  >
                    {consolidado.armazenar ? "ARMAZENAR" : "VENDER AGORA"}
                  </span>
                </div>
                <div>
                  <span style={st.consolidadoRotulo}>Vantagem</span>
                  <span style={st.consolidadoNum}>
                    {consolidado.vantagemTotal >= 0 ? "+" : "−"} R${" "}
                    {fmtBRL(Math.abs(consolidado.vantagemTotal))}
                  </span>
                  <span style={st.consolidadoSub}>
                    {consolidado.vantagemPorSaca >= 0 ? "+" : "−"} R${" "}
                    {fmtBRL(Math.abs(consolidado.vantagemPorSaca), 2)}/saca
                  </span>
                </div>
                <div>
                  <span style={st.consolidadoRotulo}>Custo de segurar tudo</span>
                  <span style={st.consolidadoNum}>R$ {fmtBRL(consolidado.custoTotalSegurar)}</span>
                  <span style={st.consolidadoSub}>armazenagem + dinheiro parado</span>
                </div>
              </div>
              {consolidado.zonaCinzenta && (
                <div style={st.ticketAviso}>
                  Somando tudo, a diferença é menor que R$ 2/saca — zona de empate. Vale olhar lote
                  a lote: pode compensar vender uns e segurar outros.
                </div>
              )}
            </section>
          )}

          {/* Um cartão por lote: entradas + veredito + recomendação */}
          {lotes.map((lote, i) => (
            <CartaoLote
              key={lote.id}
              lote={lote}
              indice={i}
              resultado={resultados[i]}
              cotacao={cotacoes?.[lote.cultura] || null}
              statusCot={statusCot}
              perfil={perfil}
              podeExcluir={lotes.length > 1}
              frase={frases[lote.id]}
              gerando={gerando === lote.id}
              onMudar={(campos) => mudarLote(lote.id, campos)}
              onTrocarCultura={(c) => trocarCultura(lote.id, c)}
              onAtualizarCotacao={() => reaplicarCotacao(lote.id)}
              onExcluir={() => excluirLote(lote.id)}
              onRecomendar={() => pedirRecomendacao(lote, resultados[i])}
            />
          ))}

          <div style={st.acoesSafra}>
            <button type="button" style={st.btnSecundario} onClick={adicionarLote}>
              ＋ Adicionar lote
            </button>
            <button type="button" style={st.btnSalvarSim} onClick={salvarSimulacao}>
              Salvar simulação
            </button>
            {simSalva && <span style={st.salvoFeedback}>✓ salva — seu perfil foi atualizado</span>}
          </div>
          </>
          )}

          {/* ══ ABA INTELIGÊNCIA — histórico e mercado ═══════════ */}
          {abaAtiva === "inteligencia" && (
          <>
          <section style={st.historicoPainel}>
            <h2 style={st.tituloSecao}>Preço futuro</h2>
            <div style={st.grafPlaceholder}>
              <svg viewBox="0 0 320 120" style={{ width: "100%", height: "auto" }} aria-hidden="true">
                <line x1="0" y1="110" x2="320" y2="110" stroke="#D8DED2" strokeWidth="1" />
                <polyline
                  points="0,90 40,84 80,88 120,70 160,74 200,58 240,62 280,48 320,52"
                  fill="none"
                  stroke="#C99B2F"
                  strokeWidth="3"
                  strokeDasharray="6 5"
                />
                <circle cx="0" cy="90" r="4" fill="#3E6B4F" />
              </svg>
              <p style={st.grafTexto}>
                Curva de futuros B3 por vencimento — em breve, para sugerir o preço esperado em
                vez do seu palpite. Por enquanto, o preço esperado é o controle deslizante de
                cada lote na Operação.
              </p>
            </div>
          </section>

          {/* Histórico: revisitar e comparar as últimas simulações */}
          {simulacoes.length === 0 && (
            <section style={st.historicoPainel}>
              <h2 style={st.tituloSecao}>Simulações salvas</h2>
              <p style={st.semAlerta}>
                Nenhuma ainda — salve uma simulação na Operação para revisitar e comparar aqui.
              </p>
            </section>
          )}
          {simulacoes.length > 0 && (
            <section style={st.historicoPainel}>
              <div style={st.simsCabecalho}>
                <h2 style={{ ...st.tituloSecao, margin: 0 }}>
                  Simulações salvas ({simulacoes.length}/{MAX_SIMULACOES})
                </h2>
                {simulacoes.length > 1 && (
                  <button
                    type="button"
                    style={st.perfilBarBtn}
                    onClick={() => setComparando(!comparando)}
                  >
                    {comparando ? "Fechar comparação" : "Comparar"}
                  </button>
                )}
              </div>

              {!comparando &&
                simulacoes.map((s) => (
                  <div key={s.id} style={st.simLinha}>
                    <div style={st.simInfo}>
                      <span style={st.simData}>{fmtDataHora(s.criadaEm)}</span>
                      <span style={st.simDesc}>
                        {s.consolidado.nLotes}{" "}
                        {s.consolidado.nLotes === 1 ? "lote" : "lotes"} ·{" "}
                        {fmtBRL(s.consolidado.totalSacas)} sc ·{" "}
                        {(s.consolidado.culturas || [])
                          .map((c) => CULTURAS[c]?.nome || c)
                          .join(" + ")}
                      </span>
                      <span
                        style={{
                          ...st.simVeredito,
                          color: s.consolidado.veredito === "armazenar" ? "#3E6B4F" : "#A4432E",
                        }}
                      >
                        {s.consolidado.veredito === "armazenar" ? "ARMAZENAR" : "VENDER"} ·{" "}
                        {s.consolidado.vantagemPorSaca >= 0 ? "+" : "−"} R${" "}
                        {fmtBRL(Math.abs(s.consolidado.vantagemPorSaca), 2)}/sc
                      </span>
                    </div>
                    <div style={st.simAcoes}>
                      <button type="button" style={st.simBtn} onClick={() => abrirSimulacao(s)}>
                        Abrir
                      </button>
                      <button
                        type="button"
                        style={st.simBtnExcluir}
                        onClick={() => setSimulacoes(excluirSimulacao(s.id))}
                        aria-label="Excluir simulação"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}

              {comparando && (
                <div style={st.compScroll}>
                  <table style={st.compTabela}>
                    <thead>
                      <tr>
                        <th style={st.compRotulo}></th>
                        {simulacoes.map((s) => (
                          <th key={s.id} style={st.compTh}>
                            {fmtDataHora(s.criadaEm)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {LINHAS_COMPARACAO.map(([rotulo, valorDe]) => (
                        <tr key={rotulo}>
                          <td style={st.compRotulo}>{rotulo}</td>
                          {simulacoes.map((s) => (
                            <td key={s.id} style={st.compValor}>
                              {valorDe(s)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
          </>
          )}

          {/* ══ ABA CONTA — perfil e custos ══════════════════════ */}
          {abaAtiva === "conta" && (
            <main style={st.gradeUnica}>
              <FormPerfil inicial={perfil} onSalvar={salvarConta} onCancelar={null} />
              {contaSalva && (
                <p style={st.contaFeedback}>
                  ✓ perfil salvo — os novos custos valem como sugestão para os próximos lotes
                </p>
              )}
            </main>
          )}

          <p style={st.aviso}>
            Protótipo para validação. O preço pode ser informado manualmente ou puxado da
            cotação de referência — a versão de produção usará cotações CEPEA/B3 e clima em
            tempo real. As orientações explicam a conta de custo do próprio app; não são
            recomendação de investimento. Indicadores: CEPEA/ESALQ (CC BY-NC 4.0).
          </p>

          <TabBar ativa={abaAtiva} onTrocar={setAbaAtiva} />
        </>
      )}
    </div>
  );
}

// ── Barra de abas do dashboard (fixa no rodapé, mobile-first) ──
function TabBar({ ativa, onTrocar }) {
  const ABAS = [
    ["home", "🏠", "Home"],
    ["operacao", "🌾", "Operação"],
    ["inteligencia", "📈", "Inteligência"],
    ["conta", "👤", "Conta"],
  ];
  return (
    <nav style={st.tabBar} aria-label="Navegação principal">
      {ABAS.map(([id, icone, rotulo]) => (
        <button
          key={id}
          type="button"
          onClick={() => onTrocar(id)}
          style={{ ...st.tabItem, ...(ativa === id ? st.tabItemAtivo : {}) }}
          aria-current={ativa === id ? "page" : undefined}
        >
          <span style={st.tabIcone} aria-hidden="true">
            {icone}
          </span>
          {rotulo}
        </button>
      ))}
    </nav>
  );
}

// ── Cartão de um lote: entradas à esquerda, decisão à direita ──
function CartaoLote({
  lote,
  indice,
  resultado,
  cotacao,
  statusCot,
  perfil,
  podeExcluir,
  frase,
  gerando,
  onMudar,
  onTrocarCultura,
  onAtualizarCotacao,
  onExcluir,
  onRecomendar,
}) {
  const margem = Math.abs(resultado.vantagemPorSaca);
  const fraseAtual = frase && frase.assinatura === assinaturaLote(lote);

  return (
    <section style={st.loteBloco}>
      <div style={st.loteCabecalho}>
        <span style={st.loteTitulo}>
          Lote {indice + 1} · {CULTURAS[lote.cultura]?.nome || lote.cultura} ·{" "}
          {fmtBRL(lote.sacas)} sacas
        </span>
        {podeExcluir && (
          <button
            type="button"
            style={st.simBtnExcluir}
            onClick={onExcluir}
            aria-label={`Excluir lote ${indice + 1}`}
          >
            × Excluir lote
          </button>
        )}
      </div>

      <div style={st.grade}>
        {/* Coluna de entrada */}
        <div style={st.painel}>
          <h2 style={st.tituloSecao}>Este lote</h2>

          <div style={st.abas} role="tablist" aria-label="Cultura">
            {Object.entries(CULTURAS).map(([k, c]) => (
              <button
                key={k}
                role="tab"
                aria-selected={lote.cultura === k}
                onClick={() => onTrocarCultura(k)}
                style={{ ...st.aba, ...(lote.cultura === k ? st.abaAtiva : {}) }}
              >
                {c.nome}
              </button>
            ))}
          </div>

          <Campo
            rotulo="Quantidade"
            sufixo="sacas"
            valor={lote.sacas}
            onChange={(v) => onMudar({ sacas: v })}
            passo={500}
          />
          {perfil?.capacidadeSacas > 0 && lote.sacas > perfil.capacidadeSacas && (
            <div style={st.capacidadeAviso}>
              Acima da sua capacidade de armazenagem ({fmtBRL(perfil.capacidadeSacas)} sacas) —
              o excedente precisaria de armazém de terceiro.
            </div>
          )}
          <Campo
            rotulo="Preço hoje na sua região"
            sufixo="R$/saca"
            valor={lote.precoHoje}
            onChange={(v) => onMudar({ precoHoje: v, precoEditado: true })}
            passo={0.5}
            ajuda="Preço balcão que você conseguiria vendendo esta semana"
          />

          <div style={st.cotacao}>
            {statusCot === "carregando" && <span style={st.cotacaoInfo}>Buscando cotação…</span>}
            {statusCot === "ok" && cotacao && (
              <span style={st.cotacaoInfo}>
                <span style={st.cotacaoPonto} aria-hidden="true" />
                {cotacao.praca || "Indicador"}: R$ {fmtBRL(cotacao.preco, 2)}
                {cotacao.data ? ` · ${fmtData(cotacao.data)}` : ""}
                {cotacao.referencia ? " · referência" : ""}
                {lote.precoEditado ? " · ajustado por você" : ""}
              </span>
            )}
            {statusCot === "ok" && !cotacao && (
              <span style={st.cotacaoInfo}>
                Sem cotação automática para {CULTURAS[lote.cultura].nome} — informe manualmente.
              </span>
            )}
            {statusCot === "erro" && (
              <span style={st.cotacaoErro}>
                Cotação automática indisponível — informe o preço manualmente.
              </span>
            )}
            <button
              type="button"
              onClick={onAtualizarCotacao}
              disabled={statusCot === "carregando"}
              style={st.cotacaoBtn}
            >
              {statusCot === "carregando" ? "…" : "Atualizar"}
            </button>
          </div>

          <Campo
            rotulo="Quanto tempo pretende segurar"
            sufixo="meses"
            valor={lote.meses}
            onChange={(v) => onMudar({ meses: v })}
            passo={1}
            min={1}
          />

          <h2 style={{ ...st.tituloSecao, marginTop: 28 }}>Custos de segurar este lote</h2>
          <Campo
            rotulo="Armazenagem"
            sufixo="R$/saca/mês"
            valor={lote.custos.armazenagem}
            onChange={(v) => onMudar({ custos: { armazenagem: v } })}
            passo={0.1}
            ajuda="Silo próprio: energia + manutenção. Terceiro: tarifa cobrada"
          />
          <Campo
            rotulo="Custo do dinheiro"
            sufixo="% a.m."
            valor={lote.custos.jurosMes}
            onChange={(v) => onMudar({ custos: { jurosMes: v } })}
            passo={0.1}
            ajuda="Juros da sua dívida — ou quanto o dinheiro renderia aplicado"
          />
          <Campo
            rotulo="Perda técnica estimada"
            sufixo="% ao mês"
            valor={lote.custos.perdaMes}
            onChange={(v) => onMudar({ custos: { perdaMes: v } })}
            passo={0.05}
            ajuda="Quebra de peso, pragas e deterioração no armazém"
          />
        </div>

        {/* Coluna de resultado */}
        <div>
          <div
            style={{ ...st.ticket, borderColor: resultado.armazenar ? "#3E6B4F" : "#A4432E" }}
          >
            <div style={st.ticketFuro} aria-hidden="true" />
            <div style={st.ticketEyebrow}>ROMANEIO DE DECISÃO</div>
            <div
              style={{
                ...st.ticketVeredito,
                color: resultado.armazenar ? "#3E6B4F" : "#A4432E",
              }}
            >
              {resultado.armazenar ? "ARMAZENAR" : "VENDER AGORA"}
            </div>

            {/* Orientação em linguagem de produtor — logo abaixo do veredito */}
            <div style={st.recomendacao}>
              {fraseAtual ? (
                <>
                  <p style={st.recomendacaoTexto}>{frase.texto}</p>
                  <div style={st.recomendacaoRodape}>
                    <span style={st.recomendacaoFonte}>
                      {frase.fonte === "ia" ? "Orientação do GrãoCerto" : "Orientação (sem IA)"}
                    </span>
                    <button
                      type="button"
                      style={st.recomendacaoBtn}
                      onClick={onRecomendar}
                      disabled={gerando}
                    >
                      {gerando ? "…" : "Refazer"}
                    </button>
                  </div>
                  {frase.aviso && <span style={st.recomendacaoAviso}>{frase.aviso}</span>}
                </>
              ) : (
                <div style={st.recomendacaoVazia}>
                  <span style={st.recomendacaoConvite}>
                    {frase
                      ? "Os números mudaram desde a última orientação."
                      : "Quer isso explicado em uma frase?"}
                  </span>
                  <button
                    type="button"
                    style={st.recomendacaoBtn}
                    onClick={onRecomendar}
                    disabled={gerando}
                  >
                    {gerando ? "Pensando…" : frase ? "Atualizar orientação" : "Explicar decisão"}
                  </button>
                </div>
              )}
            </div>

            {resultado.zonaCinzenta && (
              <div style={st.ticketAviso}>
                Diferença menor que R$ 2/saca — zona de empate. Qualquer variação de preço muda a conta.
              </div>
            )}
            <div style={st.ticketDelta}>
              <span style={st.ticketDeltaNum}>
                {resultado.vantagemPorSaca >= 0 ? "+" : "−"} R$ {fmtBRL(margem, 2)}
              </span>
              <span style={st.ticketDeltaRotulo}>
                por saca {resultado.armazenar ? "segurando" : "vendendo já"}
              </span>
            </div>
            <div style={st.ticketTotal}>
              {resultado.vantagemTotal >= 0 ? "+" : "−"} R${" "}
              {fmtBRL(Math.abs(resultado.vantagemTotal))} no total
            </div>
            <div style={st.ticketRodape}>
              {CULTURAS[lote.cultura].nome} · {fmtBRL(lote.sacas)} sacas · horizonte{" "}
              {plMeses(lote.meses)}
            </div>
          </div>

          {/* Simulador de preço esperado */}
          <div style={st.painel}>
            <h2 style={st.tituloSecao}>E se o preço na entressafra for…</h2>
            <div style={st.sliderLinha}>
              <span style={st.sliderNum}>R$ {fmtBRL(lote.precoEsperado, 2)}</span>
              <span style={st.sliderRotulo}>/saca esperado em {plMeses(lote.meses)}</span>
            </div>
            <input
              type="range"
              min={Math.max(1, lote.precoHoje * 0.8)}
              max={lote.precoHoje * 1.35}
              step={0.5}
              value={lote.precoEsperado}
              onChange={(e) => onMudar({ precoEsperado: parseFloat(e.target.value) })}
              style={{ width: "100%" }}
              aria-label="Preço esperado por saca"
            />
            <div style={st.empate}>
              <span style={st.empateRotulo}>Preço de empate</span>
              <span style={st.empateNum}>R$ {fmtBRL(resultado.precoEmpate, 2)}/saca</span>
              <span style={st.empateExpl}>
                Acima disso, segurar compensa. Abaixo, vender agora ganha.
              </span>
            </div>
          </div>

          {/* Composição da conta — recolhida por padrão para não poluir com vários lotes */}
          <details style={st.painel}>
            <summary style={st.contaSummary}>
              <span style={{ ...st.tituloSecao, margin: 0 }}>A conta, aberta</span>
              <span style={st.contaSummaryDica}>ver detalhes</span>
            </summary>
            <div style={{ marginTop: 12 }}>
              <Linha rotulo="Vendendo hoje" valor={resultado.receitaAgora} forte />
              <Linha
                rotulo={`Vendendo em ${plMeses(lote.meses)} (líquido)`}
                valor={resultado.receitaFuturaLiquida}
                forte
              />
              <div style={st.divisor} />
              <Linha rotulo="Custo de armazenagem" valor={-resultado.custoArmazenagem} />
              <Linha rotulo="Custo do dinheiro parado" valor={-resultado.custoCapital} />
              <Linha
                rotulo={`Perda técnica (${(resultado.perdaTotal * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% ≈ ${fmtBRL(resultado.perdaSacas)} sacas)`}
                valor={-resultado.perdaSacas * lote.precoEsperado}
              />
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}

function Linha({ rotulo, valor, forte }) {
  return (
    <div style={st.linha}>
      <span style={{ ...st.linhaRotulo, fontWeight: forte ? 600 : 400 }}>{rotulo}</span>
      <span
        style={{
          ...st.linhaValor,
          fontWeight: forte ? 600 : 400,
          color: valor < 0 ? "#A4432E" : "#1E2A22",
        }}
      >
        {valor < 0 ? "− " : ""}R$ {fmtBRL(Math.abs(valor))}
      </span>
    </div>
  );
}

// Formulário do perfil do produtor: primeira visita (onboarding) e edição.
// Trocar a região sugere os custos regionais de referência — sempre editáveis.
function FormPerfil({ inicial, onSalvar, onCancelar }) {
  const [regiao, setRegiao] = useState(inicial?.regiao || "MT");
  const [culturaPrincipal, setCulturaPrincipal] = useState(inicial?.culturaPrincipal || "soja");
  const [capacidade, setCapacidade] = useState(inicial?.capacidadeSacas ?? 0);
  const [custos, setCustos] = useState(
    inicial?.custos || defaultsDaRegiao(inicial?.regiao || "MT"),
  );

  const trocarRegiao = (rg) => {
    setRegiao(rg);
    setCustos(defaultsDaRegiao(rg)); // sugere os defaults da região; o produtor ajusta
  };

  const setCusto = (campo) => (v) => setCustos((c) => ({ ...c, [campo]: v }));

  return (
    <section style={{ ...st.painel, maxWidth: 480, margin: "0 auto" }}>
      <h2 style={st.tituloSecao}>
        {inicial ? "Seu perfil" : "Antes da primeira simulação"}
      </h2>
      {!inicial && (
        <p style={st.formIntro}>
          Conta rapidinho como é sua operação. Nas próximas visitas tudo já vem
          preenchido — você só ajusta o que mudou.
        </p>
      )}

      <label style={st.campo}>
        <span style={st.campoRotulo}>Sua região</span>
        <select value={regiao} onChange={(e) => trocarRegiao(e.target.value)} style={st.select}>
          {Object.entries(REGIOES).map(([k, rg]) => (
            <option key={k} value={k}>
              {rg.nome}
            </option>
          ))}
        </select>
        <span style={st.campoAjuda}>Usada para sugerir custos típicos da sua praça</span>
      </label>

      <label style={st.campo}>
        <span style={st.campoRotulo}>Cultura principal</span>
        <select
          value={culturaPrincipal}
          onChange={(e) => setCulturaPrincipal(e.target.value)}
          style={st.select}
        >
          {Object.entries(CULTURAS).map(([k, c]) => (
            <option key={k} value={k}>
              {c.nome}
            </option>
          ))}
        </select>
      </label>

      <Campo
        rotulo="Capacidade de armazenagem"
        sufixo="sacas"
        valor={capacidade}
        onChange={setCapacidade}
        passo={1000}
        ajuda="Silo próprio ou espaço contratado. Deixe 0 se não tiver"
      />

      <h2 style={{ ...st.tituloSecao, marginTop: 24 }}>Seus custos de armazenagem</h2>
      <p style={st.formIntro}>
        Sugeridos para {REGIOES[regiao].nome} — ajuste se o seu número for outro.
      </p>
      <Campo
        rotulo="Armazenagem"
        sufixo="R$/saca/mês"
        valor={custos.armazenagem}
        onChange={setCusto("armazenagem")}
        passo={0.1}
      />
      <Campo
        rotulo="Custo do dinheiro"
        sufixo="% a.m."
        valor={custos.jurosMes}
        onChange={setCusto("jurosMes")}
        passo={0.1}
      />
      <Campo
        rotulo="Perda técnica estimada"
        sufixo="% ao mês"
        valor={custos.perdaMes}
        onChange={setCusto("perdaMes")}
        passo={0.05}
      />

      <div style={st.formAcoes}>
        <button
          type="button"
          style={st.btnPrimario}
          onClick={() =>
            onSalvar({ regiao, culturaPrincipal, capacidadeSacas: capacidade, custos })
          }
        >
          {inicial ? "Salvar perfil" : "Salvar e simular"}
        </button>
        {onCancelar && (
          <button type="button" style={st.btnSecundario} onClick={onCancelar}>
            Cancelar
          </button>
        )}
      </div>
    </section>
  );
}

// ── Estilos ──────────────────────────────────────────────────
const st = {
  pagina: {
    minHeight: "100vh",
    background: "#F2F4EF",
    color: "#1E2A22",
    fontFamily: "'Archivo', system-ui, sans-serif",
    padding: "0 16px 104px", // folga extra p/ a tab bar fixa no rodapé
  },
  tabBar: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    display: "flex",
    background: "#FFFFFF",
    borderTop: "2px solid #1E2A22",
    zIndex: 10,
    paddingBottom: "env(safe-area-inset-bottom)",
  },
  tabItem: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
    padding: "8px 4px 10px",
    border: "none",
    background: "transparent",
    color: "#5A6B5D",
    fontFamily: "'Archivo', sans-serif",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  tabItemAtivo: {
    color: "#1E2A22",
    background: "#F4F0E3",
    boxShadow: "inset 0 3px 0 #C99B2F",
  },
  tabIcone: { fontSize: 18, lineHeight: 1 },
  homeStats: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 12,
    marginBottom: 20,
  },
  homeCard: {
    background: "#FFFFFF",
    border: "1px solid #D8DED2",
    borderRadius: 10,
    padding: "14px 16px",
  },
  homeNum: {
    display: "block",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 24,
    fontWeight: 600,
    margin: "2px 0",
  },
  homeCotLinha: {
    display: "block",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 15,
    fontWeight: 600,
    margin: "2px 0",
  },
  alertaItem: {
    display: "flex",
    gap: 10,
    padding: "8px 0",
    fontSize: 14,
    color: "#3B473D",
    borderBottom: "1px dashed #E4D296",
    alignItems: "baseline",
  },
  alertaPonto: {
    color: "#A4432E",
    fontWeight: 800,
    fontFamily: "'IBM Plex Mono', monospace",
    flexShrink: 0,
  },
  semAlerta: { fontSize: 14, color: "#7A897C", padding: "2px 0 10px", margin: 0 },
  grafPlaceholder: {
    border: "2px dashed #C6CFBF",
    borderRadius: 10,
    padding: "18px 16px 8px",
    textAlign: "center",
    background: "#FDFDFB",
    marginBottom: 8,
  },
  grafTexto: { fontSize: 13, color: "#7A897C", lineHeight: 1.5, margin: "10px 0 8px" },
  contaFeedback: {
    textAlign: "center",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: "#3E6B4F",
    marginTop: 12,
  },
  topo: {
    maxWidth: 980,
    margin: "0 auto",
    padding: "28px 0 20px",
    borderBottom: "2px solid #1E2A22",
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
  },
  marca: {
    fontSize: 26,
    fontWeight: 800,
    letterSpacing: "0.02em",
    fontStretch: "115%",
  },
  marcaSub: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: "#5A6B5D",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  grade: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: 20,
    alignItems: "start",
  },
  painel: {
    background: "#FFFFFF",
    border: "1px solid #D8DED2",
    borderRadius: 10,
    padding: "20px 20px 12px",
    marginBottom: 20,
  },
  tituloSecao: {
    margin: "0 0 14px",
    fontSize: 13,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.09em",
    color: "#5A6B5D",
  },
  abas: { display: "flex", gap: 8, marginBottom: 18 },
  aba: {
    flex: 1,
    padding: "10px 0",
    border: "1px solid #D8DED2",
    borderRadius: 8,
    background: "#F7F8F4",
    fontFamily: "'Archivo', sans-serif",
    fontWeight: 600,
    fontSize: 14,
    color: "#5A6B5D",
    cursor: "pointer",
    transition: "all .15s",
  },
  abaAtiva: {
    background: "#1E2A22",
    color: "#F2F4EF",
    border: "1px solid #1E2A22",
  },
  campo: { display: "block", marginBottom: 16 },
  campoRotulo: { display: "block", fontSize: 14, fontWeight: 600, marginBottom: 6 },
  campoLinha: { display: "flex", alignItems: "center", gap: 8 },
  campoInput: {
    flex: 1,
    minWidth: 0,
    padding: "10px 12px",
    fontSize: 17,
    fontFamily: "'IBM Plex Mono', monospace",
    border: "1px solid #C6CFBF",
    borderRadius: 8,
    background: "#FDFDFB",
    color: "#1E2A22",
  },
  campoSufixo: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: "#5A6B5D",
    whiteSpace: "nowrap",
  },
  campoAjuda: { display: "block", fontSize: 12, color: "#7A897C", marginTop: 4 },
  cotacao: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    margin: "-8px 0 16px",
    flexWrap: "wrap",
  },
  cotacaoInfo: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: "#3E6B4F",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  },
  cotacaoPonto: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "#3E6B4F",
    flexShrink: 0,
  },
  cotacaoErro: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: "#A4432E",
  },
  cotacaoBtn: {
    border: "1px solid #C6CFBF",
    background: "#F7F8F4",
    color: "#3E6B4F",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    fontWeight: 600,
    padding: "4px 10px",
    borderRadius: 6,
    cursor: "pointer",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    whiteSpace: "nowrap",
  },
  gradeUnica: { maxWidth: 980, margin: "24px auto 0" },
  conversaPainel: {
    maxWidth: 980,
    margin: "20px auto 0",
    background: "#FFFFFF",
    border: "1px solid #D8DED2",
    borderRadius: 10,
    padding: "20px 20px 16px",
  },
  conversaInput: {
    width: "100%",
    padding: "10px 12px",
    fontSize: 16,
    fontFamily: "'Archivo', sans-serif",
    border: "1px solid #C6CFBF",
    borderRadius: 8,
    background: "#FDFDFB",
    color: "#1E2A22",
    resize: "vertical",
    boxSizing: "border-box",
  },
  conversaAcoes: { display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" },
  alvoLinha: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
    flexWrap: "wrap",
  },
  alvoRotulo: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: "#5A6B5D",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  alvoSelect: {
    padding: "6px 10px",
    fontSize: 14,
    fontFamily: "'Archivo', sans-serif",
    border: "1px solid #C6CFBF",
    borderRadius: 8,
    background: "#FDFDFB",
    color: "#1E2A22",
  },
  btnGravando: {
    background: "#A4432E",
    color: "#FFFFFF",
    border: "1px solid #A4432E",
  },
  conversaErro: {
    marginTop: 12,
    padding: "8px 12px",
    background: "#FBF3DC",
    border: "1px solid #E4D296",
    borderRadius: 8,
    fontSize: 13,
    color: "#6E5A17",
  },
  entendimento: {
    marginTop: 14,
    padding: "12px 14px",
    background: "#F4F0E3",
    borderLeft: "4px solid #C99B2F",
    borderRadius: "0 8px 8px 0",
  },
  entendimentoTitulo: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: "#8A7A45",
    fontWeight: 700,
  },
  entendimentoResumo: {
    margin: "8px 0 0",
    fontSize: 14,
    fontStyle: "italic",
    color: "#3B473D",
  },
  entendimentoLista: { listStyle: "none", margin: "10px 0", padding: 0, maxWidth: 420 },
  entendimentoItem: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    padding: "5px 0",
    fontSize: 14,
    borderBottom: "1px dashed #E4D296",
  },
  entendimentoValor: { fontFamily: "'IBM Plex Mono', monospace", whiteSpace: "nowrap" },
  entendimentoNota: { margin: "8px 0 0", fontSize: 12, color: "#7A6E45" },
  entendimentoAviso: { margin: "6px 0 0", fontSize: 12, color: "#A4432E" },

  // Lotes
  loteBloco: { maxWidth: 980, margin: "24px auto 0" },
  loteCabecalho: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
    paddingBottom: 8,
    borderBottom: "2px solid #1E2A22",
    flexWrap: "wrap",
  },
  loteTitulo: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 13,
    fontWeight: 600,
    color: "#1E2A22",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  acoesSafra: {
    maxWidth: 980,
    margin: "4px auto 24px",
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },

  // Consolidado da safra
  consolidadoPainel: {
    maxWidth: 980,
    margin: "20px auto 0",
    background: "#FFFDF6",
    border: "2px solid #C99B2F",
    borderRadius: 12,
    padding: "18px 20px 16px",
  },
  consolidadoSacas: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: "#5A6B5D",
  },
  consolidadoGrade: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 16,
  },
  consolidadoRotulo: {
    display: "block",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: "#8A7A45",
    fontWeight: 700,
    marginBottom: 4,
  },
  consolidadoVeredito: {
    display: "block",
    fontSize: 24,
    fontWeight: 800,
    lineHeight: 1.1,
    fontStretch: "110%",
  },
  consolidadoNum: {
    display: "block",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 20,
    fontWeight: 600,
  },
  consolidadoSub: { display: "block", fontSize: 12, color: "#7A6E45", marginTop: 2 },

  // Recomendação (frase logo abaixo do veredito)
  recomendacao: {
    marginTop: 14,
    padding: "12px 14px",
    background: "#F4F0E3",
    borderLeft: "4px solid #C99B2F",
    borderRadius: "0 8px 8px 0",
  },
  recomendacaoTexto: {
    margin: 0,
    fontSize: 15,
    lineHeight: 1.5,
    color: "#3B473D",
    fontWeight: 600,
  },
  recomendacaoRodape: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 8,
    flexWrap: "wrap",
  },
  recomendacaoFonte: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    color: "#8A7A45",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  recomendacaoVazia: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  },
  recomendacaoConvite: { fontSize: 13, color: "#7A6E45" },
  recomendacaoBtn: {
    border: "1px solid #C99B2F",
    background: "#FFFDF6",
    color: "#8A7A45",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    fontWeight: 600,
    padding: "5px 12px",
    borderRadius: 6,
    cursor: "pointer",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    whiteSpace: "nowrap",
  },
  recomendacaoAviso: {
    display: "block",
    marginTop: 6,
    fontSize: 11,
    color: "#A4432E",
  },

  // Histórico
  historicoPainel: {
    maxWidth: 980,
    margin: "0 auto 20px",
    background: "#FFFFFF",
    border: "1px solid #D8DED2",
    borderRadius: 10,
    padding: "20px 20px 12px",
  },
  simsCabecalho: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
    flexWrap: "wrap",
  },
  simLinha: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "9px 0",
    borderBottom: "1px dashed #C6CFBF",
  },
  simInfo: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  simData: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: "#8A947F",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  simDesc: { fontSize: 14, color: "#1E2A22" },
  simVeredito: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 600 },
  simAcoes: { display: "flex", gap: 6, flexShrink: 0 },
  simBtn: {
    border: "1px solid #C6CFBF",
    background: "#F7F8F4",
    color: "#3E6B4F",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    fontWeight: 600,
    padding: "5px 12px",
    borderRadius: 6,
    cursor: "pointer",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  simBtnExcluir: {
    border: "1px solid #C6CFBF",
    background: "#F7F8F4",
    color: "#A4432E",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    fontWeight: 600,
    padding: "5px 10px",
    borderRadius: 6,
    cursor: "pointer",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    whiteSpace: "nowrap",
  },
  compScroll: { overflowX: "auto", marginTop: 4, paddingBottom: 4 },
  compTabela: { borderCollapse: "collapse", fontSize: 13, minWidth: "100%" },
  compTh: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    fontWeight: 600,
    color: "#5A6B5D",
    textAlign: "right",
    padding: "6px 10px",
    borderBottom: "2px solid #1E2A22",
    whiteSpace: "nowrap",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  compRotulo: {
    textAlign: "left",
    color: "#5A6B5D",
    padding: "6px 10px 6px 0",
    whiteSpace: "nowrap",
    borderBottom: "1px dashed #D8DED2",
    fontSize: 13,
  },
  compValor: {
    fontFamily: "'IBM Plex Mono', monospace",
    textAlign: "right",
    padding: "6px 10px",
    whiteSpace: "nowrap",
    borderBottom: "1px dashed #D8DED2",
  },
  perfilBar: {
    maxWidth: 980,
    margin: "12px auto 0",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  },
  perfilBarTexto: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: "#5A6B5D",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  perfilBarBtn: {
    border: "1px solid #C6CFBF",
    background: "#F7F8F4",
    color: "#3E6B4F",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    fontWeight: 600,
    padding: "4px 10px",
    borderRadius: 6,
    cursor: "pointer",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  capacidadeAviso: {
    margin: "-8px 0 16px",
    padding: "8px 12px",
    background: "#FBF3DC",
    border: "1px solid #E4D296",
    borderRadius: 8,
    fontSize: 12,
    color: "#6E5A17",
  },
  btnSalvarSim: {
    border: "none",
    background: "#1E2A22",
    color: "#F2F4EF",
    fontFamily: "'Archivo', sans-serif",
    fontWeight: 700,
    fontSize: 14,
    padding: "10px 18px",
    borderRadius: 8,
    cursor: "pointer",
  },
  salvoFeedback: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: "#3E6B4F",
  },
  formIntro: { margin: "0 0 16px", fontSize: 13, color: "#5A6B5D", lineHeight: 1.5 },
  select: {
    width: "100%",
    padding: "10px 12px",
    fontSize: 16,
    fontFamily: "'Archivo', sans-serif",
    border: "1px solid #C6CFBF",
    borderRadius: 8,
    background: "#FDFDFB",
    color: "#1E2A22",
  },
  formAcoes: { display: "flex", gap: 10, marginTop: 8, marginBottom: 8, flexWrap: "wrap" },
  btnPrimario: {
    border: "none",
    background: "#1E2A22",
    color: "#F2F4EF",
    fontFamily: "'Archivo', sans-serif",
    fontWeight: 700,
    fontSize: 15,
    padding: "12px 22px",
    borderRadius: 8,
    cursor: "pointer",
  },
  btnSecundario: {
    border: "1px solid #C6CFBF",
    background: "#F7F8F4",
    color: "#3B473D",
    fontFamily: "'Archivo', sans-serif",
    fontWeight: 600,
    fontSize: 15,
    padding: "12px 18px",
    borderRadius: 8,
    cursor: "pointer",
  },
  ticket: {
    position: "relative",
    background: "#FFFDF6",
    borderWidth: 2,
    borderStyle: "solid",
    borderRadius: 12,
    padding: "26px 24px 20px",
    marginBottom: 20,
    boxShadow: "0 2px 0 rgba(30,42,34,.12)",
  },
  ticketFuro: {
    position: "absolute",
    top: 16,
    right: 20,
    width: 14,
    height: 14,
    borderRadius: "50%",
    background: "#F2F4EF",
    border: "2px solid #D8DED2",
  },
  ticketEyebrow: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    letterSpacing: "0.14em",
    color: "#8A947F",
    marginBottom: 8,
  },
  ticketVeredito: {
    fontSize: "clamp(34px, 7vw, 52px)",
    fontWeight: 800,
    lineHeight: 1,
    letterSpacing: "-0.01em",
    fontStretch: "110%",
  },
  ticketAviso: {
    marginTop: 10,
    padding: "8px 12px",
    background: "#FBF3DC",
    border: "1px solid #E4D296",
    borderRadius: 8,
    fontSize: 13,
    color: "#6E5A17",
  },
  ticketDelta: { marginTop: 18, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" },
  ticketDeltaNum: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 30,
    fontWeight: 600,
  },
  ticketDeltaRotulo: { fontSize: 14, color: "#5A6B5D" },
  ticketTotal: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 15,
    marginTop: 4,
    color: "#3B473D",
  },
  ticketRodape: {
    marginTop: 16,
    paddingTop: 12,
    borderTop: "1px dashed #C6CFBF",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: "#8A947F",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  sliderLinha: { display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10, flexWrap: "wrap" },
  sliderNum: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 26, fontWeight: 600 },
  sliderRotulo: { fontSize: 13, color: "#5A6B5D" },
  empate: {
    marginTop: 16,
    marginBottom: 8,
    padding: "12px 14px",
    background: "#F4F0E3",
    borderLeft: "4px solid #C99B2F",
    borderRadius: "0 8px 8px 0",
  },
  empateRotulo: {
    display: "block",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: "#8A7A45",
    fontWeight: 700,
  },
  empateNum: {
    display: "block",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 22,
    fontWeight: 600,
    margin: "2px 0",
  },
  empateExpl: { display: "block", fontSize: 12, color: "#7A6E45" },
  contaSummary: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  contaSummaryDica: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: "#8A947F",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  linha: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    padding: "7px 0",
    fontSize: 14,
  },
  linhaRotulo: { color: "#3B473D" },
  linhaValor: { fontFamily: "'IBM Plex Mono', monospace", whiteSpace: "nowrap" },
  divisor: { borderTop: "1px dashed #C6CFBF", margin: "8px 0" },
  aviso: {
    fontSize: 12,
    color: "#7A897C",
    lineHeight: 1.5,
    maxWidth: 980,
    margin: "0 auto",
  },
};
