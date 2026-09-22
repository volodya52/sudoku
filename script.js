// ============================================================
//  Судоку — генерация, отрисовка и управление игрой
// ============================================================

// ---------- Состояние игры ----------
let solution = [];      // полное решение
let puzzle = [];        // стартовая сетка (0 = пустая клетка)
let board = [];         // текущее состояние игрока
let notes = [];         // заметки-карандашом: notes[r][c] = Set чисел
let selected = null;    // { r, c } выбранная клетка
let difficulty = "easy";
let mistakes = 0;
let maxMistakes = 3;
let timerId = null;
let seconds = 0;
let notesMode = false;
let gameOver = false;
let score = 0;         // очки за текущую игру
let streak = 0;        // серия правильных цифр подряд
let lastFlashCombo = 1; // последний множитель, для которого показана вспышка
let bestCombo = 1;      // лучшее комбо за текущую игру
let doneDigits = new Set(); // «вышедшие» цифры: все 9 стоят на поле

// Количество подсказок, очки за цифру и условие разблокировки для каждого уровня
const LEVELS = {
  easy:   { name: "Легко",   clues: 45, points: 5,  unlockAfter: null }, // открыт всегда
  medium: { name: "Средне",  clues: 35, points: 10, unlockAfter: 5 },    // 5 побед на легком
  hard:   { name: "Сложно",  clues: 28, points: 15, unlockAfter: 5 },    // 5 побед на среднем
  expert: { name: "Эксперт", clues: 24, points: 20, unlockAfter: 5 },    // 5 побед на сложном
  master: { name: "Мастер",  clues: 22, points: 25, unlockAfter: 5 },    // 5 побед на эксперте
};
const LEVEL_ORDER = Object.keys(LEVELS);
const WINS_TO_UNLOCK = 5;
const STORAGE_KEY = "sudoku_progress";
const BEST_SCORE_KEY = "sudoku_best_scores";

// Прогресс игрока: количество побед на каждом уровне
let progress = loadProgress();

function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && typeof saved === "object") {
      const valid = {};
      for (const level of LEVEL_ORDER) valid[level] = Number(saved[level]) || 0;
      return valid;
    }
  } catch (e) { /* повреждённые данные — начинаем с нуля */ }
  return Object.fromEntries(LEVEL_ORDER.map((l) => [l, 0]));
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

// ============================================================
//  Очки и комбо
// ============================================================

// Текущий множитель комбо: активируется после 3 верных цифр подряд,
// затем +0.5 за каждую следующую, максимум X10
function getCombo() {
  if (streak < 3) return 1;
  return Math.min(1 + (streak - 3) * 0.5, 10);
}

// Начисление очков за правильную цифру: базовые очки уровня × комбо
function addPointsForCorrect(r, c) {
  streak++;
  const combo = getCombo();
  bestCombo = Math.max(bestCombo, combo);
  const gained = Math.round(LEVELS[difficulty].points * combo);
  score += gained;
  updateScoreDisplay();
  showFloatingPoints(gained, r, c);
  updateComboDisplay(combo);
  return gained;
}

// Штраф за ошибку: -5 очков и сброс комбо
function penalizeMistake() {
  streak = 0;
  score = Math.max(0, score - 5);
  updateScoreDisplay();
  resetComboDisplay();
}

// Штраф за подсказку: -10 очков и сброс комбо
function penalizeHint() {
  score = Math.max(0, score - 10);
  streak = 0;
  updateScoreDisplay();
  resetComboDisplay();
}

// Бонус за победу: множитель сложности + бонус за скорость
function addWinBonus() {
  const levelBonus = (LEVEL_ORDER.indexOf(difficulty) + 1) * 100;
  const speedBonus = Math.max(0, 500 - seconds); // чем быстрее, тем больше
  score += levelBonus + speedBonus;
  updateScoreDisplay();
  return { levelBonus, speedBonus };
}

