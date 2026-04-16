import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { getRandomWord, getWordOfTheDay } from "./targetWord";
import TermoStarfield from "./TermoStarfield";
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

function rankHint(a: KeyHint, b: LetterState): KeyHint {
  const order = { absent: 0, present: 1, correct: 2 };
  const br = b;
  if (!a) return br;
  return order[a] >= order[br] ? a : br;
}

export default function VerboGame() {
  const verboRootRef = useRef<HTMLDivElement>(null);
  const revealTimersRef = useRef<number[]>([]);
  const [target, setTarget] = useState(() => getWordOfTheDay());
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

  const isPlaying = status === "playing";
  const inputLocked = revealingRow !== null;
  const showResultModal = !showRules && (status === "won" || status === "lost");

  const clearRevealTimers = useCallback(() => {
    for (const id of revealTimersRef.current) {
      window.clearTimeout(id);
    }
    revealTimersRef.current = [];
  }, []);

  const resetGame = useCallback(() => {
    clearRevealTimers();
    setRevealingRow(null);
    setTarget(getRandomWord());
    setGrid(Array.from({ length: ROWS }, () => Array(COLS).fill("")));
    setEvaluated(Array.from({ length: ROWS }, () => Array(COLS).fill(null)));
    setCurrentRow(0);
    setRowDraft({ letters: emptyLetters(), cursorIndex: 0 });
    setKeyHints({});
    setStatus("playing");
    setMessage("");
    setShakeRow(null);
  }, [clearRevealTimers]);

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

    const states = evaluateGuess(guess, target);
    const row = currentRow;

    const finalizeGuess = () => {
      updateKeyHints(guess, states);
      if (guess === target) {
        setStatus("won");
        setRowDraft({ letters: emptyLetters(), cursorIndex: 0 });
        return;
      }
      if (row === ROWS - 1) {
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
  }, [addLetter, backspace, moveCursor, showRules, submitGuess, inputLocked]);

  const onVirtualKey = (key: string) => {
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

  return (
    <div className="verbo" ref={verboRootRef}>
      <TermoStarfield containerRef={verboRootRef} />
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

      {showResultModal && (
        <div
          className="verbo__backdrop verbo__backdrop--result"
          role="dialog"
          aria-modal="true"
          aria-labelledby="termo-result-title"
        >
          <div className="verbo__modal verbo__modal--result">
            <div className="verbo__modal-brand" aria-hidden>
              TERMO
            </div>
            <h2
              id="termo-result-title"
              className={
                status === "won"
                  ? "verbo__result-title verbo__result-title--win"
                  : "verbo__result-title verbo__result-title--lose"
              }
            >
              {status === "won" ? "Parabéns!" : "Fim de jogo"}
            </h2>
            <p className="verbo__result-main">
              Palavra do dia: <strong>{target}</strong>
            </p>
            <p className="verbo__result-sub">
              {status === "won" ? "Você acertou" : "Não foi dessa vez"}
            </p>
            <div className="verbo__modal-actions">
              <button type="button" className="verbo__start verbo__start--compact" onClick={resetGame}>
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

      <div className="verbo__stage">
        <header className="verbo__header">
          <h1 className="verbo__title">TERMO</h1>
        </header>

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

    </div>
  );
}
