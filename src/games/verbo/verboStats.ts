const STORAGE_KEY = "verbo-game-stats-v1";

export type GuessDistribution = Record<1 | 2 | 3 | 4 | 5 | 6, number>;

export interface VerboStatsSnapshot {
  totalGames: number;
  wins: number;
  losses: number;
  currentStreak: number;
  bestStreak: number;
  guessDistribution: GuessDistribution;
}

function emptyDistribution(): GuessDistribution {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
}

function defaultStats(): VerboStatsSnapshot {
  return {
    totalGames: 0,
    wins: 0,
    losses: 0,
    currentStreak: 0,
    bestStreak: 0,
    guessDistribution: emptyDistribution(),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function clampAttempt(n: number): keyof GuessDistribution {
  const x = Math.floor(n);
  if (x < 1) return 1;
  if (x > 6) return 6;
  return x as keyof GuessDistribution;
}

function normalize(raw: unknown): VerboStatsSnapshot {
  const base = defaultStats();
  if (!isRecord(raw)) return base;

  const totalGames = typeof raw.totalGames === "number" && Number.isFinite(raw.totalGames) ? Math.max(0, Math.floor(raw.totalGames)) : base.totalGames;
  const wins = typeof raw.wins === "number" && Number.isFinite(raw.wins) ? Math.max(0, Math.floor(raw.wins)) : base.wins;
  const losses = typeof raw.losses === "number" && Number.isFinite(raw.losses) ? Math.max(0, Math.floor(raw.losses)) : base.losses;
  const currentStreak =
    typeof raw.currentStreak === "number" && Number.isFinite(raw.currentStreak) ? Math.max(0, Math.floor(raw.currentStreak)) : base.currentStreak;
  const bestStreak =
    typeof raw.bestStreak === "number" && Number.isFinite(raw.bestStreak) ? Math.max(0, Math.floor(raw.bestStreak)) : base.bestStreak;

  const distIn = isRecord(raw.guessDistribution) ? raw.guessDistribution : null;
  const guessDistribution = emptyDistribution();
  if (distIn) {
    for (let i = 1; i <= 6; i++) {
      const k = String(i);
      const v = distIn[k];
      guessDistribution[i as keyof GuessDistribution] =
        typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
    }
  }

  return { totalGames, wins, losses, currentStreak, bestStreak, guessDistribution };
}

function readStorage(): VerboStatsSnapshot {
  if (typeof window === "undefined") return defaultStats();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultStats();
    return normalize(JSON.parse(raw) as unknown);
  } catch {
    return defaultStats();
  }
}

function writeStorage(stats: VerboStatsSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Lê estatísticas persistidas (ou valores iniciais). */
export function loadVerboStats(): VerboStatsSnapshot {
  return readStorage();
}

/** Vitória: atualiza contadores, sequência e distribuição pela tentativa (1–6). */
export function recordWin(attempt: number): VerboStatsSnapshot {
  const prev = readStorage();
  const key = clampAttempt(attempt);
  const nextStreak = prev.currentStreak + 1;
  const next: VerboStatsSnapshot = {
    ...prev,
    totalGames: prev.totalGames + 1,
    wins: prev.wins + 1,
    currentStreak: nextStreak,
    bestStreak: Math.max(prev.bestStreak, nextStreak),
    guessDistribution: {
      ...prev.guessDistribution,
      [key]: prev.guessDistribution[key] + 1,
    },
  };
  writeStorage(next);
  return next;
}

/** Derrota: incrementa jogos e perdas; zera sequência atual. */
export function recordLoss(): VerboStatsSnapshot {
  const prev = readStorage();
  const next: VerboStatsSnapshot = {
    ...prev,
    totalGames: prev.totalGames + 1,
    losses: prev.losses + 1,
    currentStreak: 0,
  };
  writeStorage(next);
  return next;
}

/** Maior valor na distribuição (para barras relativas). */
export function maxGuessCount(dist: GuessDistribution): number {
  return Math.max(1, ...([1, 2, 3, 4, 5, 6] as const).map((k) => dist[k]));
}