function updateScoreDisplay() {
  scoreEl.textContent = score;
  // Подпрыгивание счёта при начислении
  scoreEl.classList.remove("bump");
  void scoreEl.offsetWidth; // принудительный reflow для перезапуска анимации
  scoreEl.classList.add("bump");
}

// Обновление индикатора комбо в статус-баре
function updateComboDisplay(combo) {
  if (streak < 3) return; // комбо ещё не активировано
  comboEl.textContent = "🔥 x" + combo.toFixed(1);
  comboEl.classList.add("active");
  comboEl.classList.toggle("max", combo >= 10);
  // Перезапуск анимации появления
  if (combo < 10) {
    comboEl.style.animation = "none";
    void comboEl.offsetWidth;
    comboEl.style.animation = "";
  }
  // Большая вспышка при достижении нового целого множителя (x2 ... x10)
  if (Number.isInteger(combo) && combo >= 2 && combo > lastFlashCombo) {
    showComboFlash(combo);
    lastFlashCombo = combo;
  }
}

function resetComboDisplay() {
  lastFlashCombo = 1;
  comboEl.textContent = "";
  comboEl.classList.remove("active", "max");
}

// Всплывающие «+N» над клеткой
function showFloatingPoints(gained, r, c) {
  const cell = boardEl.children[r * 9 + c];
  if (!cell) return;
  const span = document.createElement("span");
  span.className = "float-points";
  span.textContent = "+" + gained;
  cell.appendChild(span);
  setTimeout(() => span.remove(), 900);
}

// Всплывающее сообщение-предупреждение над цифрой в клетке.
// Позиционируется относительно доски с обрезкой по краям,
// чтобы сообщение никогда не выходило за границы поля.
// Для верхней строки — снизу (не обрезается верхней границей).
function showCellMessage(r, c, text) {
  const cellSize = boardEl.clientWidth / 9;
  if (!cellSize) return; // доска не отрисована

  const span = document.createElement("span");
  span.className = "cell-message" + (r === 0 ? " below" : "");
  span.textContent = text;
  boardEl.appendChild(span);

  // Центр клетки по горизонтали и вертикали
  const centerX = (c + 0.5) * cellSize;

  // Вертикаль: над клеткой, для верхней строки — под клеткой
  const cellTop = r * cellSize;
  if (r === 0) span.style.top = cellSize + 2 + "px";
  else span.style.top = cellTop - 26 + "px";

  // Горизонталь: центр на клетке, но не выходя за края доски
  const boardW = boardEl.clientWidth;
  const msgW = span.offsetWidth || 140;
  let left = centerX - msgW / 2;
  left = Math.max(4, Math.min(left, boardW - msgW - 4));
  span.style.left = left + "px";

  // Стрелка указывает точно на цифру (центр клетки)
  span.style.setProperty("--arrow-x", Math.round(centerX - left) + "px");

  setTimeout(() => span.remove(), 1400);
}

// Большая вспышка «КОМБО X2!» в центре экрана
function showComboFlash(combo) {
  const div = document.createElement("div");
  div.className = "combo-flash" + (combo >= 5 ? " max-flash" : "");
  div.textContent = "КОМБО X" + combo + "!";
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 1100);
}

