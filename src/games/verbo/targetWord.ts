export const WORDS = {
  easy: [
    "CASAL",
    "AMIGO",
    "NOITE",
    "VENTO",
    "LIVRO",
    "CAMPO",
    "PRAIA",
    "JOGAR",
    "FALAR",
    "TEMPO",
  ],
  medium: [
    "TERMO",
    "NIVEL",
    "LETRA",
    "TEXTO",
    "PLANO",
    "GRUPO",
    "VALOR",
    "LINHA",
    "PONTO",
    "PORTA",
    "CAIXA",
    "SINAL",
    "FORTE",
    "FRACO",
    "PROVA",
    "MOTOR",
    "IDEIA",
    "NORTE",
    "SULCO",
    "AULAS",
  ],
  hard: [
    "TENAZ",
    "FUGAZ",
    "NEXOS",
    "SUTIL",
    "ARDOR",
    "VIGOR",
    "CRIVO",
    "PLENO",
    "TRAMA",
    "DENSO",
    "RISCO",
    "ASTRO",
    "MAGIA",
    "LIMPO",
    "NOBRE",
    "TERNO",
    "MORAL",
    "VITAL",
    "FINAL",
    "JUSTO",
  ],
} as const;

export type Difficulty = keyof typeof WORDS;

export function pickRandomWord(difficulty: Difficulty): string {
  const list = WORDS[difficulty];
  const index = Math.floor(Math.random() * list.length);
  return list[index];
}
