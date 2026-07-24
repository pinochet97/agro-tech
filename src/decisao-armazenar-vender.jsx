import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { buscarCotacoes } from "./services/cotacoes";
import { REGIOES, defaultsDaRegiao, carregarPerfil, atualizarPerfil, sincronizarPerfil } from "./services/perfil";
import { supabase, supabaseConfigurado } from "./services/supabase";
import {
  conversar,
  interpretarImagem,
  gerarRecomendacao,
  vozSuportada,
  criarReconhecimentoVoz,
} from "./services/conversa";
import {
  listarSimulacoes,
  salvarSimulacaoHistorico,
  excluirSimulacao,
  sincronizarSimulacoes,
  MAX_SIMULACOES,
} from "./services/simulacoes";
import { CULTURAS, criarLote, calcularLote, consolidar, retratoParaIA } from "./services/lotes";
import { buscarFuturos, precoSugerido } from "./services/futuros";
import { listarAlertas, criarAlerta, excluirAlerta } from "./services/alertas";
import {
  listarFechamentos,
  registrarFechamento,
  excluirFechamento,
  sincronizarFechamentos,
  montarFechamento,
  calcularResultadoReal,
  fraseResultado,
  resumoDesempenho,
} from "./services/fechamentos.js";
import { desenharCard, baixarCard, compartilharCard } from "./services/cardResultado";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

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

  // ── Autenticação (Fase 4, opcional) ───────────────────────────
  // Sem Supabase configurado, `usuario` fica null e tudo segue no
  // localStorage. Logado, perfil e simulações sincronizam na nuvem.
  const [usuario, setUsuario] = useState(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setUsuario(data.session?.user ?? null));
    const { data: assinatura } = supabase.auth.onAuthStateChange((_evento, sessao) => {
      setUsuario(sessao?.user ?? null);
    });
    return () => assinatura.subscription.unsubscribe();
  }, []);

  // Ao logar, puxa perfil e simulações da nuvem (nuvem vence; se estiver
  // vazia, os dados locais sobem — ver services/perfil e simulacoes).
  useEffect(() => {
    if (!usuario) return;
    (async () => {
      const p = await sincronizarPerfil();
      if (p) setPerfil(p);
      setSimulacoes(await sincronizarSimulacoes());
      setFechamentos(await sincronizarFechamentos());
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario?.id]);

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

  // ── Futuros B3: curva de preço esperado (Fase 5) ──────────────
  const [futuros, setFuturos] = useState(null); // {curvas: {milho, soja}, ...} | null

  useEffect(() => {
    buscarFuturos().then(setFuturos); // null em falha → segue no manual
  }, []);

  // Sugere o preço do contrato futuro do horizonte do lote, enquanto o
  // produtor não sobrescrever o preço esperado (precoEsperadoEditado).
  useEffect(() => {
    if (!futuros) return;
    setLotes((ls) => {
      let mudou = false;
      const novo = ls.map((l) => {
        if (l.precoEsperadoEditado) return l;
        const sug = precoSugerido(futuros.curvas?.[l.cultura], l.meses);
        if (sug && l.precoEsperado !== sug.preco) {
          mudou = true;
          return { ...l, precoEsperado: sug.preco };
        }
        return l;
      });
      return mudou ? novo : ls; // mesma referência = sem re-render em loop
    });
  }, [futuros, lotes]);

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
      precoEsperadoEditado: false, // curva B3 da nova cultura volta a sugerir
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

  // ── Resultado real (Fase 7): lotes fechados de verdade ────────
  const [fechamentos, setFechamentos] = useState(() => listarFechamentos());
  const [cardAberto, setCardAberto] = useState(null); // fechamento em exibição no card

  // "Vendi este lote": compara com a simulação salva mais recente da
  // mesma cultura (a "simulação original"); o registro aparece em
  // Inteligência → Seu Desempenho, com o card compartilhável.
  const registrarVenda = (lote, resultado, dados) => {
    const fechamento = montarFechamento(lote, resultado, simulacoes, dados);
    setFechamentos(registrarFechamento(fechamento));
    setCardAberto(fechamento); // mostra o resultado na hora
  };

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
    // restaura exatamente como estava: cotação e curva não sobrescrevem
    setLotes(s.lotes.map((l) => criarLote({ ...l, precoEditado: true, precoEsperadoEditado: true })));
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

  // ── Chat com o GrãoCerto (Fase 3): texto, voz e foto ──────────
  // Conversa com MEMÓRIA: o histórico inteiro vai ao backend; os campos
  // que o produtor muda são aplicados ao lote em foco e o APP recalcula
  // — a resposta com números novos volta pro chat calculada aqui.
  const [chatAberto, setChatAberto] = useState(false);
  const [mensagensChat, setMensagensChat] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatOcupado, setChatOcupado] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [vozOk] = useState(() => vozSuportada());
  const [alvo, setAlvo] = useState("novo"); // lote em foco no chat (ou "novo")
  const reconhecimentoRef = useRef(null);
  const fotoInputRef = useRef(null);
  const fimChatRef = useRef(null);

  // Rola o chat para a última mensagem.
  useEffect(() => {
    fimChatRef.current?.scrollIntoView({ block: "end" });
  }, [mensagensChat, chatAberto, chatOcupado]);

  // Índice do lote em foco (fallback: o último).
  const indiceAlvo = () => {
    const i = lotes.findIndex((l) => l.id === alvo);
    return i >= 0 ? i : lotes.length - 1;
  };

  // Aplica campos vindos do chat/foto ao lote em foco (ou cria um novo) e
  // devolve o lote + resultado recalculado — TODO cálculo acontece aqui.
  const aplicarCamposEmLote = (c) => {
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
        precoEsperadoEditado: c.precoEsperado != null,
      });
      setLotes((ls) => [...ls, novo]);
      setAlvo(novo.id);
      return { lote: novo, resultado: calcularLote(novo), indice: lotes.length };
    }

    const i = indiceAlvo();
    const atual = lotes[i];
    const trocouCultura = c.cultura && CULTURAS[c.cultura] && c.cultura !== atual.cultura;
    const cultura = trocouCultura ? c.cultura : atual.cultura;
    const novo = {
      ...atual,
      cultura,
      sacas: c.sacas ?? atual.sacas,
      meses: c.meses ?? atual.meses,
      custos: { ...atual.custos, ...custos },
    };
    if (c.precoHoje != null) {
      novo.precoHoje = c.precoHoje;
      novo.precoEditado = true; // veio do produtor: cotação não sobrescreve
    } else if (trocouCultura) {
      novo.precoHoje = cotacoes?.[cultura]?.preco ?? CULTURAS[cultura].precoHoje;
      novo.precoEditado = false;
    }
    if (c.precoEsperado != null) {
      novo.precoEsperado = c.precoEsperado;
      novo.precoEsperadoEditado = true; // veio do produtor no chat
    } else if (trocouCultura) {
      novo.precoEsperado = CULTURAS[cultura].precoEsperado;
      novo.precoEsperadoEditado = false;
    }

    setLotes((ls) => ls.map((l) => (l.id === atual.id ? novo : l)));
    return { lote: novo, resultado: calcularLote(novo), indice: i };
  };

  // Mensagem-resumo do resultado novo — números do app, nunca do modelo.
  const msgResultado = ({ lote, resultado, indice }) =>
    `📊 Lote ${indice + 1} (${CULTURAS[lote.cultura]?.nome || lote.cultura}) atualizado: ` +
    `${resultado.veredito === "armazenar" ? "ARMAZENAR" : "VENDER AGORA"} · ` +
    `${resultado.vantagemPorSaca >= 0 ? "+" : "−"} R$ ${fmtBRL(Math.abs(resultado.vantagemPorSaca), 2)}/saca · ` +
    `empate R$ ${fmtBRL(resultado.precoEmpate, 2)}.`;

  const enviarMensagemChat = async () => {
    const texto = chatInput.trim();
    if (!texto || chatOcupado) return;
    if (gravando) reconhecimentoRef.current?.stop();
    const historico = [...mensagensChat, { papel: "produtor", texto }];
    setMensagensChat(historico);
    setChatInput("");
    setChatOcupado(true);
    try {
      const i = indiceAlvo();
      const r = await conversar(historico, retratoParaIA(lotes[i], resultados[i]));
      const novas = [...historico, { papel: "graocerto", texto: r.resposta, aviso: r.aviso }];
      if (r.campos && Object.keys(r.campos).length) {
        novas.push({ papel: "graocerto", texto: msgResultado(aplicarCamposEmLote(r.campos)) });
      }
      setMensagensChat(novas);
    } finally {
      setChatOcupado(false);
    }
  };

  // Foto de romaneio/NF vira mensagem no chat; campos lidos são aplicados.
  const enviarFotoChat = async (e) => {
    const arquivo = e.target.files?.[0];
    e.target.value = ""; // permite escolher o mesmo arquivo de novo
    if (!arquivo || chatOcupado) return;
    const historico = [...mensagensChat, { papel: "produtor", texto: "📷 Foto de romaneio/nota fiscal" }];
    setMensagensChat(historico);
    setChatOcupado(true);
    try {
      const r = await interpretarImagem(arquivo);
      const novas = [...historico, { papel: "graocerto", texto: r.resumo || "Li o documento." }];
      const { dataDocumento: _d, ...campos } = r.campos || {};
      if (Object.keys(campos).length) {
        novas.push({ papel: "graocerto", texto: msgResultado(aplicarCamposEmLote(campos)) });
      }
      setMensagensChat(novas);
    } catch (err) {
      setMensagensChat([
        ...historico,
        { papel: "graocerto", texto: String(err.message || err), aviso: "erro" },
      ]);
    } finally {
      setChatOcupado(false);
    }
  };

  // Voz: o áudio transcrito preenche o campo; o produtor confere e envia.
  const alternarVoz = () => {
    if (gravando) {
      reconhecimentoRef.current?.stop();
      return;
    }
    const rec = criarReconhecimentoVoz(setChatInput, () => setGravando(false));
    if (!rec) return;
    reconhecimentoRef.current = rec;
    setGravando(true);
    rec.start();
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
          GRÃO<span style={{ color: "#22C55E" }}>CERTO</span>
        </div>
        <div style={st.marcaSub}>inteligência de comercialização</div>
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
                  <span style={st.consolidadoRotulo}>Volume em Armazém</span>
                  <span style={st.homeNum}>{fmtBRL(consolidado.totalSacas)}</span>
                  <span style={st.consolidadoSub}>
                    {lotes.length} {lotes.length === 1 ? "lote" : "lotes"} ·{" "}
                    {consolidado.culturas.map((c) => CULTURAS[c]?.nome || c).join(" + ")}
                  </span>
                </div>
                <div style={st.homeCard}>
                  <span style={st.consolidadoRotulo}>Valor em Armazém</span>
                  <span style={st.homeNum}>R$ {fmtBRL(consolidado.receitaAgora)}</span>
                  <span style={st.consolidadoSub}>vendendo tudo ao preço atual</span>
                </div>
                <div style={st.homeCard}>
                  <span style={st.consolidadoRotulo}>Mercado Hoje (CEPEA)</span>
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
                  borderColor: consolidado.armazenar ? "#22C55E" : "#F59E0B",
                  boxShadow: consolidado.armazenar ? "0 0 32px rgba(34,197,94,0.12)" : "0 0 32px rgba(245,158,11,0.12)",
                }}
              >
                <div style={st.ticketFuro} aria-hidden="true" />
                <div style={st.ticketEyebrow}>RECOMENDAÇÃO DO DIA · SAFRA COMPLETA</div>
                <div
                  style={{
                    ...st.ticketVeredito,
                    color: consolidado.armazenar ? "#22C55E" : "#F59E0B",
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
              sugestaoFuturo={precoSugerido(futuros?.curvas?.[lote.cultura], lote.meses)}
              onMudar={(campos) => mudarLote(lote.id, campos)}
              onTrocarCultura={(c) => trocarCultura(lote.id, c)}
              onAtualizarCotacao={() => reaplicarCotacao(lote.id)}
              onExcluir={() => excluirLote(lote.id)}
              onRecomendar={() => pedirRecomendacao(lote, resultados[i])}
              onVendi={(dados) => registrarVenda(lote, resultados[i], dados)}
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
            <h2 style={st.tituloSecao}>Curva de futuros B3</h2>
            {futuros ? (
              <>
                {["soja", "milho"].map((c) =>
                  futuros.curvas?.[c]?.length ? (
                    <GraficoCurva
                      key={c}
                      titulo={CULTURAS[c].nome}
                      cor={c === "soja" ? "#3E6B4F" : "#C99B2F"}
                      curva={futuros.curvas[c]}
                      spot={cotacoes?.[c]?.preco}
                    />
                  ) : null,
                )}
                <p style={st.grafTexto}>
                  Ajustes do pregão de {fmtData(futuros.dataPregao)} ({futuros.fonte}).
                  {futuros.cambio
                    ? ` Soja: contrato SJC em US$/saca convertido a R$ ${fmtBRL(futuros.cambio.usdbrl, 2)}.`
                    : ` ${futuros.avisoSoja || ""}`}{" "}
                  “Hoje” = indicador CEPEA/ESALQ. É a curva que sugere o preço esperado dos
                  lotes na Operação.
                </p>
              </>
            ) : (
              <div style={st.grafPlaceholder}>
                <p style={st.grafTexto}>
                  Curva B3 indisponível agora (fonte fora do ar ou sem backend) — o preço
                  esperado segue sendo o seu palpite no controle de cada lote da Operação.
                </p>
              </div>
            )}
          </section>

          {/* Resultado real (Fase 7): o que aconteceu de verdade */}
          <PainelDesempenho
            fechamentos={fechamentos}
            onCard={setCardAberto}
            onExcluir={(id) => setFechamentos(excluirFechamento(id))}
          />

          {/* Alertas proativos: "me avise quando chegar a R$ X" (Fase 6) */}
          <PainelAlertas usuario={usuario} cotacoes={cotacoes} perfil={perfil} />

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

          {/* ══ ABA CONTA — login, perfil e custos ═══════════════ */}
          {abaAtiva === "conta" && (
            <main style={st.gradeUnica}>
              {!supabaseConfigurado() ? (
                <p style={st.contaNota}>
                  Sincronização em nuvem ainda não ativada — seus dados ficam só neste
                  aparelho. (Para ativar: configurar VITE_SUPABASE_URL e
                  VITE_SUPABASE_ANON_KEY.)
                </p>
              ) : usuario ? (
                <div style={st.contaSessao}>
                  <span style={st.contaEmail}>
                    ✓ Conectado como <strong>{usuario.email}</strong> — perfil e simulações
                    sincronizados na nuvem.
                  </span>
                  <button
                    type="button"
                    style={st.btnSecundario}
                    onClick={() => supabase.auth.signOut()}
                  >
                    Sair
                  </button>
                </div>
              ) : (
                <LoginBox />
              )}

              <FormPerfil inicial={perfil} onSalvar={salvarConta} onCancelar={null} />
              {contaSalva && (
                <p style={st.contaFeedback}>
                  ✓ perfil salvo — os novos custos valem como sugestão para os próximos lotes
                </p>
              )}
            </main>
          )}

          <p style={st.aviso}>
            As orientações do GRÃOCERTO explicam a conta de custo do próprio app e não constituem recomendação de investimento. Cotações: CEPEA/ESALQ (CC BY-NC 4.0).
          </p>

          {/* ══ CHAT flutuante — disponível em todas as abas ═════ */}
          {!chatAberto && (
            <button
              type="button"
              style={st.chatFab}
              onClick={() => setChatAberto(true)}
              aria-label="Abrir conversa com o GrãoCerto"
            >
              ✨
            </button>
          )}
          {chatAberto && (
            <section style={st.chatPainel} aria-label="Conversa com o GrãoCerto">
              <div style={st.chatCabecalho}>
                <span style={st.chatTitulo}>💬 Fale com o GrãoCerto</span>
                <button
                  type="button"
                  style={st.chatFechar}
                  onClick={() => setChatAberto(false)}
                  aria-label="Fechar conversa"
                >
                  ×
                </button>
              </div>
              <label style={st.chatAlvo}>
                <span style={st.alvoRotulo}>Falando sobre</span>
                <select value={alvo} onChange={(e) => setAlvo(e.target.value)} style={st.alvoSelect}>
                  {lotes.map((l, i) => (
                    <option key={l.id} value={l.id}>
                      {nomeLote(l, i)}
                    </option>
                  ))}
                  <option value="novo">＋ Novo lote</option>
                </select>
              </label>
              <div style={st.chatMensagens}>
                {mensagensChat.length === 0 && (
                  <p style={st.chatVazio}>
                    Me conte da sua safra — “colhi 12 mil sacas de soja, tô devendo 1,2 ao mês”
                    — ou pergunte “e se eu vender só metade?”. Também leio foto de romaneio e
                    nota fiscal. 📷
                  </p>
                )}
                {mensagensChat.map((m, i) => (
                  <div key={i} style={m.papel === "produtor" ? st.bolhaProdutor : st.bolhaGraocerto}>
                    {m.texto}
                    {m.aviso && m.aviso !== "erro" && <span style={st.bolhaAviso}>{m.aviso}</span>}
                  </div>
                ))}
                {chatOcupado && <div style={st.bolhaGraocerto}>…</div>}
                <div ref={fimChatRef} />
              </div>
              <div style={st.chatEntradaLinha}>
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      enviarMensagemChat();
                    }
                  }}
                  rows={1}
                  style={st.chatEntrada}
                  placeholder={gravando ? "Ouvindo… pode falar" : "Escreva ou fale…"}
                  disabled={chatOcupado}
                />
                {vozOk && (
                  <button
                    type="button"
                    style={{ ...st.chatBtnIcone, ...(gravando ? st.btnGravando : {}) }}
                    onClick={alternarVoz}
                    aria-label={gravando ? "Parar gravação" : "Falar"}
                  >
                    {gravando ? "■" : "🎤"}
                  </button>
                )}
                <button
                  type="button"
                  style={st.chatBtnIcone}
                  onClick={() => fotoInputRef.current?.click()}
                  disabled={chatOcupado}
                  aria-label="Enviar foto de romaneio ou nota fiscal"
                >
                  📷
                </button>
                <input
                  ref={fotoInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: "none" }}
                  onChange={enviarFotoChat}
                />
                <button
                  type="button"
                  style={st.chatEnviar}
                  onClick={enviarMensagemChat}
                  disabled={chatOcupado || !chatInput.trim()}
                >
                  ➤
                </button>
              </div>
            </section>
          )}

          <TabBar ativa={abaAtiva} onTrocar={setAbaAtiva} />

          {/* Card de resultado real, compartilhável (Fase 7) */}
          {cardAberto && (
            <CardResultado fechamento={cardAberto} onFechar={() => setCardAberto(null)} />
          )}
        </>
      )}
    </div>
  );
}