// Рекорды по уровням
function getBestScores() {
  try {
    return JSON.parse(localStorage.getItem(BEST_SCORE_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function saveBestScore() {
  const best = getBestScores();
  if (!best[difficulty] || score > best[difficulty]) {
    best[difficulty] = score;
    localStorage.setItem(BEST_SCORE_KEY, JSON.stringify(best));
    return true; // новый рекорд
  }
  return false;
}

// Разблокирован ли уровень
function isUnlocked(level) {
  const idx = LEVEL_ORDER.indexOf(level);
  if (idx <= 0) return true; // первый уровень всегда открыт
  const prev = LEVEL_ORDER[idx - 1];
  return progress[prev] >= LEVELS[level].unlockAfter;
}

// Обновление подписей кнопок сложности: замок + счётчик прогресса
function renderDifficultyButtons() {
  document.querySelectorAll(".diff-btn").forEach((btn) => {
    const level = btn.dataset.diff;
    const meta = LEVELS[level];
    const unlocked = isUnlocked(level);
    btn.classList.toggle("locked", !unlocked);
    btn.title = unlocked ? "Доступен" : `Откроется после ${meta.unlockAfter} побед на уровне «${LEVELS[LEVEL_ORDER[LEVEL_ORDER.indexOf(level) - 1]].name}»`;

    if (unlocked) {
      btn.textContent = meta.name;
    } else {
      const prev = LEVEL_ORDER[LEVEL_ORDER.indexOf(level) - 1];
      btn.innerHTML = `🔒 ${meta.name}<span class="progress">${progress[prev]}/${meta.unlockAfter} побед</span>`;
    }
    btn.classList.toggle("active", level === difficulty);
  });
}

// ---------- DOM ----------
const boardEl = document.getElementById("board");
const timerEl = document.getElementById("timer");
const mistakesEl = document.getElementById("mistakes");
const messageEl = document.getElementById("message");
const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modal-title");
const modalText = document.getElementById("modal-text");
const notesBtn = document.getElementById("notes-toggle");
const scoreEl = document.getElementById("score");
const comboEl = document.getElementById("combo");

// ============================================================
//  Генерация судоку
// ============================================================

// Пустая сетка 9x9
function emptyGrid() {
  return Array.from({ length: 9 }, () => Array(9).fill(0));
}

// Проверка: можно ли поставить число num в клетку (r, c)
function isValid(grid, r, c, num) {
  for (let i = 0; i < 9; i++) {
    if (grid[r][i] === num) return false;              // строка
    if (grid[i][c] === num) return false;              // столбец
  }
  const br = Math.floor(r / 3) * 3;                    // блок 3x3
  const bc = Math.floor(c / 3) * 3;
  for (let i = br; i < br + 3; i++)
    for (let j = bc; j < bc + 3; j++)
      if (grid[i][j] === num) return false;
  return true;
}

// Заполнение полной валидной сетки (бэктрекинг со случайным порядком)
function fillGrid(grid) {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (grid[r][c] !== 0) continue;
      const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      for (const num of nums) {
        if (isValid(grid, r, c, num)) {
          grid[r][c] = num;
          if (fillGrid(grid)) return true;
          grid[r][c] = 0;
        }
      }
      return false;
    }
  }
  return true;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Уникальность решения: счётчик решений (до 2)
function countSolutions(grid, limit = 2) {
  let count = 0;

  function solve() {
    if (count >= limit) return;
    let best = null;
    // ищем пустую клетку с минимальным числом кандидатов (быстрее)
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (grid[r][c] === 0) {
          let cands = 0;
          for (let n = 1; n <= 9; n++) if (isValid(grid, r, c, n)) cands++;
          if (!best || cands < best.cands) best = { r, c, cands };
          if (cands <= 1) { r = 9; break; }
        }
      }
    }
    if (!best) { count++; return; }
    for (let n = 1; n <= 9; n++) {
      if (isValid(grid, best.r, best.c, n)) {
        grid[best.r][best.c] = n;
        solve();
        grid[best.r][best.c] = 0;
        if (count >= limit) return;
      }
    }
  }

  solve();
  return count;
}

// Генерация головоломки: убираем клетки, следя за единственностью решения
function generatePuzzle(clues) {
  const full = emptyGrid();
  fillGrid(full);
  const grid = full.map((row) => [...row]);

  const cells = shuffle(
    Array.from({ length: 81 }, (_, i) => [Math.floor(i / 9), i % 9])
  );

  let removed = 0;
  const toRemove = 81 - clues;

  for (const [r, c] of cells) {
    if (removed >= toRemove) break;
    const backup = grid[r][c];
    grid[r][c] = 0;
    if (countSolutions(grid.map((row) => [...row])) !== 1) {
      grid[r][c] = backup; // решение перестало быть единственным — возвращаем
    } else {
      removed++;
    }
  }
  return { solution: full, puzzle: grid };
}

// ============================================================
//  Отрисовка
// ============================================================

function renderBoard() {
  boardEl.innerHTML = "";

  // Предварительный расчёт подсветки для выбранной клетки
  let peers = null; // Set клеток "r,c" той же строки/столбца/блока
  let selValue = 0;
  if (selected) {
    const { r: sr, c: sc } = selected;
    selValue = board[sr][sc];
    peers = new Set();
    for (let i = 0; i < 9; i++) {
      peers.add(sr + "," + i); // строка
      peers.add(i + "," + sc); // столбец
    }
    const br = Math.floor(sr / 3) * 3;
    const bc = Math.floor(sc / 3) * 3;
    for (let i = br; i < br + 3; i++)
      for (let j = bc; j < bc + 3; j++) peers.add(i + "," + j);
  }

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.row = r;
      cell.dataset.col = c;

      const isFixed = puzzle[r][c] !== 0;
      if (isFixed) cell.classList.add("fixed");

      // Цифра — в отдельном span (для позиционирования над подсветкой)
      if (isFixed || board[r][c] !== 0) {
        const value = document.createElement("span");
        value.className = "value";
        value.textContent = isFixed ? puzzle[r][c] : board[r][c];
        cell.appendChild(value);
      } else if (notes[r][c].size > 0) {
        const notesEl = document.createElement("div");
        notesEl.className = "notes";
        for (let n = 1; n <= 9; n++) {
          const span = document.createElement("span");
          span.textContent = notes[r][c].has(n) ? n : "";
          notesEl.appendChild(span);
        }
        cell.appendChild(notesEl);
      }

      // Подсветка конфликтов (неверно поставленная цифра)
      if (!isFixed && board[r][c] !== 0 && board[r][c] !== solution[r][c]) {
        cell.classList.add("conflict");
      }

      if (selected) {
        const isSelected = selected.r === r && selected.c === c;
        if (isSelected) {
          cell.classList.add("selected");
        } else {
          // Клетки той же строки/столбца/блока — лёгкая подсветка фоном
          if (peers.has(r + "," + c)) cell.classList.add("peer");
          // Одинаковые цифры — выделение цветом
          if (selValue !== 0 && board[r][c] === selValue)
            cell.classList.add("same-value");
        }
      }

      cell.addEventListener("click", () => selectCell(r, c));
      boardEl.appendChild(cell);
    }
  }
}

