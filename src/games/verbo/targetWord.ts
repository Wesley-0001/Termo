export const WORDS = ["TERMO", "CASAS", "VERDE", "FORTE", "NIVEL"];

export function getWordOfTheDay(): string {
  const today = new Date().toDateString();
  let hash = 0;

  for (let i = 0; i < today.length; i++) {
    hash += today.charCodeAt(i);
  }

  return WORDS[hash % WORDS.length];
}

export function getRandomWord(): string {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}
