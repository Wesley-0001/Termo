import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";
import { pickRandomWord, type Difficulty } from "./targetWord";
import { loadVerboStats, maxGuessCount, recordLoss, recordWin } from "./verboStats";
import type { VerboStatsSnapshot } from "./verboStats";
import TermoStarfield from "./TermoStarfield";
import VerboWebField from "./VerboWebField";
import "./verbo.css";

const ROWS = 6;
const COLS = 5;

/** Duração do flip por tile (ms) — alinhada a `termo-tile-flip` em verbo.css */
const FLIP_DURATION_MS = 550;
/** Atraso em cascata entre tiles (ms) — `--termo-flip-stagger` */
const FLIP_STAGGER_MS = 150;

type LetterState = "correct" | "present" | "absent";
type KeyHint = "correct" | "present" | "absent" | null;

const ROWS_KB = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["ENTER", "Z", "X", "C", "V", "B", "N", "M", "BACK"],
];

const WIN_REACTION_TITLES = ["Boa!", "Mandou bem!", "Impressionante!", "Brabo!"] as const;
const LOSE_REACTION_TITLES = ["Quase!", "Não foi dessa vez", "Tenta mais uma"] as const;

/** Farpas leves no modo fácil após vitória rápida (1–3 tentativas) — só exibição, não altera regras. */
const EASY_WIN_TEASE_MESSAGES = [
  "foi fácil demais...",
  "bora subir o nível?",
  "isso foi só aquecimento",
  "você consegue mais",
  "modo passeio?",
  "ou você joga sério?",
] as const;