// Curva de futuros de uma cultura: linha por vencimento, com o preço
// de hoje (CEPEA) como primeiro ponto para dar régua ao produtor.
function GraficoCurva({ titulo, cor, curva, spot }) {
  const dados = [
    ...(typeof spot === "number" ? [{ rotulo: "Hoje", preco: spot }] : []),
    ...curva.map((c) => ({ rotulo: c.rotulo, preco: c.preco })),
  ];
  return (
    <div style={st.grafBloco}>
      <div style={st.grafTitulo}>
        <span style={{ ...st.grafCorPonto, background: cor }} aria-hidden="true" />
        {titulo} · R$/saca
      </div>
      <ResponsiveContainer width="100%" height={190}>
        <LineChart data={dados} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#1E293B" strokeDasharray="4 4" vertical={false} />
          <XAxis
            dataKey="rotulo"
            tick={{ fontSize: 11, fontFamily: "'Inter', monospace", fill: "#64748B" }}
            tickLine={false}
            axisLine={{ stroke: "#334155" }}
          />
          <YAxis
            domain={["auto", "auto"]}
            width={52}
            tick={{ fontSize: 11, fontFamily: "'Inter', monospace", fill: "#64748B" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => fmtBRL(v)}
          />
          <Tooltip
            formatter={(v) => [`R$ ${fmtBRL(v, 2)}/saca`, "Preço"]}
            contentStyle={{
              fontFamily: "'Inter', monospace",
              fontSize: 12,
              border: "1px solid #334155",
              borderRadius: 10,
              background: "#1A1D24",
              color: "#F8FAFC",
            }}
          />
          <Line
            type="monotone"
            dataKey="preco"
            stroke={cor}
            strokeWidth={2.5}
            dot={{ r: 3, fill: cor }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// "Seu Desempenho" (Fase 7): o placar do ciclo completo — o que o
// produtor ganhou (ou deixou na mesa) nas vendas reais registradas,
// sempre comparando com vender no dia da simulação original. Os números
// saem todos de calcularResultadoReal (modelo do app) — nada projetado.
function PainelDesempenho({ fechamentos, onCard, onExcluir }) {
  if (fechamentos.length === 0) {
    return (
      <section style={st.historicoPainel}>
        <h2 style={st.tituloSecao}>Seu desempenho</h2>
        <p style={st.semAlerta}>
          Quando vender de verdade, toque em “✓ Vendi este lote” na Operação. O GrãoCerto
          compara a venda real com a simulação original e mostra aqui quanto a decisão
          rendeu — com um card pronto para compartilhar.
        </p>
      </section>
    );
  }

  const resumo = resumoDesempenho(fechamentos);
  const corSaldo = (v) => (v >= 0 ? "#3E6B4F" : "#A4432E");
  const sinalR$ = (v) => `${v >= 0 ? "+" : "−"} R$ ${fmtBRL(Math.abs(v))}`;

  return (
    <section style={st.historicoPainel}>
      <h2 style={st.tituloSecao}>Seu desempenho</h2>
      <div style={st.desempenhoResumo}>
        <div style={st.desempenhoTile}>
          <span style={{ ...st.desempenhoNum, color: corSaldo(resumo.saldoTotal) }}>
            {sinalR$(resumo.saldoTotal)}
          </span>
          <span style={st.desempenhoRotulo}>
            resultado das decisões vs. vender no dia da simulação
          </span>
        </div>
        {resumo.nSeguindo > 0 && (
          <div style={st.desempenhoTile}>
            <span style={{ ...st.desempenhoNum, color: corSaldo(resumo.ganhoSeguindo) }}>
              {sinalR$(resumo.ganhoSeguindo)}
            </span>
            <span style={st.desempenhoRotulo}>
              seguindo o GrãoCerto ({resumo.nSeguindo}{" "}
              {resumo.nSeguindo === 1 ? "venda" : "vendas"})
            </span>
          </div>
        )}
        {resumo.nContrariando > 0 && (
          <div style={st.desempenhoTile}>
            <span style={{ ...st.desempenhoNum, color: corSaldo(resumo.saldoContrariando) }}>
              {sinalR$(resumo.saldoContrariando)}
            </span>
            <span style={st.desempenhoRotulo}>
              por conta própria ({resumo.nContrariando}{" "}
              {resumo.nContrariando === 1 ? "venda" : "vendas"})
            </span>
          </div>
        )}
        {resumo.nVerificaveis > 0 && (
          <div style={st.desempenhoTile}>
            <span style={st.desempenhoNum}>
              {resumo.acertos} de {resumo.nVerificaveis}
            </span>
            <span style={st.desempenhoRotulo}>recomendações confirmadas pelo mercado</span>
          </div>
        )}
      </div>

      {fechamentos.map((f) => {
        const r = calcularResultadoReal(f);
        return (
          <div key={f.id} style={st.simLinha}>
            <div style={st.simInfo}>
              <span style={st.simDesc}>{fraseResultado(f, r)}</span>
              <span style={st.simData}>
                {CULTURAS[f.cultura]?.nome || f.cultura} · {fmtBRL(f.sacas)} sc · vendeu{" "}
                {fmtData(f.dataVendaReal)} a R$ {fmtBRL(f.precoVendaReal, 2)}
                {f.semBaseline ? " · sem simulação salva na época" : ""}
              </span>
            </div>
            <div style={st.simAcoes}>
              <button type="button" style={st.simBtn} onClick={() => onCard(f)}>
                Ver card
              </button>
              <button
                type="button"
                style={st.simBtnExcluir}
                onClick={() => onExcluir(f.id)}
                aria-label="Excluir registro de venda"
              >
                ×
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

// Modal com o card visual do resultado, para baixar/compartilhar.
function CardResultado({ fechamento, onFechar }) {
  const canvasRef = useRef(null);
  const [compartilhavel, setCompartilhavel] = useState(false);
  const resultado = useMemo(() => calcularResultadoReal(fechamento), [fechamento]);

  useEffect(() => {
    if (canvasRef.current) desenharCard(canvasRef.current, fechamento, resultado);
    setCompartilhavel(typeof navigator !== "undefined" && !!navigator.canShare);
  }, [fechamento, resultado]);

  return (
    <div style={st.cardOverlay} role="dialog" aria-label="Card de resultado" onClick={onFechar}>
      <div style={st.cardCaixa} onClick={(e) => e.stopPropagation()}>
        <canvas ref={canvasRef} style={st.cardCanvas} />
        <div style={st.cardAcoes}>
          <button
            type="button"
            style={st.btnPrimario}
            onClick={() => baixarCard(canvasRef.current)}
          >
            Baixar imagem
          </button>
          {compartilhavel && (
            <button
              type="button"
              style={st.btnSecundario}
              onClick={async () => {
                const ok = await compartilharCard(canvasRef.current);
                if (!ok) baixarCard(canvasRef.current); // sem share de arquivo → baixa
              }}
            >
              Compartilhar
            </button>
          )}
          <button type="button" style={st.btnSecundario} onClick={onFechar}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

// "Me avise quando chegar a R$ X" (Fase 6): o alerta vai para o Supabase
// e o cron server/cron-alertas.mjs manda o WhatsApp quando a cotação
// cruza o alvo — aqui só cria, lista e exclui. Sem nuvem ou sem login,
// o painel explica o que falta em vez de sumir.
function PainelAlertas({ usuario, cotacoes, perfil }) {
  const [alertas, setAlertas] = useState([]);
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [cultura, setCultura] = useState(perfil?.culturaPrincipal || "soja");
  const [tipo, setTipo] = useState("maior_que");
  const [alvo, setAlvo] = useState("");
  const [telefone, setTelefone] = useState("");

  const logado = supabaseConfigurado() && !!usuario;

  useEffect(() => {
    if (!logado) return;
    listarAlertas().then((r) => {
      setAlertas(r.alertas);
      if (r.erro) setErro(r.erro);
    });
  }, [logado, usuario?.id]);

  const precoAtual = cotacoes?.[cultura]?.preco;

  const criar = async () => {
    const preco = Number(String(alvo).replace(",", "."));
    if (!preco || preco <= 0 || salvando) return;
    setSalvando(true);
    setErro(null);
    const r = await criarAlerta({
      cultura,
      praca: cotacoes?.[cultura]?.praca || null,
      precoAlvo: preco,
      tipo,
      telefone,
    });
    if (r.erro) setErro(r.erro);
    else {
      setAlvo("");
      const lista = await listarAlertas();
      setAlertas(lista.alertas);
    }
    setSalvando(false);
  };

  const excluir = async (id) => {
    const r = await excluirAlerta(id);
    if (r.erro) setErro(r.erro);
    else setAlertas(alertas.filter((a) => a.id !== id));
  };

  return (
    <section style={st.historicoPainel}>
      <h2 style={st.tituloSecao}>Alertas de preço</h2>
      {!logado ? (
        <p style={st.semAlerta}>
          “Me avise no WhatsApp quando a saca chegar ao meu preço” — para isso o alerta
          precisa ficar guardado na nuvem.{" "}
          {supabaseConfigurado()
            ? "Entre na aba Conta para criar seus alertas."
            : "Disponível quando a conta na nuvem estiver configurada (aba Conta)."}
        </p>
      ) : (
        <>
          <p style={st.formIntro}>
            O GrãoCerto acompanha a cotação todos os dias úteis e te avisa no WhatsApp
            quando ela cruzar o seu alvo.
          </p>
          <div style={st.alertaForm}>
            <label style={st.campo}>
              <span style={st.campoRotulo}>Cultura</span>
              <select value={cultura} onChange={(e) => setCultura(e.target.value)} style={st.select}>
                {Object.entries(CULTURAS).map(([k, c]) => (
                  <option key={k} value={k}>{c.nome}</option>
                ))}
              </select>
            </label>
            <label style={st.campo}>
              <span style={st.campoRotulo}>Avisar quando</span>
              <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={st.select}>
                <option value="maior_que">subir até (≥)</option>
                <option value="menor_que">cair para (≤)</option>
              </select>
            </label>
            <label style={st.campo}>
              <span style={st.campoRotulo}>
                Preço-alvo (R$/saca){typeof precoAtual === "number" ? ` — hoje R$ ${fmtBRL(precoAtual, 2)}` : ""}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={alvo}
                onChange={(e) => setAlvo(e.target.value)}
                placeholder={typeof precoAtual === "number" ? fmtBRL(precoAtual + 5, 2) : "ex.: 135,00"}
                style={st.select}
              />
            </label>
            <label style={st.campo}>
              <span style={st.campoRotulo}>WhatsApp (com DDD)</span>
              <input
                type="tel"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                placeholder="(66) 99999-8888"
                style={st.select}
                autoComplete="tel"
              />
            </label>
          </div>
          <div style={st.formAcoes}>
            <button
              type="button"
              style={st.btnPrimario}
              onClick={criar}
              disabled={salvando || !Number(String(alvo).replace(",", "."))}
            >
              {salvando ? "Salvando…" : "Me avise quando chegar lá"}
            </button>
          </div>
          {erro && <p style={st.entradaErro}>{erro}</p>}

          {alertas.length === 0 ? (
            <p style={st.semAlerta}>Nenhum alerta ainda.</p>
          ) : (
            alertas.map((a) => (
              <div key={a.id} style={st.simLinha}>
                <div style={st.simInfo}>
                  <span style={st.simDesc}>
                    {CULTURAS[a.cultura]?.nome || a.cultura} {a.tipo === "maior_que" ? "≥" : "≤"}{" "}
                    R$ {fmtBRL(Number(a.preco_alvo), 2)}
                    {a.praca ? ` · ${a.praca}` : ""}
                  </span>
                  <span
                    style={{
                      ...st.simData,
                      color: a.status === "disparado" ? "#3E6B4F" : "#5A6B5D",
                    }}
                  >
                    {a.status === "disparado"
                      ? `✓ disparado ${a.disparado_em ? fmtDataHora(a.disparado_em) : ""}`
                      : a.status === "pendente"
                        ? "aguardando o preço"
                        : a.status}
                    {a.telefone ? ` · WhatsApp ${a.telefone}` : " · sem telefone"}
                  </span>
                </div>
                <div style={st.simAcoes}>
                  <button
                    type="button"
                    style={st.simBtnExcluir}
                    onClick={() => excluir(a.id)}
                    aria-label="Excluir alerta"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))
          )}
        </>
      )}
    </section>
  );
}

// Login por magic link (Supabase Auth): o produtor digita o e-mail e
// recebe um link — sem senha, que é atrito puro no campo.
function LoginBox() {
  const [email, setEmail] = useState("");
  const [estado, setEstado] = useState(null); // null | "enviando" | "enviado" | "erro"
  const [erro, setErro] = useState(null);

  const enviarLink = async () => {
    const e = email.trim();
    if (!e || estado === "enviando") return;
    setEstado("enviando");
    setErro(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: e,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      setEstado("enviado");
    } catch (err) {
      setEstado("erro");
      setErro(err.message || String(err));
    }
  };

  return (
    <section style={{ ...st.painel, maxWidth: 480, margin: "0 auto 20px" }}>
      <h2 style={st.tituloSecao}>Entrar</h2>
      {estado === "enviado" ? (
        <p style={st.formIntro}>
          ✓ Link enviado para <strong>{email}</strong> — abra seu e-mail e toque no link
          para entrar. Depois disso, seu perfil e suas simulações ficam guardados na sua
          conta e aparecem em qualquer aparelho.
        </p>
      ) : (
        <>
          <p style={st.formIntro}>
            Sem senha: você recebe um link de acesso no e-mail. Com a conta, perfil e
            simulações ficam guardados na nuvem e aparecem em qualquer aparelho.
          </p>
          <label style={st.campo}>
            <span style={st.campoRotulo}>Seu e-mail</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && enviarLink()}
              placeholder="produtor@exemplo.com.br"
              style={st.select}
              autoComplete="email"
            />
          </label>
          <div style={st.formAcoes}>
            <button
              type="button"
              style={st.btnPrimario}
              onClick={enviarLink}
              disabled={estado === "enviando" || !email.trim()}
            >
              {estado === "enviando" ? "Enviando…" : "Enviar link de acesso"}
            </button>
          </div>
          {estado === "erro" && <p style={st.entradaErro}>Não consegui enviar: {erro}</p>}
        </>
      )}
    </section>
  );
}

// ── Barra de abas do dashboard (fixa no rodapé, mobile-first) ──
function TabBar({ ativa, onTrocar }) {
  const ABAS = [
    ["home", "■", "Painel"],
    ["operacao", "▶", "Operação"],
    ["inteligencia", "≈", "Mercado"],
    ["conta", "○", "Perfil"],
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
  sugestaoFuturo,
  onMudar,
  onTrocarCultura,
  onAtualizarCotacao,
  onExcluir,
  onRecomendar,
  onVendi,
}) {
  const margem = Math.abs(resultado.vantagemPorSaca);
  const fraseAtual = frase && frase.assinatura === assinaturaLote(lote);

  // Formulário "Vendi este lote" (Fase 7): data e preço reais da venda
  const [vendendo, setVendendo] = useState(false);
  const hojeISO = new Date().toISOString().slice(0, 10);
  const [dataVenda, setDataVenda] = useState(hojeISO);
  const [precoVenda, setPrecoVenda] = useState("");

  const confirmarVenda = () => {
    const preco = Number(String(precoVenda).replace(",", "."));
    if (!preco || preco <= 0 || !dataVenda) return;
    onVendi({ dataVenda, precoVenda: preco });
    setVendendo(false);
    setPrecoVenda("");
  };

  return (
    <section style={st.loteBloco}>
      <div style={st.loteCabecalho}>
        <span style={st.loteTitulo}>
          Lote {indice + 1} · {CULTURAS[lote.cultura]?.nome || lote.cultura} ·{" "}
          {fmtBRL(lote.sacas)} sacas
        </span>
        <button
          type="button"
          style={st.vendiBtn}
          onClick={() => setVendendo(!vendendo)}
          aria-expanded={vendendo}
        >
          {vendendo ? "Cancelar" : "✓ Vendi este lote"}
        </button>
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

      {vendendo && (
        <div style={st.vendiForm}>
          <p style={st.formIntro}>
            Fechou negócio? Registre a venda real para o GrãoCerto comparar com o que foi
            simulado — o resultado aparece em Inteligência → Seu Desempenho.
          </p>
          <div style={st.alertaForm}>
            <label style={st.campo}>
              <span style={st.campoRotulo}>Quando vendeu</span>
              <input
                type="date"
                value={dataVenda}
                max={hojeISO}
                onChange={(e) => setDataVenda(e.target.value)}
                style={st.select}
              />
            </label>
            <label style={st.campo}>
              <span style={st.campoRotulo}>Preço da venda (R$/saca)</span>
              <input
                type="text"
                inputMode="decimal"
                value={precoVenda}
                onChange={(e) => setPrecoVenda(e.target.value)}
                placeholder={`ex.: ${fmtBRL(lote.precoHoje, 2)}`}
                style={st.select}
              />
            </label>
          </div>
          <button
            type="button"
            style={st.btnPrimario}
            onClick={confirmarVenda}
            disabled={!Number(String(precoVenda).replace(",", "."))}
          >
            Registrar venda real
          </button>
        </div>
      )}

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
            rotulo="Preço Físico (Balcão Hoje)"
            sufixo="R$/saca"
            valor={lote.precoHoje}
            onChange={(v) => onMudar({ precoHoje: v, precoEditado: true })}
            passo={0.5}
            ajuda="Preço que você conseguiria vendendo esta semana na sua região"
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
            rotulo="Horizonte de Armazenagem"
            sufixo="meses"
            valor={lote.meses}
            onChange={(v) => onMudar({ meses: v })}
            passo={1}
            min={1}
          />

          <h2 style={{ ...st.tituloSecao, marginTop: 28 }}>Custo de Carregamento</h2>
          <Campo
            rotulo="Armazenagem"
            sufixo="R$/saca/mês"
            valor={lote.custos.armazenagem}
            onChange={(v) => onMudar({ custos: { armazenagem: v } })}
            passo={0.1}
            ajuda="Silo próprio: energia + manutenção. Terceiro: tarifa da cooperativa"
          />
          <Campo
            rotulo="Custo de Oportunidade (CDI)"
            sufixo="% a.m."
            valor={lote.custos.jurosMes}
            onChange={(v) => onMudar({ custos: { jurosMes: v } })}
            passo={0.1}
            ajuda="Juros da sua dívida — ou quanto o capital renderia aplicado"
          />
          <Campo
            rotulo="Quebra Técnica (Umidade/Impureza)"
            sufixo="% ao mês"
            valor={lote.custos.perdaMes}
            onChange={(v) => onMudar({ custos: { perdaMes: v } })}
            passo={0.05}
            ajuda="Perda de peso por umidade, pragas e deterioração no armazém"
          />
        </div>

        {/* Coluna de resultado */}
        <div>
          <div
            style={{ ...st.ticket, borderColor: resultado.armazenar ? "#22C55E" : "#F59E0B", boxShadow: resultado.armazenar ? "0 0 24px rgba(34,197,94,0.12)" : "0 0 24px rgba(245,158,11,0.12)" }}
          >
            <div style={st.ticketFuro} aria-hidden="true" />
            <div style={st.ticketEyebrow}>RECOMENDAÇÃO ESTRATÉGICA</div>
            <div
              style={{
                ...st.ticketVeredito,
                color: resultado.armazenar ? "#22C55E" : "#F59E0B",
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
              onChange={(e) =>
                onMudar({ precoEsperado: parseFloat(e.target.value), precoEsperadoEditado: true })
              }
              style={{ width: "100%" }}
              aria-label="Preço esperado por saca"
            />

            {/* Curva B3: de onde vem o preço esperado */}
            <div style={st.futuroLinha}>
              {sugestaoFuturo ? (
                lote.precoEsperadoEditado ? (
                  <>
                    <span style={st.futuroInfo}>
                      Contrato B3 {sugestaoFuturo.codigo} ({sugestaoFuturo.rotulo}): R${" "}
                      {fmtBRL(sugestaoFuturo.preco, 2)} · ajustado por você
                    </span>
                    <button
                      type="button"
                      style={st.cotacaoBtn}
                      onClick={() =>
                        onMudar({ precoEsperado: sugestaoFuturo.preco, precoEsperadoEditado: false })
                      }
                    >
                      Usar contrato
                    </button>
                  </>
                ) : (
                  <span style={st.futuroInfo}>
                    <span style={st.cotacaoPonto} aria-hidden="true" />
                    Sugerido pelo contrato B3 {sugestaoFuturo.codigo} ({sugestaoFuturo.rotulo})
                  </span>
                )
              ) : (
                <span style={st.futuroManual}>
                  Curva B3 indisponível — o preço esperado é seu palpite no controle acima.
                </span>
              )}
            </div>

            <div style={st.empate}>
              <span style={st.empateRotulo}>Breakeven (Ponto de Empate)</span>
              <span style={st.empateNum}>R$ {fmtBRL(resultado.precoEmpate, 2)}/saca</span>
              <span style={st.empateExpl}>
                Acima desse preço, armazenar compensa. Abaixo, vender agora é melhor.
              </span>
            </div>
          </div>

          {/* Composição da conta — recolhida por padrão para não poluir com vários lotes */}
          <details style={st.painel}>
            <summary style={st.contaSummary}>
              <span style={{ ...st.tituloSecao, margin: 0 }}>Demonstrativo de Resultado</span>
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
          color: valor < 0 ? "#EF4444" : "#22C55E",
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
        {inicial ? "Perfil da Fazenda" : "Configure sua operação"}
      </h2>
      {!inicial && (
        <p style={st.formIntro}>
          Informe os dados da sua fazenda. Nas próximas visitas tudo já vem
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

      <h2 style={{ ...st.tituloSecao, marginTop: 24 }}>Custo de Carregamento Padrão</h2>
      <p style={st.formIntro}>
        Referência para {REGIOES[regiao].nome} — ajuste conforme sua realidade.
      </p>
      <Campo
        rotulo="Armazenagem"
        sufixo="R$/saca/mês"
        valor={custos.armazenagem}
        onChange={setCusto("armazenagem")}
        passo={0.1}
      />
      <Campo
        rotulo="Custo de Oportunidade (CDI)"
        sufixo="% a.m."
        valor={custos.jurosMes}
        onChange={setCusto("jurosMes")}
        passo={0.1}
      />
      <Campo
        rotulo="Quebra Técnica"
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
    background: "#0F1115",
    color: "#F8FAFC",
    fontFamily: "'Inter', 'Outfit', system-ui, sans-serif",
    padding: "0 16px 104px",
  },
  tabBar: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    display: "flex",
    background: "#1A1D24",
    borderTop: "1px solid #334155",
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
    color: "#64748B",
    fontFamily: "'Inter', sans-serif",
    fontSize: 10,
    fontWeight: 600,
    cursor: "pointer",
    textTransform: "uppercase",
    letterSpacing: "0.07em",
  },
  tabItemAtivo: {
    color: "#22C55E",
    background: "transparent",
    boxShadow: "inset 0 3px 0 #22C55E",
  },
  tabIcone: { fontSize: 18, lineHeight: 1 },
  homeStats: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 12,
    marginBottom: 20,
  },
  homeCard: {
    background: "#1A1D24",
    border: "1px solid #334155",
    borderRadius: 12,
    padding: "16px 18px",
  },
  homeNum: {
    display: "block",
    fontFamily: "'Inter', monospace",
    fontSize: 26,
    fontWeight: 700,
    margin: "4px 0 2px",
    color: "#F8FAFC",
    fontVariantNumeric: "tabular-nums",
  },
  homeCotLinha: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontFamily: "'Inter', monospace",
    fontSize: 15,
    fontWeight: 600,
    margin: "4px 0",
    color: "#F8FAFC",
    fontVariantNumeric: "tabular-nums",
  },
  alertaItem: {
    display: "flex",
    gap: 10,
    padding: "10px 0",
    fontSize: 14,
    color: "#CBD5E1",
    borderBottom: "1px solid #1E293B",
    alignItems: "baseline",
  },
  alertaPonto: {
    color: "#F59E0B",
    fontWeight: 800,
    fontFamily: "'Inter', monospace",
    flexShrink: 0,
  },
  semAlerta: { fontSize: 14, color: "#475569", padding: "2px 0 10px", margin: 0 },
  grafPlaceholder: {
    border: "1px dashed #334155",
    borderRadius: 12,
    padding: "18px 16px 8px",
    textAlign: "center",
    background: "#1A1D24",
    marginBottom: 8,
  },
  grafTexto: { fontSize: 13, color: "#64748B", lineHeight: 1.5, margin: "10px 0 8px" },
  grafBloco: { marginBottom: 18 },
  grafTitulo: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontFamily: "'Inter', monospace",
    fontSize: 11,
    fontWeight: 700,
    color: "#94A3B8",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    marginBottom: 6,
  },
  grafCorPonto: { width: 10, height: 10, borderRadius: "50%", flexShrink: 0 },
  futuroLinha: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    margin: "8px 0 4px",
    flexWrap: "wrap",
  },
  futuroInfo: {
    fontFamily: "'Inter', monospace",
    fontSize: 11,
    color: "#22C55E",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  },
  futuroManual: {
    fontFamily: "'Inter', monospace",
    fontSize: 11,
    color: "#64748B",
  },
  contaFeedback: {
    textAlign: "center",
    fontFamily: "'Inter', monospace",
    fontSize: 12,
    color: "#22C55E",
    marginTop: 12,
  },
  contaNota: {
    maxWidth: 480,
    margin: "0 auto 16px",
    padding: "10px 14px",
    background: "rgba(245,158,11,0.1)",
    border: "1px solid rgba(245,158,11,0.3)",
    borderRadius: 8,
    fontSize: 13,
    color: "#FCD34D",
    lineHeight: 1.5,
  },
  contaSessao: {
    maxWidth: 480,
    margin: "0 auto 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "14px 18px",
    background: "#1A1D24",
    border: "1px solid #334155",
    borderRadius: 12,
    flexWrap: "wrap",
  },
  contaEmail: { fontSize: 13, color: "#CBD5E1", lineHeight: 1.5, minWidth: 200, flex: 1 },
  entradaErro: { fontSize: 13, color: "#EF4444", margin: "4px 0 8px" },
  topo: {
    maxWidth: 980,
    margin: "0 auto",
    padding: "24px 0 18px",
    borderBottom: "1px solid #1E293B",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
  },
  marca: {
    fontSize: 24,
    fontWeight: 800,
    letterSpacing: "-0.01em",
    color: "#F8FAFC",
  },
  marcaSub: {
    fontFamily: "'Inter', monospace",
    fontSize: 11,
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: "0.1em",
  },
  grade: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: 20,
    alignItems: "start",
  },
  painel: {
    background: "#1A1D24",
    border: "1px solid #334155",
    borderRadius: 14,
    padding: "20px 20px 12px",
    marginBottom: 20,
  },
  tituloSecao: {
    margin: "0 0 14px",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: "#64748B",
  },
  abas: { display: "flex", gap: 6, marginBottom: 18 },
  aba: {
    flex: 1,
    padding: "10px 0",
    border: "1px solid #334155",
    borderRadius: 8,
    background: "#0F1115",
    fontFamily: "'Inter', sans-serif",
    fontWeight: 600,
    fontSize: 13,
    color: "#64748B",
    cursor: "pointer",
    transition: "all .15s",
  },
  abaAtiva: {
    background: "#22C55E",
    color: "#0F1115",
    border: "1px solid #22C55E",
    fontWeight: 700,
  },
  campo: { display: "block", marginBottom: 18 },
  campoRotulo: { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em" },
  campoLinha: { display: "flex", alignItems: "center", gap: 8 },
  campoInput: {
    flex: 1,
    minWidth: 0,
    padding: "11px 14px",
    fontSize: 17,
    fontFamily: "'Inter', monospace",
    border: "1px solid #334155",
    borderRadius: 10,
    background: "#0F1115",
    color: "#F8FAFC",
    fontVariantNumeric: "tabular-nums",
  },
  campoSufixo: {
    fontFamily: "'Inter', monospace",
    fontSize: 12,
    color: "#64748B",
    whiteSpace: "nowrap",
  },
  campoAjuda: { display: "block", fontSize: 12, color: "#475569", marginTop: 4, lineHeight: 1.4 },
  cotacao: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    margin: "-8px 0 16px",
    flexWrap: "wrap",
  },
  cotacaoInfo: {
    fontFamily: "'Inter', monospace",
    fontSize: 12,
    color: "#22C55E",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  },
  cotacaoPonto: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "#22C55E",
    flexShrink: 0,
    boxShadow: "0 0 6px #22C55E",
  },
  cotacaoErro: {
    fontFamily: "'Inter', monospace",
    fontSize: 12,
    color: "#EF4444",
  },
  cotacaoBtn: {
    border: "1px solid #334155",
    background: "#1A1D24",
    color: "#22C55E",
    fontFamily: "'Inter', monospace",
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
  alvoRotulo: {
    fontFamily: "'Inter', monospace",
    fontSize: 11,
    color: "#64748B",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  alvoSelect: {
    padding: "8px 12px",
    fontSize: 14,
    fontFamily: "'Inter', sans-serif",
    border: "1px solid #334155",
    borderRadius: 8,
    background: "#0F1115",
    color: "#F8FAFC",
  },
  btnGravando: {
    background: "#EF4444",
    color: "#FFFFFF",
    border: "1px solid #EF4444",
  },
  // Chat flutuante
  chatFab: {
    position: "fixed",
    right: 16,
    bottom: 84,
    width: 56,
    height: 56,
    borderRadius: "50%",
    border: "none",
    background: "linear-gradient(135deg, #22C55E, #16A34A)",
    fontSize: 22,
    cursor: "pointer",
    zIndex: 11,
    boxShadow: "0 4px 16px rgba(34,197,94,.4)",
  },
  chatPainel: {
    position: "fixed",
    right: 12,
    left: 12,
    bottom: 78,
    maxWidth: 420,
    margin: "0 0 0 auto",
    background: "#1A1D24",
    border: "1px solid #334155",
    borderRadius: 16,
    zIndex: 11,
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 8px 32px rgba(0,0,0,.6)",
    overflow: "hidden",
  },
  chatCabecalho: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    background: "#0F1115",
    borderBottom: "1px solid #334155",
    color: "#F8FAFC",
  },
  chatTitulo: { fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 14, color: "#F8FAFC" },
  chatFechar: {
    border: "none",
    background: "transparent",
    color: "#64748B",
    fontSize: 22,
    cursor: "pointer",
    lineHeight: 1,
  },
  chatAlvo: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 14px",
    borderBottom: "1px solid #1E293B",
    background: "#1A1D24",
  },
  chatMensagens: {
    padding: "12px 12px 4px",
    overflowY: "auto",
    maxHeight: "45vh",
    minHeight: 120,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  chatVazio: { fontSize: 13, color: "#475569", lineHeight: 1.5, margin: 0 },
  bolhaProdutor: {
    alignSelf: "flex-end",
    maxWidth: "85%",
    background: "#22C55E",
    color: "#0F1115",
    padding: "9px 13px",
    borderRadius: "14px 14px 2px 14px",
    fontSize: 14,
    lineHeight: 1.45,
    whiteSpace: "pre-wrap",
    fontWeight: 500,
  },
  bolhaGraocerto: {
    alignSelf: "flex-start",
    maxWidth: "85%",
    background: "#0F1115",
    color: "#CBD5E1",
    border: "1px solid #334155",
    padding: "9px 13px",
    borderRadius: "14px 14px 14px 2px",
    fontSize: 14,
    lineHeight: 1.45,
    whiteSpace: "pre-wrap",
  },
  bolhaAviso: { display: "block", marginTop: 6, fontSize: 11, color: "#EF4444" },
  chatEntradaLinha: {
    display: "flex",
    gap: 6,
    padding: "10px 12px",
    borderTop: "1px solid #1E293B",
    alignItems: "flex-end",
    background: "#0F1115",
  },
  chatEntrada: {
    flex: 1,
    minWidth: 0,
    padding: "9px 12px",
    fontSize: 15,
    fontFamily: "'Inter', sans-serif",
    border: "1px solid #334155",
    borderRadius: 10,
    background: "#1A1D24",
    color: "#F8FAFC",
    resize: "none",
  },
  chatBtnIcone: {
    border: "1px solid #334155",
    background: "#1A1D24",
    color: "#94A3B8",
    fontSize: 16,
    padding: "7px 10px",
    borderRadius: 8,
    cursor: "pointer",
  },
  chatEnviar: {
    border: "none",
    background: "#22C55E",
    color: "#0F1115",
    fontWeight: 700,
    fontSize: 16,
    padding: "7px 14px",
    borderRadius: 8,
    cursor: "pointer",
  },

  // Lotes
  loteBloco: { maxWidth: 980, margin: "24px auto 0" },
  loteCabecalho: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
    paddingBottom: 10,
    borderBottom: "1px solid #334155",
    flexWrap: "wrap",
  },
  loteTitulo: {
    fontFamily: "'Inter', monospace",
    fontSize: 13,
    fontWeight: 700,
    color: "#F8FAFC",
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
    background: "rgba(245,158,11,0.08)",
    border: "1px solid rgba(245,158,11,0.3)",
    borderRadius: 14,
    padding: "18px 20px 16px",
  },
  consolidadoSacas: {
    fontFamily: "'Inter', monospace",
    fontSize: 12,
    color: "#64748B",
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
    color: "#94A3B8",
    fontWeight: 700,
    marginBottom: 4,
  },
  consolidadoVeredito: {
    display: "block",
    fontSize: 24,
    fontWeight: 800,
    lineHeight: 1.1,
  },
  consolidadoNum: {
    display: "block",
    fontFamily: "'Inter', monospace",
    fontSize: 20,
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
  },
  consolidadoSub: { display: "block", fontSize: 12, color: "#64748B", marginTop: 2 },

  // Recomendação (frase logo abaixo do veredito)
  recomendacao: {
    marginTop: 14,
    padding: "14px 16px",
    background: "rgba(34,197,94,0.08)",
    borderLeft: "3px solid #22C55E",
    borderRadius: "0 10px 10px 0",
  },
  recomendacaoTexto: {
    margin: 0,
    fontSize: 15,
    lineHeight: 1.6,
    color: "#CBD5E1",
    fontWeight: 500,
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
    fontFamily: "'Inter', monospace",
    fontSize: 10,
    color: "#475569",
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
  recomendacaoConvite: { fontSize: 13, color: "#64748B" },
  recomendacaoBtn: {
    border: "1px solid #334155",
    background: "#1A1D24",
    color: "#22C55E",
    fontFamily: "'Inter', monospace",
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
    color: "#EF4444",
  },

  // Histórico
  alertaForm: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    columnGap: 12,
  },
  vendiBtn: {
    border: "1px solid #3E6B4F",
    background: "#EDF3EE",
    color: "#3E6B4F",
    fontFamily: "'Archivo', sans-serif",
    fontWeight: 700,
    fontSize: 13,
    padding: "6px 12px",
    borderRadius: 8,
    cursor: "pointer",
  },
  vendiForm: {
    background: "#EDF3EE",
    border: "1px solid #C6CFBF",
    borderRadius: 12,
    padding: "14px 16px 16px",
    marginBottom: 16,
  },
  desempenhoResumo: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: 10,
    marginBottom: 16,
  },
  desempenhoTile: {
    background: "#FFFDF6",
    border: "1px solid #E4E8DF",
    borderRadius: 10,
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  desempenhoNum: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontWeight: 700,
    fontSize: 22,
    color: "#1E2A22",
  },
  desempenhoRotulo: { fontSize: 12.5, color: "#5A6B5D", lineHeight: 1.4 },
  cardOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(30,42,34,.55)",
    zIndex: 60,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  cardCaixa: {
    background: "#F2F4EF",
    borderRadius: 14,
    padding: 14,
    maxWidth: 420,
    width: "100%",
    maxHeight: "92vh",
    overflowY: "auto",
    boxShadow: "0 12px 40px rgba(30,42,34,.35)",
  },
  cardCanvas: {
    width: "100%",
    height: "auto",
    borderRadius: 8,
    display: "block",
    border: "1px solid #C6CFBF",
  },
  cardAcoes: { display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" },
  historicoPainel: {
    maxWidth: 980,
    margin: "0 auto 20px",
    background: "#1A1D24",
    border: "1px solid #334155",
    borderRadius: 14,
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
    padding: "10px 0",
    borderBottom: "1px solid #1E293B",
  },
  simInfo: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  simData: {
    fontFamily: "'Inter', monospace",
    fontSize: 11,
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  simDesc: { fontSize: 14, color: "#CBD5E1" },
  simVeredito: { fontFamily: "'Inter', monospace", fontSize: 12, fontWeight: 600 },
  simAcoes: { display: "flex", gap: 6, flexShrink: 0 },
  simBtn: {
    border: "1px solid #334155",
    background: "#0F1115",
    color: "#22C55E",
    fontFamily: "'Inter', monospace",
    fontSize: 11,
    fontWeight: 600,
    padding: "5px 12px",
    borderRadius: 6,
    cursor: "pointer",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  simBtnExcluir: {
    border: "1px solid #334155",
    background: "#0F1115",
    color: "#EF4444",
    fontFamily: "'Inter', monospace",
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
    fontFamily: "'Inter', monospace",
    fontSize: 11,
    fontWeight: 600,
    color: "#64748B",
    textAlign: "right",
    padding: "6px 10px",
    borderBottom: "1px solid #334155",
    whiteSpace: "nowrap",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  compRotulo: {
    textAlign: "left",
    color: "#64748B",
    padding: "6px 10px 6px 0",
    whiteSpace: "nowrap",
    borderBottom: "1px solid #1E293B",
    fontSize: 13,
  },
  compValor: {
    fontFamily: "'Inter', monospace",
    textAlign: "right",
    padding: "6px 10px",
    whiteSpace: "nowrap",
    borderBottom: "1px solid #1E293B",
    color: "#CBD5E1",
    fontVariantNumeric: "tabular-nums",
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
    fontFamily: "'Inter', monospace",
    fontSize: 12,
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  perfilBarBtn: {
    border: "1px solid #334155",
    background: "#1A1D24",
    color: "#22C55E",
    fontFamily: "'Inter', monospace",
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
    background: "rgba(245,158,11,0.1)",
    border: "1px solid rgba(245,158,11,0.3)",
    borderRadius: 8,
    fontSize: 12,
    color: "#FCD34D",
  },
  btnSalvarSim: {
    border: "none",
    background: "#22C55E",
    color: "#0F1115",
    fontFamily: "'Inter', sans-serif",
    fontWeight: 700,
    fontSize: 14,
    padding: "11px 20px",
    borderRadius: 10,
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(34,197,94,.3)",
  },
  salvoFeedback: {
    fontFamily: "'Inter', monospace",
    fontSize: 12,
    color: "#22C55E",
  },
  formIntro: { margin: "0 0 16px", fontSize: 13, color: "#64748B", lineHeight: 1.5 },
  select: {
    width: "100%",
    padding: "11px 14px",
    fontSize: 16,
    fontFamily: "'Inter', sans-serif",
    border: "1px solid #334155",
    borderRadius: 10,
    background: "#0F1115",
    color: "#F8FAFC",
  },
  formAcoes: { display: "flex", gap: 10, marginTop: 8, marginBottom: 8, flexWrap: "wrap" },
  btnPrimario: {
    border: "none",
    background: "#22C55E",
    color: "#0F1115",
    fontFamily: "'Inter', sans-serif",
    fontWeight: 700,
    fontSize: 15,
    padding: "12px 24px",
    borderRadius: 10,
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(34,197,94,.3)",
  },
  btnSecundario: {
    border: "1px solid #334155",
    background: "#1A1D24",
    color: "#CBD5E1",
    fontFamily: "'Inter', sans-serif",
    fontWeight: 600,
    fontSize: 15,
    padding: "12px 20px",
    borderRadius: 10,
    cursor: "pointer",
  },
  ticket: {
    position: "relative",
    background: "#1A1D24",
    borderWidth: 1,
    borderStyle: "solid",
    borderRadius: 16,
    padding: "26px 24px 20px",
    marginBottom: 20,
    boxShadow: "0 4px 24px rgba(0,0,0,.4)",
  },
  ticketFuro: {
    position: "absolute",
    top: 16,
    right: 20,
    width: 14,
    height: 14,
    borderRadius: "50%",
    background: "#0F1115",
    border: "2px solid #334155",
  },
  ticketEyebrow: {
    fontFamily: "'Inter', monospace",
    fontSize: 11,
    letterSpacing: "0.14em",
    color: "#475569",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  ticketVeredito: {
    fontSize: "clamp(34px, 7vw, 52px)",
    fontWeight: 800,
    lineHeight: 1,
    letterSpacing: "-0.02em",
  },
  ticketAviso: {
    marginTop: 10,
    padding: "8px 12px",
    background: "rgba(245,158,11,0.1)",
    border: "1px solid rgba(245,158,11,0.3)",
    borderRadius: 8,
    fontSize: 13,
    color: "#FCD34D",
  },
  ticketDelta: { marginTop: 18, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" },
  ticketDeltaNum: {
    fontFamily: "'Inter', monospace",
    fontSize: 30,
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
  },
  ticketDeltaRotulo: { fontSize: 14, color: "#94A3B8" },
  ticketTotal: {
    fontFamily: "'Inter', monospace",
    fontSize: 15,
    marginTop: 4,
    color: "#CBD5E1",
    fontVariantNumeric: "tabular-nums",
  },
  ticketRodape: {
    marginTop: 16,
    paddingTop: 12,
    borderTop: "1px solid #1E293B",
    fontFamily: "'Inter', monospace",
    fontSize: 12,
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  sliderLinha: { display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10, flexWrap: "wrap" },
  sliderNum: { fontFamily: "'Inter', monospace", fontSize: 26, fontWeight: 700, color: "#F59E0B", fontVariantNumeric: "tabular-nums" },
  sliderRotulo: { fontSize: 13, color: "#64748B" },
  empate: {
    marginTop: 16,
    marginBottom: 8,
    padding: "14px 16px",
    background: "rgba(245,158,11,0.08)",
    borderLeft: "3px solid #F59E0B",
    borderRadius: "0 10px 10px 0",
  },
  empateRotulo: {
    display: "block",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: "#94A3B8",
    fontWeight: 700,
  },
  empateNum: {
    display: "block",
    fontFamily: "'Inter', monospace",
    fontSize: 22,
    fontWeight: 700,
    margin: "2px 0",
    color: "#F59E0B",
    fontVariantNumeric: "tabular-nums",
  },
  empateExpl: { display: "block", fontSize: 12, color: "#64748B" },
  contaSummary: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  contaSummaryDica: {
    fontFamily: "'Inter', monospace",
    fontSize: 11,
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  linha: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    padding: "8px 0",
    fontSize: 14,
    borderBottom: "1px solid #0F1115",
  },
  linhaRotulo: { color: "#94A3B8" },
  linhaValor: { fontFamily: "'Inter', monospace", whiteSpace: "nowrap", color: "#F8FAFC", fontVariantNumeric: "tabular-nums" },
  divisor: { borderTop: "1px solid #1E293B", margin: "8px 0" },
  aviso: {
    fontSize: 12,
    color: "#334155",
    lineHeight: 1.5,
    maxWidth: 980,
    margin: "0 auto",
  },
};
