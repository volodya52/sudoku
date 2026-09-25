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
let paused = false;      // игра на паузе
let score = 0;         // очки за текущую игру
let streak = 0;        // серия правильных цифр подряд
let lastFlashCombo = 1; // последний множитель, для которого показана вспышка
let bestCombo = 1;      // лучшее комбо за текущую игру
let doneDigits = new Set(); // «вышедшие» цифры: все 9 стоят на поле
let coins = 0;          // баланс монет игрока
let upgrades = { mistakes: 0, hints: 0 }; // купленные улучшения (уровни)
let hintsLeft = 1;      // подсказок осталось на текущем уровне
let hintsUsed = 0;      // подсказок использовано на текущем уровне

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
const SAVE_KEY = "sudoku_saved_game";
const COINS_KEY = "sudoku_coins";
const UPGRADES_KEY = "sudoku_upgrades";

// Монеты за победу по уровням сложности
const LEVEL_COINS = { easy: 20, medium: 35, hard: 50, expert: 70, master: 90 };

// Параметры улучшений
const MAX_MISTAKES_LIMIT = 8;   // максимум ошибок
const MAX_HINTS_LIMIT = 5;      // максимум подсказок
const mistakeUpgradeCost = (lvl) => 40 + lvl * 20; // 40..120
const hintUpgradeCost = (lvl) => 50 + lvl * 25;    // 50..125

// Лимиты текущей игры (с учётом улучшений)
function getMistakesLimit() {
  return Math.min(3 + upgrades.mistakes, MAX_MISTAKES_LIMIT);
}
function getHintsLimit() {
  return Math.min(1 + upgrades.hints, MAX_HINTS_LIMIT);
}

// Прогресс игрока: количество побед на каждом уровне
let progress = loadProgress();

// Статистика игрока по уровням (для профиля)
let stats = getStats();
coins = loadCoins();
upgrades = loadUpgrades();
maxMistakes = getMistakesLimit();

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

// ---------- Монеты и улучшения ----------
function loadCoins() {
  return Number(localStorage.getItem(COINS_KEY)) || 0;
}

function saveCoins() {
  localStorage.setItem(COINS_KEY, String(coins));
}

function loadUpgrades() {
  try {
    const saved = JSON.parse(localStorage.getItem(UPGRADES_KEY));
    if (saved && typeof saved === "object")
      return {
        mistakes: Math.min(Number(saved.mistakes) || 0, MAX_MISTAKES_LIMIT - 3),
        hints: Math.min(Number(saved.hints) || 0, MAX_HINTS_LIMIT - 1),
      };
  } catch (e) { /* повреждённые данные */ }
  return { mistakes: 0, hints: 0 };
}