function selectCell(r, c) {
  if (gameOver) return;
  selected = { r, c };
  renderBoard();
}

// ============================================================
//  Логика игры
// ============================================================

function inputNumber(num) {
  if (gameOver || !selected) return;
  const { r, c } = selected;
  if (puzzle[r][c] !== 0) return; // фиксированную клетку менять нельзя

  // Верно поставленную цифру менять/стирать нельзя (защита от фарминга очков)
  if (board[r][c] !== 0 && board[r][c] === solution[r][c]) {
    showCellMessage(r, c, "Верная цифра — изменить нельзя");
    return;
  }

  // «Вышедшую» цифру (все 9 на поле) ставить некуда
  if (num !== 0 && !notesMode && doneDigits.has(num)) {
    showMessage(`Цифра ${num} уже вся на поле — ставить некуда`);
    return;
  }

  if (num === 0) {
    // Ластик
    board[r][c] = 0;
    notes[r][c].clear();
  } else if (notesMode) {
    // Режим заметок
    if (board[r][c] !== 0) return;
    notes[r][c].has(num) ? notes[r][c].delete(num) : notes[r][c].add(num);
  } else {
    board[r][c] = num;
    notes[r][c].clear();
    if (num !== solution[r][c]) {
      mistakes++;
      mistakesEl.textContent = mistakes;
      penalizeMistake();
      if (mistakes >= maxMistakes) {
        endGame(false);
        return;
      }
    } else {
      addPointsForCorrect(r, c);
      checkDigitDone(num);
      if (isSolved()) {
        endGame(true);
        return;
      }
    }
  }
  renderBoard();
}