function pickReaction<T extends readonly string[]>(arr: T): T[number] {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function pickEasyWinTease(): string {
  return pickReaction(EASY_WIN_TEASE_MESSAGES);
}

type ResultPanelState =
  | { outcome: "won"; title: string; attempt: number; secret: string }
  | { outcome: "lost"; title: string; secret: string };

function emptyLetters(): string[] {
  return Array(COLS).fill("");
}

function evaluateGuess(guess: string, target: string): LetterState[] {
  const g = guess.toUpperCase().split("");
  const t = target.toUpperCase().split("");
  const state: LetterState[] = Array(COLS).fill("absent");

  for (let i = 0; i < COLS; i++) {
    if (g[i] === t[i]) state[i] = "correct";
  }

  const counts = new Map<string, number>();
  for (let i = 0; i < COLS; i++) {
    if (state[i] !== "correct") {
      const c = t[i];
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }

  for (let i = 0; i < COLS; i++) {
    if (state[i] === "correct") continue;
    const ch = g[i];
    const n = counts.get(ch) ?? 0;
    if (n > 0) {
      state[i] = "present";
      counts.set(ch, n - 1);
    }
  }

  return state;
}

/**
 * Valida tentativa (5 letras) e devolve feedback por posição (verde / amarelo / cinza).
 * Usa a mesma regra que o Wordle para letras repetidas (`evaluateGuess`).
 */
function checkGuess(guess: string, secret: string): LetterState[] | null {
  if (guess.length !== 5) return null;
  return evaluateGuess(guess, secret);
}

function rankHint(a: KeyHint, b: LetterState): KeyHint {
  const order = { absent: 0, present: 1, correct: 2 };
  const br = b;
  if (!a) return br;
  return order[a] >= order[br] ? a : br;
}

/** Espelho do estado do jogo para depuração e próximos passos (menu / novo jogo / dificuldade). */
const initialGameState = {
  difficulty: "easy" as Difficulty,
  secretWord: "",
  currentRow: 0,
  guesses: ["", "", "", "", "", ""] as string[],
  status: "playing" as "playing" | "won" | "lost",
};

export default function VerboGame() {
  const verboRootRef = useRef<HTMLDivElement>(null);
  const revealTimersRef = useRef<number[]>([]);
  const gameStateRef = useRef({ ...initialGameState });
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [target, setTarget] = useState(() => {
    const w = pickRandomWord("easy");
    console.log("Palavra secreta:", w);
    return w;
  });
  const [showRules, setShowRules] = useState(true);
  const [grid, setGrid] = useState<string[][]>(() =>
    Array.from({ length: ROWS }, () => Array(COLS).fill(""))
  );
  const [evaluated, setEvaluated] = useState<(LetterState | null)[][]>(() =>
    Array.from({ length: ROWS }, () => Array(COLS).fill(null))
  );
  /** Linha ativa (0–5). Linhas anteriores ficam travadas em `grid` + `evaluated`. */
  const [currentRow, setCurrentRow] = useState(0);
  /** Edição da linha atual: letras por posição + cursor (estilo Termo). */
  const [rowDraft, setRowDraft] = useState(() => ({
    letters: emptyLetters(),
    cursorIndex: 0,
  }));
  const [keyHints, setKeyHints] = useState<Record<string, KeyHint>>({});
  const [status, setStatus] = useState<"playing" | "won" | "lost">("playing");
  const [message, setMessage] = useState("");
  const [shakeRow, setShakeRow] = useState<number | null>(null);
  /** Linha em revelação com flip (null = nenhuma animação ativa). */
  const [revealingRow, setRevealingRow] = useState<number | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [verboStats, setVerboStats] = useState<VerboStatsSnapshot>(() => loadVerboStats());
  const [resultPanel, setResultPanel] = useState<ResultPanelState | null>(null);
  /** HARD: feedback visual (CSS) — não altera regras do jogo */
  const [hardWrongFlash, setHardWrongFlash] = useState(false);
  const [hardGridPulse, setHardGridPulse] = useState(false);
  /** HARD: tentativas erradas na partida — pressão acumulada do tema (0–5 exposto em data-pressure) */
  const [hardWrongCount, setHardWrongCount] = useState(0);
  /** EASY: provocação sutil após vitória em poucas tentativas (só UI). */
  const [easyWinTease, setEasyWinTease] = useState<string | null>(null);

  const isPlaying = status === "playing";
  const inputLocked = revealingRow !== null;
  const showResultModal = !showRules && (status === "won" || status === "lost");

  const clearRevealTimers = useCallback(() => {
    for (const id of revealTimersRef.current) {
      window.clearTimeout(id);
    }
    revealTimersRef.current = [];
  }, []);

  const startGame = useCallback((nextDifficulty?: Difficulty) => {
    clearRevealTimers();
    setRevealingRow(null);
    const d = nextDifficulty !== undefined ? nextDifficulty : difficulty;
    if (nextDifficulty !== undefined && nextDifficulty !== difficulty) {
      setDifficulty(nextDifficulty);
    }
    const secret = pickRandomWord(d);
    setTarget(secret);
    console.log("Palavra secreta:", secret);
    setGrid(Array.from({ length: ROWS }, () => Array(COLS).fill("")));
    setEvaluated(Array.from({ length: ROWS }, () => Array(COLS).fill(null)));
    setCurrentRow(0);
    setRowDraft({ letters: emptyLetters(), cursorIndex: 0 });
    setKeyHints({});
    setStatus("playing");
    setMessage("");
    setShakeRow(null);
    setResultPanel(null);
    setHardWrongFlash(false);
    setHardGridPulse(false);
    setHardWrongCount(0);
    setEasyWinTease(null);
  }, [clearRevealTimers, difficulty]);

  const onPlayAgainClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      console.log("[Verbo] Jogar novamente");
      startGame();
    },
    [startGame]
  );

  useEffect(() => {
    const guesses = Array.from({ length: ROWS }, (_, r) => {
      if (r < currentRow) return grid[r].join("");
      if (r === currentRow) return rowDraft.letters.join("");
      return "";
    });
    gameStateRef.current = {
      difficulty,
      secretWord: target,
      currentRow,
      guesses,
      status,
    };
  }, [difficulty, target, currentRow, grid, rowDraft, status]);

  /** Expõe controles para menu / novo jogo (desktop/mobile) sem alterar o markup. */
  useEffect(() => {
    const root = verboRootRef.current;
    if (!root) return;
    const controls = { setDifficulty, startGame, getGameState: () => gameStateRef.current };
    (root as HTMLElement & { __termo?: typeof controls }).__termo = controls;
    return () => {
      delete (root as HTMLElement & { __termo?: typeof controls }).__termo;
    };
  }, [setDifficulty, startGame]);

  useEffect(() => {
    if (!isMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMenuOpen]);

  const updateKeyHints = useCallback((guess: string, states: LetterState[]) => {
    setKeyHints((prev) => {
      const next = { ...prev };
      for (let i = 0; i < COLS; i++) {
        const letter = guess[i];
        next[letter] = rankHint(next[letter] ?? null, states[i]);
      }
      return next;
    });
  }, []);

  const submitGuess = useCallback(() => {
    if (!isPlaying || showRules || inputLocked) return;
    const letters = rowDraft.letters;
    const guess = letters.join("");
    const complete = letters.every((ch) => ch.length > 0);
    if (!complete || guess.length !== COLS) {
      setMessage("Palavra incompleta.");
      setShakeRow(currentRow);
      window.setTimeout(() => setShakeRow(null), 400);
      return;
    }

    const states = checkGuess(guess, target);
    if (!states) return;
    const row = currentRow;

    const finalizeGuess = () => {
      updateKeyHints(guess, states);

      const motionOk =
        typeof window === "undefined" ||
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (difficulty === "hard" && motionOk) {
        if (guess !== target) {
          setHardWrongFlash(true);
          window.setTimeout(() => setHardWrongFlash(false), 220);
        }
        if (states.some((s) => s === "correct")) {
          setHardGridPulse(true);
          window.setTimeout(() => setHardGridPulse(false), 420);
        }
      }

      if (guess === target) {
        const attempt = row + 1;
        setVerboStats(recordWin(attempt));
        setResultPanel({
          outcome: "won",
          title: pickReaction(WIN_REACTION_TITLES),
          attempt,
          secret: target,
        });
        if (difficulty === "easy" && attempt >= 1 && attempt <= 3) {
          setEasyWinTease(pickEasyWinTease());
        }
        setStatus("won");
        setRowDraft({ letters: emptyLetters(), cursorIndex: 0 });
        return;
      }
      if (difficulty === "hard") {
        setHardWrongCount((n) => n + 1);
      }
      if (row === ROWS - 1) {
        setVerboStats(recordLoss());
        setResultPanel({
          outcome: "lost",
          title: pickReaction(LOSE_REACTION_TITLES),
          secret: target,
        });
        setStatus("lost");
        setRowDraft({ letters: emptyLetters(), cursorIndex: 0 });
        return;
      }
      setCurrentRow((r) => r + 1);
      setRowDraft({ letters: emptyLetters(), cursorIndex: 0 });
      setMessage("");
    };

    setGrid((g) => {
      const next = g.map((r) => [...r]);
      const chars = guess.split("");
      for (let i = 0; i < COLS; i++) next[row][i] = chars[i];
      return next;
    });

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion) {
      setEvaluated((ev) => {
        const copy = ev.map((r) => [...r]);
        copy[row] = states;
        return copy;
      });
      finalizeGuess();
      return;
    }

    clearRevealTimers();
    setEvaluated((ev) => {
      const copy = ev.map((r) => [...r]);
      copy[row] = Array(COLS).fill(null);
      return copy;
    });
    setRevealingRow(row);

    const midpoint = FLIP_DURATION_MS * 0.5;
    for (let c = 0; c < COLS; c++) {
      const id = window.setTimeout(() => {
        setEvaluated((ev) => {
          const copy = ev.map((r) => [...r]);
          copy[row][c] = states[c];
          return copy;
        });
      }, c * FLIP_STAGGER_MS + midpoint);
      revealTimersRef.current.push(id);
    }

    const totalMs = (COLS - 1) * FLIP_STAGGER_MS + FLIP_DURATION_MS;
    const doneId = window.setTimeout(() => {
      revealTimersRef.current = [];
      setRevealingRow(null);
      finalizeGuess();
    }, totalMs);
    revealTimersRef.current.push(doneId);
  }, [
    rowDraft,
    currentRow,
    isPlaying,
    showRules,
    target,
    updateKeyHints,
    inputLocked,
    clearRevealTimers,
    difficulty,
  ]);

  useEffect(() => {
    return () => clearRevealTimers();
  }, [clearRevealTimers]);

  const addLetter = useCallback(
    (letter: string) => {
      if (!isPlaying || showRules || inputLocked) return;
      const L = letter.toUpperCase();
      setRowDraft((d) => {
        const nextLetters = [...d.letters];
        nextLetters[d.cursorIndex] = L;
        const nextCursor = Math.min(d.cursorIndex + 1, COLS - 1);
        return { letters: nextLetters, cursorIndex: nextCursor };
      });
      setMessage("");
    },
    [isPlaying, showRules, inputLocked]
  );

  const backspace = useCallback(() => {
    if (!isPlaying || showRules || inputLocked) return;
    setRowDraft((d) => {
      const nextLetters = [...d.letters];
      let { cursorIndex } = d;
      if (nextLetters[cursorIndex]) {
        nextLetters[cursorIndex] = "";
      } else if (cursorIndex > 0) {
        cursorIndex -= 1;
        nextLetters[cursorIndex] = "";
      }
      return { letters: nextLetters, cursorIndex };
    });
    setMessage("");
  }, [isPlaying, showRules, inputLocked]);

  const moveCursor = useCallback(
    (delta: -1 | 1) => {
      if (!isPlaying || showRules || inputLocked) return;
      setRowDraft((d) => ({
        ...d,
        cursorIndex: Math.min(COLS - 1, Math.max(0, d.cursorIndex + delta)),
      }));
    },
    [isPlaying, showRules, inputLocked]
  );

  const focusCell = useCallback(
    (col: number) => {
      if (!isPlaying || showRules || inputLocked) return;
      setRowDraft((d) => ({
        ...d,
        cursorIndex: Math.min(COLS - 1, Math.max(0, col)),
      }));
    },
    [isPlaying, showRules, inputLocked]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (showRules) return;
      if (status !== "playing") return;
      if (inputLocked) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === "Enter") {
        e.preventDefault();
        submitGuess();
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        backspace();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        moveCursor(-1);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        moveCursor(1);
        return;
      }
      if (/^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault();
        addLetter(e.key);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addLetter, backspace, moveCursor, showRules, submitGuess, inputLocked, status]);

  const onVirtualKey = (key: string) => {
    if (status !== "playing") return;
    if (inputLocked) return;
    if (key === "ENTER") {
      submitGuess();
      return;
    }
    if (key === "BACK") {
      backspace();
      return;
    }
    addLetter(key);
  };

  const keyClass = (k: string) => {
    if (k === "ENTER" || k === "BACK") return "verbo__key verbo__key--wide";
    const hint = keyHints[k];
    const extra =
      hint === "correct"
        ? " verbo__key--correct"
        : hint === "present"
          ? " verbo__key--present"
          : hint === "absent"
            ? " verbo__key--absent"
            : "";
    return `verbo__key${extra}`;
  };

  /** Letra exibida: linhas enviadas vêm de `grid`; a linha ativa vem de `rowDraft.letters`. */
  const cellChar = (r: number, c: number) => {
    if (r < currentRow) return grid[r][c];
    if (r === currentRow) return rowDraft.letters[c] ?? "";
    return "";
  };

  const isEditingRow = (r: number) =>
    r === currentRow && isPlaying && !showRules && revealingRow !== r;

  const cellClass = (r: number, c: number) => {
    const ch = cellChar(r, c);
    const ev = evaluated[r][c];
    let base = "verbo__cell";
    if (ch) base += " verbo__cell--filled";
    if (isEditingRow(r)) {
      base += " verbo__cell--active-row";
    }
    if (isEditingRow(r) && c === rowDraft.cursorIndex) {
      base += " verbo__cell--cursor";
    }
    if (revealingRow === r) base += " verbo__cell--flip";
    if (ev === "correct") base += " verbo__cell--correct";
    else if (ev === "present") base += " verbo__cell--present";
    else if (ev === "absent") base += " verbo__cell--absent";
    return base;
  };

  const onCellClick = (r: number, c: number) => {
    if (r !== currentRow || !isPlaying || showRules || inputLocked) return;
    focusCell(c);
  };

  const closeMenu = () => setIsMenuOpen(false);

  const onMenuNewGame = () => {
    startGame();
    closeMenu();
  };

  const onMenuDifficulty = (d: Difficulty) => {
    startGame(d);
    closeMenu();
  };

  const guessDistMax = maxGuessCount(verboStats.guessDistribution);

  /** 0–5: erros reais na rodada; escala visual 0–1 (5 erros = pressão máxima) */
  const hardPressureLevel = difficulty === "hard" ? Math.min(hardWrongCount, 5) : 0;
  const hardTension = difficulty === "hard" ? hardPressureLevel / 5 : 0;
  const hardClutch = difficulty === "hard" && currentRow >= ROWS - 2 ? 1 : 0;

  return (
    <div
      className={[
        "verbo",
        difficulty === "hard" && hardWrongFlash ? "verbo--hard-wrong-flash" : "",
        difficulty === "hard" && hardGridPulse ? "verbo--hard-grid-pulse" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      ref={verboRootRef}
      data-difficulty={difficulty}
      data-theme={difficulty}
      data-game-status={status}
      {...(difficulty === "hard"
        ? {
            "data-pressure": String(hardPressureLevel),
            style: {
              "--verbo-hard-tension": hardTension,
              "--verbo-hard-clutch": hardClutch,
            } as CSSProperties,
          }
        : {})}
    >
      {difficulty === "easy" && <TermoStarfield containerRef={verboRootRef} />}
      {difficulty === "medium" && <VerboWebField containerRef={verboRootRef} />}
      {difficulty === "hard" && (
        <div className="verbo__hardfield" aria-hidden>
          <div className="verbo__hardfield-spikes" />
          <div className="verbo__hardfield-ghost">
            <svg
              className="verbo__hardfield-sub"
              viewBox="0 0 520 200"
              preserveAspectRatio="xMidYMid slice"
              xmlns="http://www.w3.org/2000/svg"
            >
              <g
                className="verbo__hardfield-sub-frag verbo__hardfield-sub-frag--a"
                fill="rgba(155, 82, 92, 0.45)"
              >
                <text x="8" y="72" fontSize="38" fontWeight="700" fontFamily="system-ui,Segoe UI,sans-serif">
                  ta
                </text>
              </g>
              <g
                className="verbo__hardfield-sub-frag verbo__hardfield-sub-frag--b"
                fill="rgba(120, 160, 185, 0.35)"
              >
                <text x="380" y="150" fontSize="31" fontWeight="600" fontFamily="system-ui,Segoe UI,sans-serif">
                  dif
                </text>
              </g>
              <g
                className="verbo__hardfield-sub-frag verbo__hardfield-sub-frag--c"
                fill="rgba(140, 95, 88, 0.4)"
              >
                <text x="118" y="188" fontSize="26" fontWeight="600" fontFamily="system-ui,Segoe UI,sans-serif">
                  cil
                </text>
              </g>
            </svg>
          </div>
        </div>
      )}
      {showRules && (
        <div className="verbo__backdrop" role="dialog" aria-modal="true" aria-labelledby="termo-rules-title">
          <div className="verbo__modal">
            <div className="verbo__modal-brand" aria-hidden>
              TERMO
            </div>
            <h2 id="termo-rules-title">Como jogar</h2>
            <p className="verbo__modal-lead">Adivinhe a palavra de 5 letras em até 6 tentativas.</p>
            <p className="verbo__modal-hint">Após cada palpite, as casas mudam de cor:</p>
            <ul className="verbo__rules">
              <li className="verbo__rule">
                <span className="verbo__swatch verbo__swatch--correct" aria-hidden />
                <span>
                  <strong>Verde</strong> — letra correta na posição certa.
                </span>
              </li>
              <li className="verbo__rule">
                <span className="verbo__swatch verbo__swatch--present" aria-hidden />
                <span>
                  <strong>Amarelo</strong> — letra existe na palavra, em outra posição.
                </span>
              </li>
              <li className="verbo__rule">
                <span className="verbo__swatch verbo__swatch--absent" aria-hidden />
                <span>
                  <strong>Cinza</strong> — letra não aparece na palavra.
                </span>
              </li>
            </ul>
            <p className="verbo__modal-foot">
              Clique na linha atual ou use as setas para escolher a casa. Enter envia quando as 5 letras
              estiverem preenchidas; Backspace apaga.
            </p>
            <button type="button" className="verbo__start" onClick={() => setShowRules(false)}>
              Começar
            </button>
          </div>
        </div>
      )}

      <div className="verbo__stage">
        <header className="verbo__header">
          <div className="verbo__header-toolbar">
            <span className="verbo__header-toolbar-spacer" aria-hidden />
            <h1 className="verbo__title">TERMO</h1>
            <div className="verbo__header-toolbar-end">
              <div className="verbo__menu-root">
                <button
                  type="button"
                  className="verbo__menu-trigger"
                  aria-expanded={isMenuOpen}
                  aria-controls="verbo-game-menu"
                  aria-haspopup="true"
                  aria-label={isMenuOpen ? "Fechar menu do jogo" : "Abrir menu do jogo"}
                  onClick={() => setIsMenuOpen((o) => !o)}
                >
                  <span className="verbo__menu-icon verbo__menu-icon--hamburger" aria-hidden>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M4 7h16M4 12h16M4 17h16"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                  <span className="verbo__menu-icon verbo__menu-icon--gear" aria-hidden>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.06a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.06a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.06a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
                        stroke="currentColor"
                        strokeWidth="1.35"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </button>
              </div>
            </div>
          </div>
        </header>

        {isMenuOpen && (
          <div className="verbo__menu-layer">
            <div className="verbo__menu-backdrop" aria-hidden onClick={closeMenu} />
            <div
              id="verbo-game-menu"
              className="verbo__menu-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="verbo-menu-title"
            >
              <h2 id="verbo-menu-title" className="verbo__menu-title">
                Menu
              </h2>
              <div className="verbo__menu-actions">
                <button type="button" className="verbo__menu-btn verbo__menu-btn--primary" onClick={onMenuNewGame}>
                  Novo jogo
                </button>
              </div>
              <p className="verbo__menu-label">Dificuldade</p>
              <div className="verbo__menu-diff" role="group" aria-label="Dificuldade">
                {(
                  [
                    { id: "easy" as const, label: "Fácil" },
                    { id: "medium" as const, label: "Médio" },
                    { id: "hard" as const, label: "Difícil" },
                  ] as const
                ).map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    className={
                      difficulty === id ? "verbo__menu-chip verbo__menu-chip--active" : "verbo__menu-chip"
                    }
                    aria-pressed={difficulty === id}
                    onClick={() => onMenuDifficulty(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <details className="verbo__menu-howto">
                <summary className="verbo__menu-howto-summary">Como jogar</summary>
                <div className="verbo__menu-howto-body">
                  <p>Descubra a palavra de 5 letras em 6 tentativas.</p>
                  <ul>
                    <li>
                      <strong>Verde</strong> — letra certa no lugar certo.
                    </li>
                    <li>
                      <strong>Amarelo</strong> — letra existe, mas está em outro lugar.
                    </li>
                    <li>
                      <strong>Cinza</strong> — letra não existe na palavra.
                    </li>
                  </ul>
                </div>
              </details>
              <button type="button" className="verbo__menu-btn verbo__menu-btn--ghost" onClick={closeMenu}>
                Fechar menu
              </button>
            </div>
          </div>
        )}

        <div className="verbo__game-wrapper">
          <div className="verbo__board-shell">
            <div
              className="verbo__grid"
              role="grid"
              aria-label="Grade de tentativas"
              aria-busy={inputLocked}
            >
              {Array.from({ length: ROWS }, (_, r) => (
                <div
                  key={r}
                  className={
                    shakeRow === r
                      ? "verbo__row verbo__row--shake"
                      : revealingRow === r
                        ? "verbo__row verbo__row--flip-reveal"
                        : "verbo__row"
                  }
                  role="row"
                >
                  {Array.from({ length: COLS }, (_, c) => {
                    const label = cellChar(r, c) || "vazio";
                    return (
                      <div
                        key={c}
                        role="gridcell"
                        tabIndex={-1}
                        className={cellClass(r, c)}
                        aria-label={label}
                        style={
                          revealingRow === r
                            ? ({
                                "--termo-flip-i": c,
                                "--termo-flip-dur": `${FLIP_DURATION_MS}ms`,
                                "--termo-flip-stagger": `${FLIP_STAGGER_MS}ms`,
                              } as CSSProperties)
                            : undefined
                        }
                        onClick={() => onCellClick(r, c)}
                      >
                        {cellChar(r, c)}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {isPlaying && (
            <p
              className={`verbo__message${message.includes("incompleta") ? " verbo__message--error" : ""}`}
            >
              {message}
            </p>
          )}

          <div className="verbo__keyboard">
            {ROWS_KB.map((line, i) => (
              <div key={i} className="verbo__kb-row">
                {line.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={keyClass(k)}
                    disabled={!isPlaying || showRules || inputLocked}
                    onClick={() => onVirtualKey(k)}
                  >
                    {k === "BACK" ? "⌫" : k}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {showResultModal && resultPanel && (
        <div
          className="verbo__backdrop verbo__backdrop--result verbo__backdrop--result-enter"
          role="dialog"
          aria-modal="true"
          aria-labelledby="termo-result-title"
        >
          <div className="verbo__modal verbo__modal--result verbo__modal--result-enter">
            <div className="verbo__modal-brand" aria-hidden>
              TERMO
            </div>
            <h2
              id="termo-result-title"
              className={
                resultPanel.outcome === "won"
                  ? "verbo__result-title verbo__result-title--win"
                  : "verbo__result-title verbo__result-title--lose"
              }
            >
              {resultPanel.title}
            </h2>
            {resultPanel.outcome === "won" ? (
              <>
                <p className="verbo__result-sub verbo__result-sub--emph">
                  Você acertou em {resultPanel.attempt}{" "}
                  {resultPanel.attempt === 1 ? "tentativa" : "tentativas"}
                </p>
                <p className="verbo__result-main">
                  Palavra certa: <strong>{resultPanel.secret}</strong>
                </p>
              </>
            ) : (
              <p className="verbo__result-main verbo__result-main--lose">
                A palavra era: <strong>{resultPanel.secret}</strong>
              </p>
            )}

            <section className="verbo__result-stats" aria-label="Estatísticas">
              <p className="verbo__result-stats-heading">Resumo</p>
              <div className="verbo__result-stats-grid">
                <div className="verbo__result-stat">
                  <span className="verbo__result-stat-value">{verboStats.totalGames}</span>
                  <span className="verbo__result-stat-label">Jogos</span>
                </div>
                <div className="verbo__result-stat">
                  <span className="verbo__result-stat-value verbo__result-stat-value--win">{verboStats.wins}</span>
                  <span className="verbo__result-stat-label">Vitórias</span>
                </div>
                <div className="verbo__result-stat">
                  <span className="verbo__result-stat-value verbo__result-stat-value--lose">{verboStats.losses}</span>
                  <span className="verbo__result-stat-label">Derrotas</span>
                </div>
                <div className="verbo__result-stat">
                  <span className="verbo__result-stat-value">{verboStats.currentStreak}</span>
                  <span className="verbo__result-stat-label">Sequência</span>
                </div>
                <div className="verbo__result-stat">
                  <span className="verbo__result-stat-value">{verboStats.bestStreak}</span>
                  <span className="verbo__result-stat-label">Melhor seq.</span>
                </div>
              </div>
              <p className="verbo__result-dist-heading">Vitórias por tentativa</p>
              <ul className="verbo__result-dist" aria-label="Distribuição de vitórias por número de tentativas">
                {([1, 2, 3, 4, 5, 6] as const).map((n) => {
                  const count = verboStats.guessDistribution[n];
                  const pct = guessDistMax > 0 ? Math.round((count / guessDistMax) * 100) : 0;
                  return (
                    <li key={n} className="verbo__result-dist-row">
                      <span className="verbo__result-dist-n">{n}</span>
                      <div className="verbo__result-dist-track" aria-hidden>
                        <div
                          className="verbo__result-dist-fill"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="verbo__result-dist-count">{count}</span>
                    </li>
                  );
                })}
              </ul>
            </section>

            <div className="verbo__modal-actions">
              {resultPanel.outcome === "won" && easyWinTease && (
                <p
                  className="verbo__easy-win-tease"
                  aria-hidden
                  onAnimationEnd={(e) => {
                    if (/verbo-easy-win-tease/.test(e.animationName)) {
                      setEasyWinTease(null);
                    }
                  }}
                >
                  {easyWinTease}
                </p>
              )}
              <button type="button" className="verbo__start verbo__start--compact" onClick={onPlayAgainClick}>
                Jogar novamente
              </button>
            </div>
            <p className="termo__credit">
              crafted by{" "}
              <a
                href="https://github.com/Wesley-0001"
                target="_blank"
                rel="noopener noreferrer"
              >
                wes
              </a>
            </p>
          </div>
        </div>
      )}

    </div>
  );
}