function saveUpgrades() {
  localStorage.setItem(UPGRADES_KEY, JSON.stringify(upgrades));
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
function showCellMessage(r, c, text, options = {}) {
  const cellSize = boardEl.clientWidth / 9;
  if (!cellSize) return; // доска не отрисована

  const span = document.createElement("span");
  span.className =
    "cell-message" +
    (options.hint ? " hint-msg" : "") +
    (r === 0 ? " below" : "");
  span.textContent = text;
  boardEl.appendChild(span);

  // Центр клетки по горизонтали и вертикали
  const centerX = (c + 0.5) * cellSize;

  // Вертикаль: над клеткой, для верхней строки — под клеткой
  const cellTop = r * cellSize;
  if (r === 0) span.style.top = cellSize + 2 + "px";
  else span.style.top = Math.max(4, cellTop - 26) + "px";

  // Горизонталь: центр на клетке, но не выходя за края доски
  const boardW = boardEl.clientWidth;
  const msgW = span.offsetWidth || 140;
  let left = centerX - msgW / 2;
  left = Math.max(4, Math.min(left, boardW - msgW - 4));
  span.style.left = left + "px";

  // Стрелка указывает точно на цифру (центр клетки)
  span.style.setProperty("--arrow-x", Math.round(centerX - left) + "px");

  const duration = options.duration || 1400;
  span.style.animationDuration = duration / 1000 + "s";
  setTimeout(() => span.remove(), duration);
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

// ============================================================
//  Статистика игрока (для профиля)
// ============================================================

const STATS_KEY = "sudoku_stats";

// stats[level] = { played, wins, bestScore, bestTime, bestCombo }
function getStats() {
  try {
    const saved = JSON.parse(localStorage.getItem(STATS_KEY));
    if (saved && typeof saved === "object") return saved;
  } catch (e) { /* повреждённые данные */ }
  return {};
}

function saveStats() {
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

// Обновление статистики уровня после завершённой игры
function updateStats(level, { won, time = 0, score = 0, bestCombo = 1 }) {
  if (!stats[level]) {
    stats[level] = { played: 0, wins: 0, bestScore: 0, bestTime: null, bestCombo: 0 };
  }
  const s = stats[level];
  s.played++;
  if (won) {
    s.wins++;
    // Лучшее время
    if (s.bestTime === null || time < s.bestTime) s.bestTime = time;
    // Лучший счёт
    if (score > s.bestScore) s.bestScore = score;
    // Лучшее комбо
    if (bestCombo > s.bestCombo) s.bestCombo = bestCombo;
  }
}

// Форматирование секунд в "мм:сс"
function formatTime(totalSeconds) {
  const m = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const s = String(totalSeconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

// ---------- Экран профиля ----------

const profileScreen = document.getElementById("profile-screen");

// Отрисовка карточек статистики по уровням
function renderProfile() {
  const container = document.getElementById("profile-stats");
  container.innerHTML = "";

  for (const level of LEVEL_ORDER) {
    const meta = LEVELS[level];
    const s = stats[level] || { played: 0, wins: 0, bestScore: 0, bestTime: null, bestCombo: 0 };
    const unlocked = isUnlocked(level);
    const winRate = s.played ? Math.round((s.wins / s.played) * 100) : 0;

    const row = document.createElement("div");
    row.className = "profile-row" + (unlocked ? "" : " locked");
    row.innerHTML = unlocked
      ? `<div class="level-name">${meta.name}</div>
         <div class="level-stats">
           <span>🎮 Игр: ${s.played}</span>
           <span>🏆 Побед: ${s.wins}</span>
           <span>📊 WIN%: ${winRate}%</span>
           <span>⭐ Рекорд: ${s.bestScore || "—"}</span>
           <span>⏱ ${s.bestTime !== null ? formatTime(s.bestTime) : "--:--"}</span>
           <span>🔥 x${s.bestCombo || 1}</span>
         </div>`
      : `<div class="level-name">🔒 ${meta.name}</div>
         <div class="level-stats"><span>Уровень ещё закрыт</span></div>`;
    container.appendChild(row);
  }
}

// ============================================================
//  Монеты и магазин улучшений
// ============================================================

function updateCoinsDisplay() {
  coinsEl.textContent = coins;
  const shopCoins = document.getElementById("shop-coins");
  if (shopCoins) shopCoins.textContent = coins;
}

// Расчёт монет за пройденный уровень: сложность, ошибки, подсказки, время
function computeCoinsEarned() {
  let earned = LEVEL_COINS[difficulty];
  earned -= mistakes * 5;               // штраф за ошибки
  earned -= hintsUsed * 5;              // штраф за подсказки
  earned += Math.max(0, Math.round((600 - seconds) / 10)); // бонус за скорость (до 60)
  return Math.max(5, earned);           // минимум 5 монет за победу
}

function updateHintsDisplay() {
  hintsEl.textContent = hintsLeft;
  hintBtn.textContent = `💡 Подсказка (${hintsLeft})`;
}

// ---------- Магазин ----------

// Иконка монеты для HTML-вставок (файл coins.png)
function coinIconHTML() {
  return `<img src="coins.png" class="coin-icon" alt="монеты">`;
}

function buyUpgrade(type) {
  const isMistakes = type === "mistakes";
  const level = upgrades[type];
  const maxed = isMistakes
    ? 3 + upgrades.mistakes >= MAX_MISTAKES_LIMIT
    : 1 + upgrades.hints >= MAX_HINTS_LIMIT;
  const cost = isMistakes
    ? mistakeUpgradeCost(level)
    : hintUpgradeCost(level);

  if (maxed) return;
  if (coins < cost) {
    showMessage(`Не хватает монет: нужно ${cost}, у вас ${coins}`);
    return;
  }
  coins -= cost;
  upgrades[type]++;
  saveCoins();
  saveUpgrades();
  updateCoinsDisplay();
  renderShop();
}

// Отрисовка экрана магазина
function renderShop() {
  updateCoinsDisplay();
  const container = document.getElementById("shop-items");
  container.innerHTML = "";

  const cards = [
    {
      type: "mistakes",
      title: "❌ Ошибки",
      current: getMistakesLimit(),
      max: MAX_MISTAKES_LIMIT,
      desc: "Допустимо неверных цифр за уровень",
      cost: mistakeUpgradeCost(upgrades.mistakes),
      maxed: 3 + upgrades.mistakes >= MAX_MISTAKES_LIMIT,
    },
    {
      type: "hints",
      title: "💡 Подсказки",
      current: getHintsLimit(),
      max: MAX_HINTS_LIMIT,
      desc: "Доступно на каждом уровне",
      cost: hintUpgradeCost(upgrades.hints),
      maxed: 1 + upgrades.hints >= MAX_HINTS_LIMIT,
    },
  ];

  for (const card of cards) {
    const el = document.createElement("div");
    el.className = "shop-card";
    el.innerHTML =
      `<div class="card-info">
         <div class="card-title">${card.title}: ${card.current}/${card.max}</div>
         <div class="card-desc">${card.desc}</div>
       </div>`;
    const btn = document.createElement("button");
    btn.className = "btn buy-btn";
    btn.innerHTML = `${coinIconHTML()} ${card.cost} — +1`;
    btn.disabled = coins < card.cost;
    btn.addEventListener("click", () => buyUpgrade(card.type));
    el.appendChild(btn);
    container.appendChild(el);
  }
}

// Разблокирован ли уровень
function isUnlocked(level) {
  const idx = LEVEL_ORDER.indexOf(level);
  if (idx <= 0) return true; // первый уровень всегда открыт
  const prev = LEVEL_ORDER[idx - 1];
  return progress[prev] >= LEVELS[level].unlockAfter;
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
const startScreen = document.getElementById("start-screen");
const gameScreen = document.getElementById("game-screen");
const btnContinue = document.getElementById("btn-continue");
const diffModal = document.getElementById("diff-modal");
const diffSelect = document.getElementById("diff-select");
const pauseModal = document.getElementById("pause-modal");
const coinsEl = document.getElementById("coins");
const hintsEl = document.getElementById("hints");
const mistakesMaxEl = document.getElementById("mistakes-max");
const hintBtn = document.getElementById("hint");
const shopScreen = document.getElementById("shop-screen");

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

function renderBoard(hideValues = false) {
  boardEl.innerHTML = "";

  // Игра ещё не создана (стартовый экран) — рисуем пустую сетку
  if (!puzzle.length || !board.length) {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.dataset.row = r;
        cell.dataset.col = c;
        boardEl.appendChild(cell);
      }
    }
    return;
  }

  // При паузе поле отрисовывается пустым (цифры скрыты)
  if (hideValues || paused) {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.dataset.row = r;
        cell.dataset.col = c;
        boardEl.appendChild(cell);
      }
    }
    return;
  }

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
  if (gameOver || paused) return;
  selected = { r, c };
  renderBoard();
}

// ============================================================
//  Логика игры
// ============================================================

function inputNumber(num) {
  if (gameOver || paused || !selected) return;
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
  saveGame(); // автосохранение после каждого хода
  renderBoard();
}

function isSolved() {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (board[r][c] !== solution[r][c]) return false;
  return true;
}

// Аргументация подсказки: почему цифра стоит именно в этой клетке
function hintReason(r, c, num) {
  const blockName = `${["верхнем", "среднем", "нижнем"][Math.floor(r / 3)]}-${["левом", "среднем", "правом"][Math.floor(c / 3)]}`;

  // Единицы измерения: строка, столбец, блок — где у цифры только одно место
  const units = [
    {
      name: `строке ${r + 1}`,
      cells: Array.from({ length: 9 }, (_, i) => [r, i]),
    },
    {
      name: `столбце ${c + 1}`,
      cells: Array.from({ length: 9 }, (_, i) => [i, c]),
    },
    {
      name: `${blockName} блоке`,
      cells: (() => {
        const cells = [];
        const br = Math.floor(r / 3) * 3;
        const bc = Math.floor(c / 3) * 3;
        for (let i = br; i < br + 3; i++)
          for (let j = bc; j < bc + 3; j++) cells.push([i, j]);
        return cells;
      })(),
    },
  ];

  for (const unit of units) {
    let spots = 0;
    for (const [rr, cc] of unit.cells)
      if (board[rr][cc] === 0 && isValid(board, rr, cc, num)) spots++;
    if (spots === 1)
      return `Цифра ${num} — единственное свободное место в ${unit.name}`;
  }
  return `Цифра ${num} не конфликтует со строкой ${r + 1}, столбцом ${c + 1} и ${blockName} блоком`;
}

function giveHint() {
  if (gameOver || paused) return;

  // Подсказки ограничены количеством на уровень
  if (hintsLeft <= 0) {
    showMessage("Подсказки закончились! Купите больше в улучшениях 🛒");
    return;
  }

  const empties = [];
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (board[r][c] !== solution[r][c]) empties.push([r, c]);
  if (empties.length === 0) return;

  const [r, c] = empties[Math.floor(Math.random() * empties.length)];

  // Рассчитываем аргументацию ДО установки цифры (по пустому полю)
  const oldValue = board[r][c];
  board[r][c] = 0;
  const reason = hintReason(r, c, solution[r][c]);
  board[r][c] = oldValue;

  board[r][c] = solution[r][c];
  notes[r][c].clear();
  selected = { r, c };
  hintsLeft--;
  hintsUsed++;
  updateHintsDisplay();
  penalizeHint();
  checkDigitDone(solution[r][c]);
  showCellMessage(r, c, reason, { hint: true, duration: 3000 });
  saveGame();
  renderBoard();
  if (isSolved()) {
    endGame(true);
    return;
  }
  streak = 0; // подсказка сбрасывает серию
}

function endGame(won) {
  gameOver = true;
  clearInterval(timerId);
  clearSavedGame(); // игра завершена — сохранение больше не нужно
  const time = timerEl.textContent;
  const levelName = LEVELS[difficulty].name;

  if (won) {
    // Записываем победу и проверяем разблокировку новых уровней
    const before = LEVEL_ORDER.map((l) => isUnlocked(l));
    progress[difficulty]++;
    saveProgress();
    updateStats(difficulty, { won: true, time: seconds, score, bestCombo });
    saveStats();
    const newlyUnlocked = LEVEL_ORDER
      .map((l, i) => (i > 0 && !before[i] && isUnlocked(l) ? LEVELS[l].name : null))
      .filter(Boolean);
    renderDiffSelect();

    // Бонус за победу и рекорд
    const { levelBonus, speedBonus } = addWinBonus();
    const isRecord = saveBestScore();
    const best = getBestScores()[difficulty];

    // Начисление монет за пройденный уровень
    const coinsEarned = computeCoinsEarned();
    coins += coinsEarned;
    saveCoins();
    updateCoinsDisplay();

    let unlockMsg = "";
    if (newlyUnlocked.length > 0)
      unlockMsg = `\n\n🔓 Открыт новый уровень: ${newlyUnlocked.join(", ")}!`;

    modalTitle.textContent = "🎉 Поздравляем!";
    modalText.innerHTML =
      `Вы решили судоку (${levelName}) за ${time}!<br>` +
      `🏆 Итоговые очки: ${score}<br>` +
      `🔥 Лучшее комбо: x${bestCombo % 1 ? bestCombo.toFixed(1) : bestCombo}<br>` +
      `${coinIconHTML()} Получено монет: ${coinsEarned} (баланс: ${coins})<br>` +
      `Бонус за победу: +${levelBonus}, за скорость: +${speedBonus}<br>` +
      (isRecord ? `⭐ Новый рекорд уровня!` : `Рекорд уровня: ${best}`) +
      unlockMsg.replace(/\n/g, "<br>");
  } else {
    updateStats(difficulty, { won: false });
    saveStats();
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

// ============================================================
//  Таймер
// ============================================================

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

// ============================================================
//  Экраны (стартовый / игровой / профиль) и окна
// ============================================================

const SCREENS = { start: startScreen, game: gameScreen, profile: profileScreen, shop: shopScreen };

function showScreen(name) {
  // Плавный переход: сначала гасим текущий экран, потом показываем новый
  if (name === "profile") renderProfile();
  if (name === "shop") renderShop();
  const current = document.querySelector(".screen.active");
  if (current && current.id === name) return;
  const switchTo = () => {
    for (const [key, el] of Object.entries(SCREENS))
      el.classList.toggle("active", key === name);
  };
  if (current) {
    current.classList.remove("active");
    setTimeout(switchTo, 200);
  } else {
    switchTo();
  }
}

// Открытие окна выбора сложности (для новой игры)
function openDiffModal() {
  renderDiffSelect();
  diffModal.classList.remove("hidden");
}

function closeDiffModal() {
  diffModal.classList.add("hidden");
}

// Кнопки выбора сложности в окне
function renderDiffSelect() {
  diffSelect.innerHTML = "";
  for (const level of LEVEL_ORDER) {
    const meta = LEVELS[level];
    const btn = document.createElement("button");
    btn.className = "diff-btn";
    btn.dataset.diff = level;
    const unlocked = isUnlocked(level);
    if (unlocked) {
      btn.textContent = meta.name;
    } else {
      const prev = LEVEL_ORDER[LEVEL_ORDER.indexOf(level) - 1];
      btn.innerHTML = `🔒 ${meta.name}<span class="progress">${progress[prev]}/${meta.unlockAfter}</span>`;
      btn.classList.add("locked");
    }
    btn.addEventListener("click", () => {
      if (!isUnlocked(level)) return; // заблокированный уровень не нажимается
      difficulty = level;
      closeDiffModal();
      newGame();
    });
    diffSelect.appendChild(btn);
  }
}

// ============================================================
//  Пауза
// ============================================================

function pauseGame() {
  if (gameOver || paused) return;
  paused = true;
  clearInterval(timerId);   // таймер останавливается
  saveGame();               // прогресс сохраняется
  updateContinueButton();
  pauseModal.classList.remove("hidden");
  renderBoard(true);        // цифры скрываются, чтобы не подглядывать
}

function resumeGame() {
  if (!paused) return;
  paused = false;
  pauseModal.classList.add("hidden");
  // Таймер продолжается с сохранённого времени
  clearInterval(timerId);
  timerId = setInterval(() => {
    seconds++;
    const m = String(Math.floor(seconds / 60)).padStart(2, "0");
    const s = String(seconds % 60).padStart(2, "0");
    timerEl.textContent = `${m}:${s}`;
  }, 1000);
  renderBoard();
}

// Выход из игры в меню: прогресс сохраняется, можно продолжить позже
function exitGame() {
  paused = false;
  pauseModal.classList.add("hidden");
  clearInterval(timerId);
  saveGame();
  updateContinueButton();
  showScreen("start");
}

// ============================================================
//  Сохранение незавершённой игры
// ============================================================

function saveGame() {
  if (gameOver) return;
  const data = {
    difficulty,
    solution,
    puzzle,
    board,
    notes: notes.map((row) => row.map((set) => [...set])),
    mistakes,
    maxMistakes,
    hintsLeft,
    hintsUsed,
    seconds,
    score,
    streak,
    bestCombo,
    doneDigits: [...doneDigits],
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (e) { /* нет места — игнорируем */ }
}

function loadSavedGame() {
  try {
    const data = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (data && data.board && data.solution) return data;
  } catch (e) { /* повреждённое сохранение */ }
  return null;
}

function clearSavedGame() {
  localStorage.removeItem(SAVE_KEY);
}

// Обновление видимости кнопки «Продолжить» на стартовом экране
function updateContinueButton() {
  btnContinue.classList.toggle("hidden", !loadSavedGame());
}

// Продолжение сохранённой игры
function continueGame() {
  const data = loadSavedGame();
  if (!data) return;

  difficulty = data.difficulty;
  solution = data.solution;
  puzzle = data.puzzle;
  board = data.board;
  notes = data.notes.map((row) => row.map((arr) => new Set(arr)));
  mistakes = data.mistakes;
  maxMistakes = data.maxMistakes || getMistakesLimit();
  mistakesMaxEl.textContent = maxMistakes;
  hintsLeft = data.hintsLeft ?? getHintsLimit();
  hintsUsed = data.hintsUsed || 0;
  updateHintsDisplay();
  updateCoinsDisplay();
  seconds = data.seconds;
  score = data.score;
  streak = data.streak;
  bestCombo = data.bestCombo || 1;
  doneDigits = new Set(data.doneDigits || []);

  selected = null;
  gameOver = false;
  paused = false;
  mistakesEl.textContent = mistakes;
  updateScoreDisplay();
  resetComboDisplay();
  // Восстановление кнопок «вышедших» цифр
  resetNumButtons();
  for (const n of doneDigits) markNumButtonDone(n);
  modal.classList.add("hidden");

  // Таймер продолжается с сохранённого времени
  clearInterval(timerId);
  timerId = setInterval(() => {
    seconds++;
    const m = String(Math.floor(seconds / 60)).padStart(2, "0");
    const s = String(seconds % 60).padStart(2, "0");
    timerEl.textContent = `${m}:${s}`;
  }, 1000);
  const m = String(Math.floor(seconds / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  timerEl.textContent = `${m}:${s}`;

  showScreen("game");
  renderBoard();
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
  maxMistakes = getMistakesLimit();
  mistakesMaxEl.textContent = maxMistakes;
  hintsLeft = getHintsLimit();
  hintsUsed = 0;
  updateHintsDisplay();
  updateCoinsDisplay();
  score = 0;
  streak = 0;
  bestCombo = 1;
  updateScoreDisplay();
  resetComboDisplay();
  resetNumButtons();
  modal.classList.add("hidden");
  clearSavedGame(); // новая игра заменяет сохранённую
  paused = false;
  startTimer();
  showScreen("game");
  renderBoard();
  renderDiffSelect();
}

// ============================================================
//  Обработчики событий
// ============================================================

document.querySelectorAll(".num-btn").forEach((btn) =>
  btn.addEventListener("click", () => inputNumber(Number(btn.dataset.num)))
);

document.getElementById("hint").addEventListener("click", giveHint);
document.getElementById("modal-close").addEventListener("click", () => {
  // Закрываем окно завершения и открываем выбор сложности для новой игры
  modal.classList.add("hidden");
  clearSavedGame();
  showScreen("start");
  updateContinueButton();
  openDiffModal();
});

// Стартовый экран
document.getElementById("btn-new-game").addEventListener("click", openDiffModal);
document.getElementById("btn-continue").addEventListener("click", continueGame);
document.getElementById("btn-profile").addEventListener("click", () => showScreen("profile"));
document.getElementById("btn-shop").addEventListener("click", () => showScreen("shop"));
document.getElementById("shop-back").addEventListener("click", () => showScreen("start"));
document.getElementById("profile-back").addEventListener("click", () => showScreen("start"));
document.getElementById("diff-cancel").addEventListener("click", closeDiffModal);

// Пауза
document.getElementById("pause").addEventListener("click", pauseGame);
document.getElementById("pause-resume").addEventListener("click", resumeGame);
document.getElementById("pause-exit").addEventListener("click", exitGame);

// Кнопка «На главный экран» в окне завершения игры
document.getElementById("modal-exit").addEventListener("click", () => {
  modal.classList.add("hidden");
  clearSavedGame();
  showScreen("start");
  updateContinueButton();
});

notesBtn.addEventListener("click", () => {
  notesMode = !notesMode;
  notesBtn.textContent = notesMode ? "✏ Заметки: вкл" : "✏ Заметки: выкл";
  notesBtn.style.background = notesMode ? "#f1c40f" : "";
  notesBtn.style.color = notesMode ? "#2c3e50" : "";
});

// Клавиатура: цифры, Backspace, стрелки для навигации, Esc — пауза
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (paused) resumeGame();
    else if (!gameOver && gameScreen.classList.contains("active")) pauseGame();
    return;
  }
  if (paused) return; // во время паузы ввод отключён
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

// Старт: показываем стартовый экран (поле отрисуется при старте игры)
renderDiffSelect();
updateContinueButton();
updateCoinsDisplay();
updateHintsDisplay();
mistakesMaxEl.textContent = maxMistakes;
showScreen("start");