function isSolved() {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (board[r][c] !== solution[r][c]) return false;
  return true;
}

function giveHint() {
  if (gameOver) return;
  const empties = [];
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (board[r][c] !== solution[r][c]) empties.push([r, c]);
  if (empties.length === 0) return;

  const [r, c] = empties[Math.floor(Math.random() * empties.length)];
  board[r][c] = solution[r][c];
  notes[r][c].clear();
  selected = { r, c };
  penalizeHint();
  checkDigitDone(solution[r][c]);
  showMessage("Подсказка использована (-10 очков)");
  renderBoard();
  if (isSolved()) {
    endGame(true);
    return;
  }
  streak = 0; // подсказка сбрасывает серию
}

function checkBoard() {
  if (gameOver) return;
  let wrong = 0;
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (board[r][c] !== 0 && board[r][c] !== solution[r][c]) wrong++;
  showMessage(
    wrong === 0 ? "Пока всё верно! 👍" : `Неверных чисел: ${wrong}`
  );
}

// ============================================================
//  «Вышедшие» цифры (все 9 экземпляров верно стоят на поле)
// ============================================================

// Сколько верно стоящих экземпляров цифры n на поле
function countCorrectDigit(n) {
  let count = 0;
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      const value = puzzle[r][c] !== 0 ? puzzle[r][c] : board[r][c];
      if (value === n && solution[r][c] === n) count++;
    }
  return count;
}

// Проверка: если все 9 экземпляров цифры верно на поле — цифра «вышла»
function checkDigitDone(n) {
  if (doneDigits.has(n)) return;
  if (countCorrectDigit(n) === 9) {
    doneDigits.add(n);
    markNumButtonDone(n);
  }
}

// Кнопка цифры с анимацией заменяется галочкой
function markNumButtonDone(n) {
  const btn = document.querySelector(`.num-btn[data-num="${n}"]`);
  if (!btn) return;
  btn.textContent = "✓";
  btn.classList.remove("done");
  void btn.offsetWidth; // перезапуск анимации
  btn.classList.add("done");
  btn.disabled = true;
}

// Сброс кнопок при новой игре
function resetNumButtons() {
  doneDigits.clear();
  document.querySelectorAll(".num-btn[data-num]").forEach((btn) => {
    if (btn.dataset.num !== "0") {
      btn.textContent = btn.dataset.num;
      btn.classList.remove("done");
      btn.disabled = false;
    }
  });
}

function startTimer() {
  clearInterval(timerId);
  seconds = 0;
  timerEl.textContent = "00:00";
  timerId = setInterval(() => {
    seconds++;
    const m = String(Math.floor(seconds / 60)).padStart(2, "0");
    const s = String(seconds % 60).padStart(2, "0");
    timerEl.textContent = `${m}:${s}`;
  }, 1000);
}

