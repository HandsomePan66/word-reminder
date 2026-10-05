const STORAGE_KEY = "cike-v3";
const IMPORT_VERSION = "ielts-handbook-v1";

function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `word-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function stableWordId(word) {
  let hash = 2166136261;
  for (const char of word.toLowerCase()) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `handbook-${(hash >>> 0).toString(36)}`;
}

const starterWords = (window.HANDBOOK_WORDS || []).map((item) => ({
  ...item,
  id: stableWordId(item.word),
  phonetic: "",
  level: 0,
  due: null
}));

const defaultState = {
  words: starterWords,
  goal: 10,
  reminderEnabled: false,
  reminderTime: "20:30",
  learnedToday: 0,
  studyDate: "",
  lastStudyDate: "",
  streak: 0,
  lastNotifiedDate: "",
  studyCategory: "听力基础",
  importVersion: IMPORT_VERSION
};

let state = loadState();
let queue = [];
let queueIndex = 0;
let reviewedThisSession = 0;
let reminderTimer = null;
let toastTimer = null;
let wordListLimit = 100;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDate(date);
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.words) {
      const hydrated = { ...defaultState, ...saved };
      if (saved.importVersion !== IMPORT_VERSION) {
        const existingByWord = new Map(saved.words.map((item) => [item.word.toLowerCase(), item]));
        const importedKeys = new Set(starterWords.map((item) => item.word.toLowerCase()));
        const imported = starterWords.map((item) => {
          const existing = existingByWord.get(item.word.toLowerCase());
          return existing ? { ...item, ...existing, id: item.id, category: item.category } : item;
        });
        const custom = saved.words.filter((item) => !importedKeys.has(item.word.toLowerCase()));
        hydrated.words = [...imported, ...custom];
        hydrated.importVersion = IMPORT_VERSION;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(hydrated));
      }
      return hydrated;
    }
  } catch (error) {
    console.warn("Could not read saved data", error);
  }
  return clone(defaultState);
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function prepareDay() {
  const today = localDate();
  if (state.studyDate !== today) {
    state.studyDate = today;
    state.learnedToday = 0;
    saveState();
  }
  const eligible = state.words.filter((item) => categoryMatches(item, state.studyCategory));
  const due = eligible.filter((item) => !item.due || item.due <= today);
  const later = eligible.filter((item) => item.due && item.due > today);
  queue = [...due, ...later].slice(0, Math.min(state.goal, eligible.length));
  queueIndex = 0;
  reviewedThisSession = 0;
}

function renderDate() {
  const formatted = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());
  $("#today-date").textContent = formatted;
}

function renderProgress() {
  const current = Math.min(state.learnedToday, state.goal);
  const percentage = state.goal ? Math.min(100, (current / state.goal) * 100) : 0;
  $("#learned-count").textContent = current;
  $("#goal-copy").textContent = ` / ${state.goal} 个`;
  $("#progress-fill").style.width = `${percentage}%`;
  $("#streak-count").textContent = state.streak;
  $("#progress-note").textContent = percentage >= 100 ? "今日目标完成" : current ? `还差 ${state.goal - current} 个` : "从第一个词开始吧";
}

function renderCard() {
  const card = $("#study-area");
  const finished = $("#finished-state");
  if (!queue.length || queueIndex >= queue.length) {
    card.classList.add("is-hidden");
    finished.classList.remove("is-hidden");
    $("#finish-copy").textContent = state.words.length ? "明天再见，记忆需要一点时间生长。" : "先去词库添加一些想记住的单词吧。";
    return;
  }

  card.classList.remove("is-hidden");
  finished.classList.add("is-hidden");
  const item = queue[queueIndex];
  $("#word-number").textContent = `今日 ${queueIndex + 1} / ${queue.length}`;
  $("#current-word").textContent = item.word;
  $("#current-phonetic").textContent = item.phonetic || "";
  $("#current-meaning").textContent = item.meaning;
  $("#current-example").textContent = item.example || "给这个词写一句自己的例句，会记得更牢。";
  $("#meaning-wrap").classList.add("is-hidden");
  $("#rating-actions").classList.add("is-hidden");
  $("#reveal-answer").classList.remove("is-hidden");
}

function revealAnswer() {
  $("#meaning-wrap").classList.remove("is-hidden");
  $("#rating-actions").classList.remove("is-hidden");
  $("#reveal-answer").classList.add("is-hidden");
}

function registerStudy() {
  const today = localDate();
  if (state.lastStudyDate !== today) {
    const yesterday = addDays(today, -1);
    state.streak = state.lastStudyDate === yesterday ? state.streak + 1 : 1;
    state.lastStudyDate = today;
  }
  state.learnedToday += 1;
  reviewedThisSession += 1;
}

function rateWord(known) {
  const item = queue[queueIndex];
  const stored = state.words.find((word) => word.id === item.id);
  if (!stored) return;
  registerStudy();
  if (known) {
    const intervals = [1, 3, 7, 14, 30, 60];
    stored.level = Math.min((stored.level || 0) + 1, intervals.length - 1);
    stored.due = addDays(localDate(), intervals[stored.level]);
  } else {
    stored.level = 0;
    stored.due = addDays(localDate(), 1);
  }
  queueIndex += 1;
  saveState();
  renderProgress();
  renderCard();
  renderWordList();
}

function speakCurrentWord() {
  if (!queue[queueIndex] || !("speechSynthesis" in window)) {
    showToast("当前浏览器不支持语音朗读");
    return;
  }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(queue[queueIndex].word);
  utterance.lang = "en-US";
  utterance.rate = 0.85;
  speechSynthesis.speak(utterance);
}

function renderWordList() {
  const query = $("#word-search").value.trim().toLowerCase();
  const category = $("#word-category").value;
  const words = state.words.filter((item) => categoryMatches(item, category) && `${item.word} ${item.meaning}`.toLowerCase().includes(query));
  $("#word-total").textContent = state.words.length;
  $("#empty-words").classList.toggle("is-hidden", Boolean(words.length));
  $("#load-more").classList.toggle("is-hidden", words.length <= wordListLimit);
  const list = $("#word-list");
  list.replaceChildren();
  const today = localDate();
  words.slice(0, wordListLimit).forEach((item) => {
    const row = document.createElement("div");
    row.className = "word-row";
    const dueText = !item.due || item.due <= today ? "今日复习" : `${item.due.slice(5).replace("-", "/")} 复习`;
    row.innerHTML = `
      <strong></strong>
      <span class="row-meaning"><span></span><small></small></span>
      <span class="due-label"></span>
      <button class="delete-word" type="button" title="删除单词" aria-label="删除 ${escapeHtml(item.word)}">×</button>
    `;
    row.querySelector("strong").textContent = item.word;
    row.querySelector(".row-meaning span").textContent = item.meaning;
    row.querySelector(".row-meaning small").textContent = item.category || "自定义";
    row.querySelector(".due-label").textContent = dueText;
    row.querySelector("button").addEventListener("click", () => deleteWord(item.id));
    list.append(row);
  });
}

function categoryMatches(item, category) {
  if (!category || category === "all") return true;
  return (item.category || "自定义").startsWith(category);
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function deleteWord(id) {
  const item = state.words.find((word) => word.id === id);
  if (!item || !confirm(`删除“${item.word}”？`)) return;
  state.words = state.words.filter((word) => word.id !== id);
  saveState();
  prepareDay();
  renderAll();
  showToast("已从词库删除");
}

function openAddDialog() {
  $("#add-dialog").showModal();
  setTimeout(() => $("#add-word-form input[name='word']").focus(), 50);
}

function addWord(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitter = event.submitter;
  if (submitter?.value === "cancel") {
    $("#add-dialog").close();
    return;
  }
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  state.words.unshift({
    id: makeId(),
    word: data.get("word").trim(),
    phonetic: data.get("phonetic").trim(),
    meaning: data.get("meaning").trim(),
    example: data.get("example").trim(),
    category: "自定义",
    level: 0,
    due: null
  });
  saveState();
  form.reset();
  $("#add-dialog").close();
  prepareDay();
  renderAll();
  showToast("已添加到词库");
}

function switchView(name) {
  $$(".nav-tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === name));
  $$("[data-view-panel]").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.viewPanel === name));
  location.hash = name;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderSettings() {
  $("#reminder-enabled").checked = state.reminderEnabled;
  $("#reminder-time").value = state.reminderTime;
  $("#study-category").value = state.studyCategory;
  $$("[data-goal]").forEach((button) => button.classList.toggle("is-selected", Number(button.dataset.goal) === state.goal));
  const permission = "Notification" in window ? Notification.permission : "unsupported";
  const statusMap = { granted: "通知权限已开启", denied: "通知权限被浏览器拒绝，请在网站设置中修改", default: "尚未开启通知权限", unsupported: "当前浏览器不支持系统通知" };
  $("#notification-status").textContent = statusMap[permission];
}

async function setReminderEnabled(enabled) {
  if (enabled) {
    if (!("Notification" in window)) {
      state.reminderEnabled = false;
      showToast("当前浏览器不支持系统通知");
    } else {
      const permission = await Notification.requestPermission();
      state.reminderEnabled = permission === "granted";
      showToast(permission === "granted" ? "每日提醒已开启" : "需要通知权限才能提醒");
    }
  } else {
    state.reminderEnabled = false;
  }
  saveState();
  renderSettings();
  scheduleReminder();
}

function scheduleReminder() {
  clearTimeout(reminderTimer);
  if (!("Notification" in window) || !state.reminderEnabled || Notification.permission !== "granted") return;
  const [hours, minutes] = state.reminderTime.split(":").map(Number);
  const now = new Date();
  const target = new Date();
  target.setHours(hours, minutes, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  const delay = target.getTime() - now.getTime();
  reminderTimer = setTimeout(() => {
    sendNotification("该背单词啦", `今天还有 ${Math.max(0, state.goal - state.learnedToday)} 个单词等你复习。`);
    state.lastNotifiedDate = localDate();
    saveState();
    scheduleReminder();
  }, delay);
}

async function sendNotification(title, body) {
  if (Notification.permission !== "granted") {
    showToast("请先开启通知权限");
    return;
  }
  const registration = await navigator.serviceWorker?.ready;
  if (registration) registration.showNotification(title, { body, icon: "./icon.svg", badge: "./icon.svg", tag: "cike-daily", renotify: true });
  else new Notification(title, { body, icon: "./icon.svg" });
}

function catchUpReminder() {
  if (!("Notification" in window) || !state.reminderEnabled || Notification.permission !== "granted" || state.lastNotifiedDate === localDate()) return;
  const [hours, minutes] = state.reminderTime.split(":").map(Number);
  const now = new Date();
  const isPastTime = now.getHours() > hours || (now.getHours() === hours && now.getMinutes() >= minutes);
  if (isPastTime && state.learnedToday < state.goal) {
    sendNotification("今天的单词还没完成", `还差 ${state.goal - state.learnedToday} 个，花几分钟复习一下吧。`);
    state.lastNotifiedDate = localDate();
    saveState();
  }
}

function setGoal(goal) {
  state.goal = goal;
  saveState();
  prepareDay();
  renderAll();
  showToast(`每日目标已设为 ${goal} 个`);
}

function setStudyCategory(category) {
  state.studyCategory = category;
  saveState();
  prepareDay();
  renderAll();
  showToast("今日学习范围已更新");
}

function resetData() {
  if (!confirm("清空所有学习记录并恢复手册词库？此操作无法撤销。")) return;
  state = clone(defaultState);
  localStorage.removeItem(STORAGE_KEY);
  prepareDay();
  renderAll();
  showToast("学习记录已清空");
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function renderAll() {
  renderDate();
  renderProgress();
  renderCard();
  renderWordList();
  renderSettings();
}

function bindEvents() {
  $$(".nav-tab").forEach((tab) => tab.addEventListener("click", () => switchView(tab.dataset.view)));
  $("#quick-add").addEventListener("click", openAddDialog);
  $("#add-word-main").addEventListener("click", openAddDialog);
  $("#add-word-form").addEventListener("submit", addWord);
  $("#reveal-answer").addEventListener("click", revealAnswer);
  $("#know-word").addEventListener("click", () => rateWord(true));
  $("#again-word").addEventListener("click", () => rateWord(false));
  $("#speak-word").addEventListener("click", speakCurrentWord);
  $("#review-again").addEventListener("click", () => { queueIndex = 0; renderCard(); });
  $("#word-search").addEventListener("input", () => { wordListLimit = 100; renderWordList(); });
  $("#word-category").addEventListener("change", () => { wordListLimit = 100; renderWordList(); });
  $("#load-more").addEventListener("click", () => { wordListLimit += 100; renderWordList(); });
  $("#study-category").addEventListener("change", (event) => setStudyCategory(event.target.value));
  $("#reminder-enabled").addEventListener("change", (event) => setReminderEnabled(event.target.checked));
  $("#reminder-time").addEventListener("change", (event) => { state.reminderTime = event.target.value; saveState(); scheduleReminder(); showToast("提醒时间已更新"); });
  $("#test-notification").addEventListener("click", async () => {
    if (Notification.permission !== "granted") await setReminderEnabled(true);
    if (Notification.permission === "granted") sendNotification("词刻测试提醒", "提醒正常，别忘了今天的单词。");
  });
  $$("[data-goal]").forEach((button) => button.addEventListener("click", () => setGoal(Number(button.dataset.goal))));
  $("#reset-data").addEventListener("click", resetData);
  window.addEventListener("hashchange", () => {
    const name = location.hash.slice(1);
    if (["today", "words", "settings"].includes(name)) switchView(name);
  });
}

async function registerServiceWorker() {
  if ("serviceWorker" in navigator && window.isSecureContext) {
    try { await navigator.serviceWorker.register("./sw.js"); }
    catch (error) { console.warn("Service worker registration failed", error); }
  }
}

prepareDay();
bindEvents();
renderAll();
registerServiceWorker();
scheduleReminder();
setTimeout(catchUpReminder, 1200);

const initialView = location.hash.slice(1);
if (["today", "words", "settings"].includes(initialView)) switchView(initialView);
