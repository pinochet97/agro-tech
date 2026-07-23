// ─────────────────────────────────────────────────────────────
// Perfil persistente do produtor — GrãoCerto Fase 1
//
// Na primeira simulação o produtor informa região, cultura principal,
// custos e capacidade de armazenagem. A partir daí tudo vem
// pré-preenchido e ele só ajusta o que mudou. Cada simulação salva
// atualiza o perfil.
//
// Persistência: localStorage (passo 4 do CLAUDE.md — "começar com
// backend leve ou local"). Quando existir backend com contas, este
// módulo vira a camada de sincronização; a forma do dado já antecipa
// isso (objeto único versionado).
// ─────────────────────────────────────────────────────────────

const CHAVE = "graocerto.perfil.v1";

// Defaults regionais de custos — valores de REFERÊNCIA, sempre editáveis
// pelo produtor. Armazenagem varia com a infraestrutura local; o custo do
// dinheiro não é regional (mantido igual); perda técnica sobe um pouco no
// MATOPIBA (clima mais quente na colheita).
export const REGIOES = {
  MT: { nome: "Mato Grosso", custos: { armazenagem: 1.0, jurosMes: 1.1, perdaMes: 0.25 } },
  MS: { nome: "Mato Grosso do Sul", custos: { armazenagem: 1.1, jurosMes: 1.1, perdaMes: 0.25 } },
  GO: { nome: "Goiás", custos: { armazenagem: 1.1, jurosMes: 1.1, perdaMes: 0.25 } },
  PR: { nome: "Paraná", custos: { armazenagem: 1.2, jurosMes: 1.1, perdaMes: 0.25 } },
  RS: { nome: "Rio Grande do Sul", custos: { armazenagem: 1.3, jurosMes: 1.1, perdaMes: 0.25 } },
  MATOPIBA: { nome: "MATOPIBA (MA/TO/PI/BA)", custos: { armazenagem: 1.2, jurosMes: 1.1, perdaMes: 0.3 } },
  OUTRA: { nome: "Outra região", custos: { armazenagem: 1.2, jurosMes: 1.1, perdaMes: 0.25 } },
};

export function defaultsDaRegiao(regiao) {
  return (REGIOES[regiao] || REGIOES.OUTRA).custos;
}

// Devolve o perfil salvo ou null (primeira visita / storage indisponível).
export function carregarPerfil() {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return null;
    const p = JSON.parse(bruto);
    // saneamento mínimo: precisa de região e custos numéricos
    if (!p || typeof p !== "object" || !p.regiao || !p.custos) return null;
    return p;
  } catch {
    return null; // storage bloqueado (modo privado etc.) → segue sem perfil
  }
}

export function salvarPerfil(perfil) {
  const completo = { versao: 1, ...perfil, atualizadoEm: new Date().toISOString() };
  try {
    localStorage.setItem(CHAVE, JSON.stringify(completo));
  } catch {
    // storage indisponível: o app continua funcionando, só não persiste
  }
  return completo;
}

// Mescla campos no perfil existente (ou cria um) e persiste.
export function atualizarPerfil(parcial) {
  const atual = carregarPerfil() || {};
  return salvarPerfil({
    ...atual,
    ...parcial,
    custos: { ...atual.custos, ...parcial.custos },
  });
}