function endGame(won) {
  gameOver = true;
  clearInterval(timerId);
  const time = timerEl.textContent;
  const levelName = LEVELS[difficulty].name;

  if (won) {
    // Записываем победу и проверяем разблокировку новых уровней
    const before = LEVEL_ORDER.map((l) => isUnlocked(l));
    progress[difficulty]++;
    saveProgress();
    const newlyUnlocked = LEVEL_ORDER
      .map((l, i) => (i > 0 && !before[i] && isUnlocked(l) ? LEVELS[l].name : null))
      .filter(Boolean);
    renderDifficultyButtons();

    // Бонус за победу и рекорд
    const { levelBonus, speedBonus } = addWinBonus();
    const isRecord = saveBestScore();
    const best = getBestScores()[difficulty];

    let unlockMsg = "";
    if (newlyUnlocked.length > 0)
      unlockMsg = `\n\n🔓 Открыт новый уровень: ${newlyUnlocked.join(", ")}!`;

    modalTitle.textContent = "🎉 Поздравляем!";
    modalText.textContent =
      `Вы решили судоку (${levelName}) за ${time}!\n` +
      `🏆 Итоговые очки: ${score}\n` +
      `🔥 Лучшее комбо: x${bestCombo % 1 ? bestCombo.toFixed(1) : bestCombo}\n` +
      `Бонус за победу: +${levelBonus}, за скорость: +${speedBonus}\n` +
      (isRecord ? `⭐ Новый рекорд уровня!` : `Рекорд уровня: ${best}`) +
      unlockMsg;
  } else {
    modalTitle.textContent = "😢 Игра окончена";
    modalText.textContent = "Вы превысили лимит ошибок. Попробуйте ещё раз!";
  }
  modal.classList.remove("hidden");
}

function showMessage(text) {
  messageEl.textContent = text;
  setTimeout(() => (messageEl.textContent = ""), 2500);
}

// ============================================================
//  Новая игра
// ============================================================

function newGame() {
  const { solution: sol, puzzle: puz } = generatePuzzle(LEVELS[difficulty].clues);
  solution = sol;
  puzzle = puz;
  board = puz.map((row) => [...row]);
  notes = Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => new Set())
  );
  selected = null;
  mistakes = 0;
  gameOver = false;
  mistakesEl.textContent = "0";
  score = 0;
  streak = 0;
  bestCombo = 1;
  updateScoreDisplay();
  resetComboDisplay();
  resetNumButtons();
  modal.classList.add("hidden");
  startTimer();
  renderBoard();
}

// ============================================================
//  Обработчики событий
// ============================================================

document.querySelectorAll(".num-btn").forEach((btn) =>
  btn.addEventListener("click", () => inputNumber(Number(btn.dataset.num)))
);

document.querySelectorAll(".diff-btn").forEach((btn) =>
  btn.addEventListener("click", () => {
    const level = btn.dataset.diff;
    if (!isUnlocked(level)) {
      const prev = LEVEL_ORDER[LEVEL_ORDER.indexOf(level) - 1];
      showMessage(
        `🔒 Уровень заблокирован. Нужно ${LEVELS[level].unlockAfter} побед на уровне «${LEVELS[prev].name}» (${progress[prev]}/${LEVELS[level].unlockAfter})`
      );
      return;
    }
    document.querySelectorAll(".diff-btn").forEach((b) => b.classList.remove("active"));
    difficulty = level;
    renderDifficultyButtons();
    newGame();
  })
);

document.getElementById("new-game").addEventListener("click", newGame);
document.getElementById("hint").addEventListener("click", giveHint);
document.getElementById("check").addEventListener("click", checkBoard);
document.getElementById("modal-close").addEventListener("click", newGame);

notesBtn.addEventListener("click", () => {
  notesMode = !notesMode;
  notesBtn.textContent = notesMode ? "✏ Заметки: вкл" : "✏ Заметки: выкл";
  notesBtn.style.background = notesMode ? "#f1c40f" : "";
  notesBtn.style.color = notesMode ? "#2c3e50" : "";
});

// Клавиатура: цифры, Backspace, стрелки для навигации
document.addEventListener("keydown", (e) => {
  if (e.key >= "1" && e.key <= "9") inputNumber(Number(e.key));
  else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0")
    inputNumber(0);
  else if (e.key.startsWith("Arrow") && selected) {
    e.preventDefault();
    const moves = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0],
      ArrowLeft: [0, -1], ArrowRight: [0, 1],
    };
    const [dr, dc] = moves[e.key];
    const r = Math.min(8, Math.max(0, selected.r + dr));
    const c = Math.min(8, Math.max(0, selected.c + dc));
    selectCell(r, c);
  }
});

// Старт
renderDifficultyButtons();
newGame();
