const STORAGE_KEY = "achievemate-data";
const CV_SETTINGS_STORAGE_KEY = "achievemate_cv_settings";
const MAX_PROOF_SIZE = 5242880;
const PROOF_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const CUSTOM_DEFAULTS_STORAGE_KEY = "achievemate_custom_defaults";

const CUSTOM_DEFAULT_FIELDS = [
  "fontFamily",
  "baseFontSize",
  "nameFontSize",
  "headingFontSize",
  "textColor",
  "accentColor",
  "headingDivider",
  "lineHeight",
  "sectionGap",
  "itemGap",
  "pageMargin",
  "autoFit",
];

const DEFAULT_CV_SETTINGS = {
  fontFamily: "Times New Roman",
  baseFontSize: 11,
  nameFontSize: 20,
  headingFontSize: 13,
  headingDivider: "solid",
  textColor: "#000000",
  accentColor: "#000000",
  lineHeight: 1.3,
  sectionGap: 12,
  itemGap: 4,
  pageMargin: "normal",
  autoFit: false,
};

const ACHIEVEMENT_CATEGORIES = [
  { id: "education", label: "Education" },
  { id: "leadership", label: "Leadership" },
  { id: "competition", label: "Competition" },
  { id: "internship", label: "Internship" },
  { id: "volunteering", label: "Volunteering" },
  { id: "others", label: "Others" },
];

const DEFAULT_ACHIEVEMENT_CATEGORY = "others";

const CATEGORY_ICON_SVGS = {
  education: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 3.5h4.5v9H3.5a1 1 0 0 1-1-1v-8zM9 3.5h4.5v9h-3.5a1 1 0 0 1-1-1v-8zM7 3.5v9" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  leadership: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 5.5v5l8 3V2.5L3 5.5zM3 8H2a1 1 0 0 0-1 1v0a1 1 0 0 0 1 1h1" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  competition: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4.5 3h7v2a3.5 3.5 0 0 1-7 0V3zM8 8.5V11M5.5 11h5M6 13h4M4.5 3V2M11.5 3V2" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  internship: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2.5" y="5.5" width="11" height="8" rx="1" stroke="currentColor" stroke-width="1.35"/><path d="M5.5 5.5V4.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  volunteering: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 13.5S3.5 10.5 3.5 7.5A2.5 2.5 0 0 1 8 6a2.5 2.5 0 0 1 4.5 1.5c0 3-4.5 6-4.5 6z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  others: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.5 2.5 5.5 8 8.5l5.5-3L8 2.5zM2.5 8 8 11l5.5-3M2.5 10.5 8 13.5l5.5-3" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

const LIBRARY_FIELDS = ["title", "subtitle", "date", "location", "description"];

const state = {
  personalInfo: {
    name: "",
    phone: "",
    email: "",
  },
  achievements: [],
  cvLibrary: [],
  cvLayout: [],
  cvPreviewEdits: {
    personal: {},
    items: {},
  },
  cvSettings: { ...DEFAULT_CV_SETTINGS },
  exportHistory: [],
};

const personalFields = ["name", "phone", "email"];
const personalForm = document.getElementById("personalForm");
const achievementsList = document.getElementById("achievementsList");
const addAchievementBtn = document.getElementById("addAchievementBtn");
const logbookEntryCount = document.getElementById("logbookEntryCount");

let editingAchievementId = null;
let editingDraft = null;
let armedDeleteId = null;
let armedDeleteTimer = null;
let logbookLoading = true;
let deckFrontIndex = 0;
let timelineCategoryFilter = "all";

const CATEGORY_EMPTY_MESSAGES = {
  education: "Log a course, degree, or learning milestone — this chapter is waiting for you.",
  leadership: "Led a team or initiative? Your leadership moments belong here.",
  competition: "Competed or placed in something? Add it when you're ready.",
  internship: "Every internship counts. Yours could be the next entry.",
  volunteering: "Give-back moments matter. Capture one when you can.",
  others: "Anything that shaped you fits here. Add your next story.",
};

function createId(prefix = "ach") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeLibraryEntry(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const entry = {
    id: typeof raw.id === "string" && raw.id ? raw.id : createId("lib"),
    savedAt: Number.isFinite(Number(raw.savedAt)) ? Number(raw.savedAt) : Date.now(),
  };

  LIBRARY_FIELDS.forEach((field) => {
    entry[field] = typeof raw[field] === "string" ? raw[field] : "";
  });

  if (typeof raw.migratedFromAchievementId === "string" && raw.migratedFromAchievementId) {
    entry.migratedFromAchievementId = raw.migratedFromAchievementId;
  }

  if (typeof raw.sourceLayoutItemId === "string" && raw.sourceLayoutItemId) {
    entry.sourceLayoutItemId = raw.sourceLayoutItemId;
  }

  const hasContent = LIBRARY_FIELDS.some((field) => entry[field].trim());
  return hasContent ? entry : null;
}

function libraryEntryFromAchievement(achievement) {
  const description = stripBulletGlyphs(achievement?.description || "");
  const descriptionHasText = description.split("\n").some((line) => line.trim());

  return normalizeLibraryEntry({
    id: createId("lib"),
    title: String(achievement?.title || "").trim(),
    subtitle: "",
    date: String(achievement?.date || "").trim(),
    location: "",
    description: descriptionHasText ? description : "",
    savedAt: Date.now(),
    migratedFromAchievementId: achievement?.id || "",
  });
}

function loadCvSettings(legacySettings) {
  try {
    const saved = localStorage.getItem(CV_SETTINGS_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      state.cvSettings = { ...DEFAULT_CV_SETTINGS, ...parsed };
      return;
    }
  } catch (error) {
    console.warn("Could not load CV settings:", error);
  }

  if (legacySettings && typeof legacySettings === "object") {
    state.cvSettings = { ...DEFAULT_CV_SETTINGS, ...legacySettings };
    saveCvSettings();
    return;
  }

  state.cvSettings = { ...DEFAULT_CV_SETTINGS };
}

function saveCvSettings() {
  window.AchieveMateSaveStatus?.markPending();
  try {
    localStorage.setItem(CV_SETTINGS_STORAGE_KEY, JSON.stringify(state.cvSettings));
    window.AchieveMateSaveStatus?.markComplete();
    return true;
  } catch (error) {
    window.AchieveMateSaveStatus?.markComplete();
    console.warn("Could not save CV settings:", error);
    showToast(
      isQuotaExceededError(error)
        ? "Storage is full — design settings couldn't be saved."
        : "Couldn't save design settings",
      { tone: "danger" }
    );
    return false;
  }
}

function getCustomDefaults() {
  try {
    const saved = localStorage.getItem(CUSTOM_DEFAULTS_STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.warn("Could not load custom defaults:", error);
  }
  return null;
}

function saveCustomDefaults(settings) {
  const defaults = {};
  CUSTOM_DEFAULT_FIELDS.forEach((field) => {
    if (settings[field] !== undefined) {
      defaults[field] = settings[field];
    }
  });
  localStorage.setItem(CUSTOM_DEFAULTS_STORAGE_KEY, JSON.stringify(defaults));
  return defaults;
}

function resetCvSettings() {
  const customDefaults = getCustomDefaults();
  state.cvSettings = customDefaults
    ? { ...DEFAULT_CV_SETTINGS, ...customDefaults }
    : { ...DEFAULT_CV_SETTINGS };
  saveCvSettings();
  saveState();
}

function loadState() {
  let legacyCvSettings = null;

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.personalInfo) {
        state.personalInfo = { ...state.personalInfo, ...parsed.personalInfo };
      }
      if (Array.isArray(parsed.achievements)) {
        state.achievements = parsed.achievements.map((achievement) => ({
          ...achievement,
          category: normalizeAchievementCategory(achievement.category),
          starred: Boolean(achievement.starred),
          description: stripBulletGlyphs(achievement.description || ""),
          proofPath: achievement.proofPath || "",
        }));
      }
      if (Array.isArray(parsed.cvLibrary)) {
        state.cvLibrary = parsed.cvLibrary.map(normalizeLibraryEntry).filter(Boolean);
      } else {
        state.cvLibrary = sortAchievementsForStudio(state.achievements)
          .map(libraryEntryFromAchievement)
          .filter(Boolean);
      }
      if (Array.isArray(parsed.cvLayout)) {
        state.cvLayout = parsed.cvLayout;
      }
      if (parsed.cvPreviewEdits) {
        state.cvPreviewEdits = {
          personal: parsed.cvPreviewEdits.personal || {},
          items: parsed.cvPreviewEdits.items || {},
        };
      }
      if (parsed.cvSettings) {
        legacyCvSettings = parsed.cvSettings;
      } else if (parsed.cvLayoutStyles) {
        legacyCvSettings = parsed.cvLayoutStyles;
      }
      if (Array.isArray(parsed.exportHistory)) {
        state.exportHistory = parsed.exportHistory;
      }
    }
  } catch (error) {
    console.warn("Could not load saved data:", error);
  }

  loadCvSettings(legacyCvSettings);
}

function isQuotaExceededError(error) {
  if (!error) {
    return false;
  }

  return (
    error.name === "QuotaExceededError" ||
    error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    error.code === 22 ||
    error.code === 1014 ||
    /quota/i.test(String(error.message || ""))
  );
}

function saveState(options = {}) {
  const {
    silent = false,
    quotaMessage = "Storage is full — changes couldn't be saved. Free some space or use a smaller attachment.",
  } = options;

  window.AchieveMateSaveStatus?.markPending();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.AchieveMateSaveStatus?.markComplete();
    return true;
  } catch (error) {
    window.AchieveMateSaveStatus?.markComplete();
    console.warn("Could not save data:", error);
    if (!silent) {
      showToast(
        isQuotaExceededError(error)
          ? quotaMessage
          : "Couldn't save your changes",
        { tone: "danger" }
      );
    }
    return false;
  }
}

function canPersistMutatedState(mutateSnapshot) {
  let snapshot;
  try {
    snapshot = JSON.parse(JSON.stringify(state));
  } catch (error) {
    console.warn("Could not clone state for storage probe:", error);
    return false;
  }

  try {
    mutateSnapshot?.(snapshot);
  } catch (error) {
    console.warn("Storage probe mutation failed:", error);
    return false;
  }

  const previousRaw = localStorage.getItem(STORAGE_KEY);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    if (!isQuotaExceededError(error)) {
      console.warn("Storage probe failed:", error);
    }
    return false;
  }

  try {
    if (previousRaw == null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, previousRaw);
    }
  } catch (restoreError) {
    console.warn("Could not restore previous storage after probe:", restoreError);
  }

  return true;
}

function stripBulletGlyphs(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/^[•\-*]\s*/, ""))
    .join("\n");
}

function getDescriptionLines(description) {
  return stripBulletGlyphs(description)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatBulletText(value) {
  return stripBulletGlyphs(value);
}

function normalizeAchievementCategory(value) {
  const id = String(value || DEFAULT_ACHIEVEMENT_CATEGORY).toLowerCase();
  return ACHIEVEMENT_CATEGORIES.some((category) => category.id === id)
    ? id
    : DEFAULT_ACHIEVEMENT_CATEGORY;
}

function getAchievementCategory(categoryId) {
  const id = normalizeAchievementCategory(categoryId);
  return ACHIEVEMENT_CATEGORIES.find((category) => category.id === id);
}

function getCategoryIconMarkup(categoryId, className = "category-icon") {
  const id = normalizeAchievementCategory(categoryId);
  const svg = CATEGORY_ICON_SVGS[id] || CATEGORY_ICON_SVGS.others;
  return `<span class="${className}" aria-hidden="true">${svg}</span>`;
}

function getCategoryBadgeMarkup(categoryId, { variant = "cover" } = {}) {
  const category = getAchievementCategory(categoryId);
  const baseClass = variant === "entry" ? "entry-category" : "cover-card-category";

  return `
    <div class="${baseClass}" aria-label="Category: ${category.label}">
      ${getCategoryIconMarkup(category.id, `${baseClass}-icon`)}
      <span class="${baseClass}-label">${escapeHtml(category.label.toUpperCase())}</span>
    </div>
  `;
}

function getStarIconSvg(filled = false) {
  if (filled) {
    return `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1.8 9.96 5.78l4.36.63-3.15 3.07.74 4.34L8 11.67 3.09 14.82l.74-4.34L.68 6.41l4.36-.63L8 1.8z"/></svg>`;
  }

  return `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1.8 9.96 5.78l4.36.63-3.15 3.07.74 4.34L8 11.67 3.09 14.82l.74-4.34L.68 6.41l4.36-.63L8 1.8z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
}

function getStarBadgeMarkup(className = "achievement-star") {
  return `<span class="${className}" aria-label="Starred">${getStarIconSvg(true)}</span>`;
}

const MONTH_SORT_ORDER = [
  ["january", 1],
  ["jan", 1],
  ["february", 2],
  ["feb", 2],
  ["march", 3],
  ["mar", 3],
  ["april", 4],
  ["apr", 4],
  ["may", 5],
  ["june", 6],
  ["jun", 6],
  ["july", 7],
  ["jul", 7],
  ["august", 8],
  ["aug", 8],
  ["september", 9],
  ["sep", 9],
  ["sept", 9],
  ["october", 10],
  ["oct", 10],
  ["november", 11],
  ["nov", 11],
  ["december", 12],
  ["dec", 12],
];

function extractAchievementYear(dateStr) {
  if (!dateStr?.trim()) {
    return null;
  }

  const matches = [...String(dateStr).matchAll(/\b(19|20)\d{2}\b/g)];
  if (matches.length === 0) {
    return null;
  }

  return Math.min(...matches.map((match) => Number.parseInt(match[0], 10)));
}

function extractSortMonth(dateStr) {
  if (!dateStr?.trim()) {
    return 99;
  }

  const lower = dateStr.toLowerCase();
  let month = 99;

  MONTH_SORT_ORDER.forEach(([name, value]) => {
    if (new RegExp(`\\b${name}\\b`, "i").test(lower)) {
      month = Math.min(month, value);
    }
  });

  return month;
}

function compareAchievementsByTimeline(a, b) {
  const yearA = extractAchievementYear(a.date);
  const yearB = extractAchievementYear(b.date);

  if (yearA === null && yearB === null) {
    return 0;
  }
  if (yearA === null) {
    return 1;
  }
  if (yearB === null) {
    return -1;
  }

  if (yearA !== yearB) {
    return yearB - yearA;
  }

  const monthA = extractSortMonth(a.date);
  const monthB = extractSortMonth(b.date);
  if (monthA !== monthB) {
    return monthB - monthA;
  }

  return 0;
}

function groupAchievementsByYear(achievements) {
  const groups = new Map();
  const undated = [];

  achievements.forEach((achievement) => {
    const year = extractAchievementYear(achievement.date);
    if (year === null) {
      undated.push(achievement);
      return;
    }

    if (!groups.has(year)) {
      groups.set(year, []);
    }
    groups.get(year).push(achievement);
  });

  groups.forEach((items) => {
    items.sort(compareAchievementsByTimeline);
  });

  return {
    years: [...groups.keys()].sort((a, b) => b - a),
    groups,
    undated,
  };
}

function sortAchievementsByTimeline(achievements) {
  return [...achievements].sort(compareAchievementsByTimeline);
}

function sortAchievementsForStudio(achievements) {
  return [...achievements].sort((a, b) => {
    const starredDiff = Number(Boolean(b.starred)) - Number(Boolean(a.starred));
    if (starredDiff !== 0) {
      return starredDiff;
    }
    return compareAchievementsByTimeline(a, b);
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function validateProofFile(file) {
  if (!file) {
    return false;
  }

  if (file.size > MAX_PROOF_SIZE || !PROOF_MIME_TYPES.has(file.type)) {
    showToast("Proof must be a PDF, image, or Word file under 5 MB", { tone: "danger" });
    return false;
  }

  return true;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function populatePersonalForm() {
  if (!personalForm) {
    return;
  }

  personalFields.forEach((field) => {
    const input = personalForm.elements[field];
    if (input) {
      input.value = state.personalInfo[field] || "";
    }
  });
  updateSidebarIdentitySummary();
}

function updateSidebarIdentitySummary() {
  const summaryEl = document.getElementById("sidebarIdentitySummary");
  if (!summaryEl) {
    return;
  }

  const { name, email, phone } = state.personalInfo;
  const nameText = name?.trim() || "";
  const emailText = email?.trim() || "";
  const phoneText = phone?.trim() || "";

  if (!nameText && !emailText && !phoneText) {
    summaryEl.textContent = "Add your name and contact";
    summaryEl.classList.add("is-empty");
    return;
  }

  summaryEl.classList.remove("is-empty");
  if (nameText && emailText) {
    summaryEl.textContent = `${nameText} · ${emailText}`;
    return;
  }

  summaryEl.textContent = nameText || emailText || phoneText;
}

function isPersonalInfoIncomplete() {
  const { name, email, phone } = state.personalInfo;
  return !name?.trim() || !email?.trim() || !phone?.trim();
}

function openPersonalInfoPanel() {
  window.AchieveMateSidebar?.expand({ focusPanel: "personal" });
  window.requestAnimationFrame(() => {
    personalForm?.elements.name?.focus();
  });
}

function isAchievementDescriptionVisible(achievement) {
  return Boolean(achievement && getDescriptionLines(achievement.description || "").length > 0);
}

function updateEntryCount() {
  if (!logbookEntryCount) {
    return;
  }

  const count = state.achievements.length;
  const nextText = `${count} achievement${count === 1 ? "" : "s"}`;
  const countChanged = logbookEntryCount.textContent !== nextText;

  logbookEntryCount.textContent = nextText;

  if (!countChanged) {
    return;
  }

  logbookEntryCount.classList.add("is-updating");
  window.setTimeout(() => logbookEntryCount.classList.remove("is-updating"), 150);
}

const TOAST_LIFETIME_MS = 3200;
const TOAST_EXIT_MS = 160;
const MAX_VISIBLE_TOASTS = 2;

const TOAST_DOT_COLORS = {
  success: "var(--signal-success)",
  danger: "var(--signal-danger)",
  neutral: "var(--brass)",
};

function dismissToast(toast, { immediate = false } = {}) {
  if (!toast || toast.dataset.dismissed === "true") {
    return;
  }

  toast.dataset.dismissed = "true";
  window.clearTimeout(toast.dismissTimer);

  const removeToast = () => {
    toast.remove();
    refreshToastStack();
  };

  if (immediate) {
    removeToast();
    return;
  }

  toast.classList.add("is-leaving");
  window.setTimeout(removeToast, TOAST_EXIT_MS);
}

function refreshToastStack() {
  const region = document.getElementById("toastRegion");
  if (!region) {
    return;
  }

  const toasts = [...region.querySelectorAll(".toast:not(.is-leaving)")];
  toasts.forEach((toast, index) => {
    toast.classList.toggle("is-stacked", index < toasts.length - 1);
  });
}

function showToast(message, { actionLabel, onAction, tone = "success", dismissible = true } = {}) {
  const region = document.getElementById("toastRegion");
  if (!region) {
    return null;
  }

  const activeToasts = [...region.querySelectorAll(".toast:not(.is-leaving)")];
  while (activeToasts.length >= MAX_VISIBLE_TOASTS) {
    dismissToast(activeToasts.shift(), { immediate: false });
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${tone}`;
  toast.setAttribute("role", tone === "danger" ? "alert" : "status");

  const dot = document.createElement("span");
  dot.className = "toast-dot";
  dot.setAttribute("aria-hidden", "true");
  dot.style.background = TOAST_DOT_COLORS[tone] || TOAST_DOT_COLORS.success;

  const messageEl = document.createElement("span");
  messageEl.className = "toast-message";
  messageEl.textContent = message;

  toast.append(dot, messageEl);

  if (actionLabel && typeof onAction === "function") {
    const actionBtn = document.createElement("button");
    actionBtn.type = "button";
    actionBtn.className = "toast-action";
    actionBtn.textContent = actionLabel;
    actionBtn.addEventListener("click", () => {
      onAction();
      dismissToast(toast);
    });
    toast.appendChild(actionBtn);
  }

  if (dismissible) {
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "btn-icon toast-dismiss";
    closeBtn.setAttribute("aria-label", "Dismiss notification");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => dismissToast(toast));
    toast.appendChild(closeBtn);
  }

  const scheduleDismiss = () => {
    window.clearTimeout(toast.dismissTimer);
    toast.dismissTimer = window.setTimeout(() => dismissToast(toast), TOAST_LIFETIME_MS);
  };

  toast.addEventListener("mouseenter", () => window.clearTimeout(toast.dismissTimer));
  toast.addEventListener("mouseleave", scheduleDismiss);

  region.appendChild(toast);
  refreshToastStack();
  scheduleDismiss();

  return () => dismissToast(toast);
}

function refreshCvSurfaces() {
  if (window.AchieveMateCvBuilder) {
    window.AchieveMateCvBuilder.render();
  }
  if (window.AchieveMateCvPreview) {
    window.AchieveMateCvPreview.render();
  }
}

function clearArmedDelete() {
  armedDeleteId = null;
  window.clearTimeout(armedDeleteTimer);
}

function removeAchievementById(achievementId, { skipUndo = false } = {}) {
  const index = state.achievements.findIndex((item) => item.id === achievementId);
  if (index === -1) {
    return;
  }

  const removed = state.achievements[index];
  const removedLayout = state.cvLayout.filter(
    (item) => item.type === "achievement" && item.achievementId === achievementId
  );

  state.achievements = state.achievements.filter((item) => item.id !== achievementId);
  state.cvLayout = state.cvLayout.filter(
    (item) => !(item.type === "achievement" && item.achievementId === achievementId)
  );

  if (editingAchievementId === achievementId) {
    editingAchievementId = null;
    editingDraft = null;
  }

  saveState();
  renderAchievements();
  refreshCvSurfaces();

  if (!skipUndo) {
    showToast("Achievement deleted", {
      actionLabel: "Undo",
      onAction: () => {
        const restored = { ...removed };
        restored.fileName = "";
        restored.fileType = "";
        restored.proofPath = "";
        restored.fileData = "";
        state.achievements.splice(index, 0, restored);
        state.cvLayout.push(...removedLayout);
        saveState();
        renderAchievements();
        refreshCvSurfaces();
      },
    });
  }
}

function startEditing(achievementId) {
  const achievement = state.achievements.find((item) => item.id === achievementId);
  if (!achievement) {
    return;
  }

  editingAchievementId = achievementId;
  editingDraft = {
    title: achievement.title || "",
    date: achievement.date || "",
    category: normalizeAchievementCategory(achievement.category),
    starred: Boolean(achievement.starred),
    description: achievement.description || "",
    fileName: achievement.fileName || "",
    fileType: achievement.fileType || "",
    fileData: achievement.fileData || "",
    proofPath: achievement.proofPath || "",
    isNew: false,
  };
  const index = state.achievements.findIndex((item) => item.id === achievementId);
  if (index !== -1) {
    deckFrontIndex = index;
  }
  renderAchievements();
}

function cancelEditing() {
  if (!editingAchievementId) {
    return;
  }

  const currentId = editingAchievementId;
  const wasNew = editingDraft?.isNew;
  const hadContent =
    Boolean(editingDraft?.title?.trim()) ||
    Boolean(editingDraft?.date?.trim()) ||
    getDescriptionLines(editingDraft?.description || "").length > 0 ||
    Boolean(editingDraft?.fileName);

  editingAchievementId = null;
  editingDraft = null;

  if (wasNew && !hadContent) {
    state.achievements = state.achievements.filter((item) => item.id !== currentId);
    saveState();
  }

  renderAchievements();
}

function saveEditing() {
  if (!editingAchievementId || !editingDraft) {
    return;
  }

  const achievement = state.achievements.find((item) => item.id === editingAchievementId);
  if (!achievement) {
    return;
  }

  const previous = {
    title: achievement.title || "",
    date: achievement.date || "",
    category: achievement.category,
    starred: Boolean(achievement.starred),
    description: achievement.description || "",
    showDescription: achievement.showDescription,
    fileName: achievement.fileName || "",
    fileType: achievement.fileType || "",
    fileData: achievement.fileData || "",
    proofPath: achievement.proofPath || "",
  };
  const nextFiles = {
    fileName: editingDraft.fileName || "",
    fileType: editingDraft.fileType || "",
    fileData: editingDraft.fileData || "",
    proofPath: editingDraft.proofPath || "",
  };
  const attachmentGrew =
    (nextFiles.fileData || "").length > (previous.fileData || "").length;

  achievement.title = editingDraft.title.trim();
  achievement.date = editingDraft.date.trim();
  achievement.category = normalizeAchievementCategory(editingDraft.category);
  achievement.starred = Boolean(editingDraft.starred);
  achievement.description = stripBulletGlyphs(editingDraft.description);
  achievement.fileName = nextFiles.fileName;
  achievement.fileType = nextFiles.fileType;
  achievement.fileData = nextFiles.fileData;
  achievement.proofPath = nextFiles.proofPath;
  achievement.showDescription = getDescriptionLines(achievement.description).length > 0;

  const saved = saveState({
    silent: attachmentGrew,
    quotaMessage:
      "Storage is full — this attachment couldn't be saved. Try a smaller file.",
  });

  if (!saved) {
    Object.assign(achievement, previous);
    if (attachmentGrew) {
      editingDraft.fileName = previous.fileName;
      editingDraft.fileType = previous.fileType;
      editingDraft.fileData = previous.fileData;
      editingDraft.proofPath = previous.proofPath;
      showToast("Storage is full — this attachment couldn't be saved. Try a smaller file.", {
        tone: "danger",
      });
      renderAchievements();
      return;
    }
    editingAchievementId = null;
    editingDraft = null;
    renderAchievements();
    refreshCvSurfaces();
    return;
  }

  editingAchievementId = null;
  editingDraft = null;
  renderAchievements();
  refreshCvSurfaces();
}

function renderLogbookSkeleton() {
  achievementsList.innerHTML = `
    <article class="entry-skeleton" aria-hidden="true">
      <div class="skeleton-bar skeleton-bar-title"></div>
      <div class="skeleton-bar skeleton-bar-line"></div>
      <div class="skeleton-bar skeleton-bar-line"></div>
    </article>
    <article class="entry-skeleton" aria-hidden="true">
      <div class="skeleton-bar skeleton-bar-title"></div>
      <div class="skeleton-bar skeleton-bar-line"></div>
      <div class="skeleton-bar skeleton-bar-line"></div>
    </article>
  `;
}

function renderEmptyState() {
  const empty = document.createElement("div");
  empty.className = "empty-state";

  const personalTip = isPersonalInfoIncomplete()
    ? `
    <div class="empty-state-personal-tip">
      <p class="empty-state-personal-tip-title">First, add your CV header</p>
      <p class="empty-state-personal-tip-body">Your name, phone, and email are edited at the top of your CV.</p>
      <button type="button" class="btn btn-ghost empty-state-personal-cta">Edit on CV</button>
    </div>
  `
    : "";

  empty.innerHTML = `
    ${personalTip}
    <div class="empty-state-glyph" aria-hidden="true">◈</div>
    <h3 class="empty-state-headline">Your logbook is empty</h3>
    <p class="empty-state-body">Every achievement you log becomes a building block for your CV.</p>
    <button type="button" class="btn btn-primary empty-state-cta">
      + Add achievement
    </button>
  `;

  empty.querySelector(".empty-state-cta")?.addEventListener("click", addAchievement);
  empty.querySelector(".empty-state-personal-cta")?.addEventListener("click", () => {
    window.AchieveMateViews?.setActiveView("studio");
  });
  achievementsList.appendChild(empty);
}

function createProofChip(achievement) {
  if (!achievement.fileName) {
    return null;
  }

  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "proof-chip";
  chip.textContent = `📎 ${achievement.fileName}`;
  chip.addEventListener("click", (event) => {
    event.stopPropagation();
    if (achievement.fileData) {
      window.open(achievement.fileData, "_blank", "noopener,noreferrer");
    }
  });
  return chip;
}

function clampDeckFrontIndex() {
  if (state.achievements.length === 0) {
    deckFrontIndex = 0;
    return;
  }
  deckFrontIndex = Math.max(0, Math.min(deckFrontIndex, state.achievements.length - 1));
}

function deckLoops() {
  return state.achievements.length >= 3;
}

function wrapDeckIndex(index) {
  const count = state.achievements.length;
  if (count === 0) {
    return 0;
  }
  return ((index % count) + count) % count;
}

function resolveDeckIndex(offset) {
  const count = state.achievements.length;
  const index = deckFrontIndex + offset;

  if (deckLoops()) {
    return wrapDeckIndex(index);
  }

  if (index < 0 || index >= count) {
    return null;
  }

  return index;
}

function getDeckOffsets() {
  const count = state.achievements.length;

  if (!deckLoops()) {
    return [-2, -1, 0, 1, 2];
  }

  if (count === 3) {
    return [-1, 0, 1];
  }

  if (count === 4) {
    return [-2, -1, 0, 1];
  }

  return [-2, -1, 0, 1, 2];
}

function navigateDeck(delta) {
  const count = state.achievements.length;
  if (count === 0) {
    return;
  }

  clampDeckFrontIndex();

  if (deckLoops()) {
    deckFrontIndex = wrapDeckIndex(deckFrontIndex + delta);
    renderAchievements();
    return;
  }

  const next = deckFrontIndex + delta;
  if (next >= 0 && next < count) {
    deckFrontIndex = next;
    renderAchievements();
  }
}

function getCoverFlowCardMarkup(achievement) {
  const titleText = achievement.title?.trim() || "Untitled achievement";
  const titleClass = achievement.title?.trim() ? "cover-card-title" : "cover-card-title is-placeholder";
  const isLeadershipLayout = normalizeAchievementCategory(achievement.category) === "leadership";

  if (isLeadershipLayout) {
    return `
      <div class="cover-card-actions deck-card-actions">
        <button type="button" class="btn-icon btn-edit" aria-label="Edit achievement">✎</button>
        <button type="button" class="btn-icon btn-delete" aria-label="Delete achievement">×</button>
      </div>
      <div class="cover-card-inner cover-card-inner--leadership">
        ${achievement.starred ? getStarBadgeMarkup("cover-card-star") : ""}
        ${getCategoryBadgeMarkup(achievement.category)}
        <div class="cover-card-media">
          <img src="leadership.png" alt="" class="cover-card-media-image" />
        </div>
        <h3 class="${titleClass}">${escapeHtml(titleText)}</h3>
        ${achievement.date?.trim() ? `<time class="cover-card-date">${escapeHtml(achievement.date)}</time>` : ""}
        ${achievement.fileName ? `<div class="cover-card-foot"></div>` : ""}
      </div>
    `;
  }

  const lines = getDescriptionLines(achievement.description);
  const bulletsMarkup = lines.length
    ? `<ul class="cover-card-bullets">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`
    : "";

  return `
    <div class="cover-card-actions deck-card-actions">
      <button type="button" class="btn-icon btn-edit" aria-label="Edit achievement">✎</button>
      <button type="button" class="btn-icon btn-delete" aria-label="Delete achievement">×</button>
    </div>
    <div class="cover-card-inner">
      ${achievement.starred ? getStarBadgeMarkup("cover-card-star") : ""}
      ${getCategoryBadgeMarkup(achievement.category)}
      <h3 class="${titleClass}">${escapeHtml(titleText)}</h3>
      ${achievement.date?.trim() ? `<time class="cover-card-date">${escapeHtml(achievement.date)}</time>` : ""}
      ${bulletsMarkup}
      ${achievement.fileName ? `<div class="cover-card-foot"></div>` : ""}
    </div>
  `;
}

function getDeckCardMarkup(achievement, { compact = false } = {}) {
  const titleText = achievement.title?.trim() || "Untitled achievement";
  const titleClass = achievement.title?.trim() ? "entry-title" : "entry-title is-placeholder";
  const lines = getDescriptionLines(achievement.description);
  const maxBullets = compact ? 2 : lines.length;
  const visibleLines = lines.slice(0, maxBullets);
  const hiddenCount = lines.length - visibleLines.length;
  const bulletsMarkup = visibleLines.length
    ? `<ul class="entry-bullets${compact ? " entry-bullets-compact" : ""}">${visibleLines
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join("")}${hiddenCount > 0 ? `<li class="entry-bullets-more">+${hiddenCount} more</li>` : ""}</ul>`
    : "";

  const foot = achievement.fileName ? `<div class="entry-foot"></div>` : "";

  return {
    html: `
      <div class="entry-head">
        <h3 class="${titleClass}">${escapeHtml(titleText)}</h3>
        ${achievement.date?.trim() ? `<time class="entry-date">${escapeHtml(achievement.date)}</time>` : ""}
        <div class="entry-actions deck-card-actions">
          <button type="button" class="btn-icon btn-edit" aria-label="Edit achievement">✎</button>
          <button type="button" class="btn-icon btn-delete" aria-label="Delete achievement">×</button>
        </div>
      </div>
      ${bulletsMarkup}
      ${foot}
    `,
    titleText,
  };
}

function bindEntryDeleteButton(deleteBtn, achievement) {
  deleteBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (armedDeleteId === achievement.id) {
      clearArmedDelete();
      deleteBtn.classList.remove("is-armed");
      deleteBtn.textContent = "×";
      removeAchievementById(achievement.id);
      return;
    }

    clearArmedDelete();
    armedDeleteId = achievement.id;
    deleteBtn.classList.add("is-armed");
    deleteBtn.textContent = "Sure?";
    armedDeleteTimer = window.setTimeout(() => {
      if (armedDeleteId === achievement.id) {
        armedDeleteId = null;
        deleteBtn.classList.remove("is-armed");
        deleteBtn.textContent = "×";
      }
    }, 2000);
  });
}

function createCardTiltShell(innerHtml) {
  const tilt = document.createElement("div");
  tilt.className = "cover-card-tilt";

  const canvas = document.createElement("div");
  canvas.className = "cover-card-tilt-canvas";
  canvas.setAttribute("aria-hidden", "true");

  for (let i = 1; i <= 25; i += 1) {
    const tracker = document.createElement("div");
    tracker.className = `cover-card-tracker tr-${i}`;
    canvas.appendChild(tracker);
  }

  const face = document.createElement("div");
  face.className = "cover-card-tilt-face border-glow-card";

  const edgeLight = document.createElement("div");
  edgeLight.className = "edge-light";
  edgeLight.setAttribute("aria-hidden", "true");

  const inner = document.createElement("div");
  inner.className = "border-glow-inner";
  inner.innerHTML = innerHtml;

  face.append(edgeLight, inner);
  canvas.appendChild(face);
  tilt.appendChild(canvas);

  return { tilt, face, inner };
}

const COVER_CARD_GLOW_REST_PROXIMITY = 56;
const COVER_CARD_GLOW_DRIFT_MS = 1400;
const COVER_CARD_GLOW_REST_ANGLES = [0, 180];

function nearestCoverCardRestAngle(angle) {
  const normalized = ((angle % 360) + 360) % 360;
  let nearest = COVER_CARD_GLOW_REST_ANGLES[0];
  let nearestDistance = Infinity;

  COVER_CARD_GLOW_REST_ANGLES.forEach((restAngle) => {
    const delta = ((((restAngle - normalized) % 360) + 540) % 360) - 180;
    const distance = Math.abs(delta);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = restAngle;
    }
  });

  return nearest;
}

function getCoverCardRestGlowState({ proximity, angle, opposite }) {
  return {
    proximity: COVER_CARD_GLOW_REST_PROXIMITY,
    angle: nearestCoverCardRestAngle(angle),
    opposite: nearestCoverCardRestAngle(opposite),
  };
}

function bindCoverCardBorderGlow(card, glowEl) {
  let driftFrame = null;

  function parseAngle(value, fallback) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function readGlowState() {
    const style = getComputedStyle(glowEl);
    return {
      proximity:
        Number.parseFloat(style.getPropertyValue("--edge-proximity")) || COVER_CARD_GLOW_REST_PROXIMITY,
      angle: parseAngle(style.getPropertyValue("--cursor-angle"), 0),
      opposite: parseAngle(style.getPropertyValue("--cursor-angle-opposite"), 180),
    };
  }

  function applyGlowState({ proximity, angle, opposite }) {
    glowEl.style.setProperty("--edge-proximity", String(proximity));
    glowEl.style.setProperty("--cursor-angle", `${angle}deg`);
    glowEl.style.setProperty("--cursor-angle-opposite", `${opposite}deg`);
  }

  function lerpAngle(from, to, amount) {
    const delta = ((((to - from) % 360) + 540) % 360) - 180;
    return from + delta * amount;
  }

  function cancelGlowDrift() {
    if (driftFrame) {
      cancelAnimationFrame(driftFrame);
      driftFrame = null;
    }
  }

  function driftGlowToRest() {
    cancelGlowDrift();

    const start = readGlowState();
    const target = getCoverCardRestGlowState(start);

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      applyGlowState(target);
      return;
    }

    const startTime = performance.now();

    const step = (now) => {
      const progress = Math.min(1, (now - startTime) / COVER_CARD_GLOW_DRIFT_MS);
      const ease = 1 - (1 - progress) ** 3;

      applyGlowState({
        proximity: start.proximity + (target.proximity - start.proximity) * ease,
        angle: lerpAngle(start.angle, target.angle, ease),
        opposite: lerpAngle(start.opposite, target.opposite, ease),
      });

      if (progress < 1) {
        driftFrame = requestAnimationFrame(step);
      } else {
        driftFrame = null;
      }
    };

    driftFrame = requestAnimationFrame(step);
  }

  const updateGlow = (event) => {
    cancelGlowDrift();

    const rect = glowEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const distEdge = Math.min(x, y, rect.width - x, rect.height - y);
    const influence = Math.min(rect.width, rect.height) * 0.38;
    const rawProximity = ((influence - distEdge) / influence) * 100;
    const proximity = Math.max(0, Math.min(100, rawProximity * 0.82));
    const angle =
      (Math.atan2(y - rect.height / 2, x - rect.width / 2) * 180) / Math.PI + 90;

    applyGlowState({ proximity, angle, opposite: angle + 180 });
  };

  card.addEventListener("mousemove", updateGlow);
  card.addEventListener("mouseleave", driftGlowToRest);
  applyGlowState({ proximity: COVER_CARD_GLOW_REST_PROXIMITY, angle: 0, opposite: 180 });
}

function createDeckCard(achievement, offset, isFront) {
  const card = document.createElement("article");
  const isLeadershipLayout = normalizeAchievementCategory(achievement.category) === "leadership";
  card.className = `cover-card deck-card${isFront ? " is-front" : " is-behind"}${
    isLeadershipLayout ? " is-leadership-layout" : ""
  }`;
  card.dataset.id = achievement.id;
  card.dataset.offset = String(offset);
  card.setAttribute("role", "button");
  card.tabIndex = isFront ? 0 : -1;
  card.setAttribute(
    "aria-label",
    isFront
      ? `${achievement.title?.trim() || "Untitled achievement"}, selected. Click to edit.`
      : `${achievement.title?.trim() || "Untitled achievement"}. Click to view.`
  );

  let contentRoot = card;

  if (isFront) {
    const { tilt, face } = createCardTiltShell(getCoverFlowCardMarkup(achievement));
    card.appendChild(tilt);
    bindCoverCardBorderGlow(card, face);

    const actions = face.querySelector(".cover-card-actions");
    if (actions) {
      tilt.appendChild(actions);
    }

    contentRoot = face;
  } else {
    card.innerHTML = getCoverFlowCardMarkup(achievement);
  }

  const proofChip = createProofChip(achievement);
  if (proofChip) {
    proofChip.className = "cover-card-proof";
    proofChip.innerHTML = `<span class="cover-card-proof-icon" aria-hidden="true">📎</span><span>${escapeHtml(achievement.fileName)}</span>`;
    const footEl = contentRoot.querySelector(".cover-card-foot");
    if (footEl) {
      footEl.appendChild(proofChip);
    }
  }

  if (isFront) {
    const editBtn = card.querySelector(".btn-edit");
    editBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      startEditing(achievement.id);
    });
    bindEntryDeleteButton(card.querySelector(".btn-delete"), achievement);

    card.addEventListener("click", () => startEditing(achievement.id));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        startEditing(achievement.id);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        navigateDeck(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        navigateDeck(1);
      }
    });
  } else {
    const achievementIndex = state.achievements.findIndex((item) => item.id === achievement.id);

    card.addEventListener("click", () => {
      if (deckFrontIndex === achievementIndex) {
        return;
      }
      deckFrontIndex = achievementIndex;
      renderAchievements();
    });
  }

  return card;
}

function createDeckStack() {
  clampDeckFrontIndex();

  const achievementCount = state.achievements.length;
  const loopDeck = deckLoops();

  const section = document.createElement("section");
  section.className = "cover-flow";
  section.setAttribute("aria-label", "Achievement cards");

  const carousel = document.createElement("div");
  carousel.className = "cover-flow-carousel";

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "cover-flow-nav cover-flow-nav-prev";
  prevBtn.setAttribute("aria-label", "Previous card");
  prevBtn.innerHTML = '<span aria-hidden="true">‹</span>';
  prevBtn.disabled = !loopDeck && deckFrontIndex <= 0;
  prevBtn.addEventListener("click", () => navigateDeck(-1));

  const stage = document.createElement("div");
  stage.className = "cover-flow-stage";
  stage.setAttribute("role", "group");
  stage.setAttribute("aria-roledescription", "carousel");
  getDeckOffsets().forEach((offset) => {
    const index = resolveDeckIndex(offset);
    if (index === null) {
      return;
    }
    stage.appendChild(createDeckCard(state.achievements[index], offset, offset === 0));
  });

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "cover-flow-nav cover-flow-nav-next";
  nextBtn.setAttribute("aria-label", "Next card");
  nextBtn.innerHTML = '<span aria-hidden="true">›</span>';
  nextBtn.disabled = !loopDeck && deckFrontIndex >= achievementCount - 1;
  nextBtn.addEventListener("click", () => navigateDeck(1));

  carousel.append(prevBtn, stage, nextBtn);

  const counter = document.createElement("p");
  counter.className = "cover-flow-count";
  counter.setAttribute("aria-live", "polite");
  counter.textContent = `${deckFrontIndex + 1} of ${achievementCount}`;

  const dots = document.createElement("div");
  dots.className = "cover-flow-dots";
  dots.setAttribute("role", "tablist");
  dots.setAttribute("aria-label", "Card pagination");

  state.achievements.forEach((achievement, index) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = `cover-flow-dot${index === deckFrontIndex ? " is-active" : ""}`;
    dot.setAttribute("role", "tab");
    dot.setAttribute("aria-label", `Go to card ${index + 1}`);
    dot.setAttribute("aria-selected", String(index === deckFrontIndex));
    dot.addEventListener("click", () => {
      deckFrontIndex = index;
      renderAchievements();
    });
  });

  section.append(carousel, counter, dots);
  return section;
}

function createDisplayEntry(achievement) {
  const card = document.createElement("article");
  card.className = "entry";
  card.dataset.id = achievement.id;

  const titleText = achievement.title?.trim() || "Untitled achievement";
  const titleClass = achievement.title?.trim() ? "entry-title" : "entry-title is-placeholder";
  const lines = getDescriptionLines(achievement.description);
  const bulletsMarkup = lines.length
    ? `<ul class="entry-bullets">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`
    : "";

  const foot = achievement.fileName ? `<div class="entry-foot"></div>` : "";

  card.innerHTML = `
    ${achievement.starred ? getStarBadgeMarkup("entry-star") : ""}
    ${getCategoryBadgeMarkup(achievement.category, { variant: "entry" })}
    <div class="entry-head">
      <h3 class="${titleClass}">${escapeHtml(titleText)}</h3>
      ${achievement.date?.trim() ? `<time class="entry-date">${escapeHtml(achievement.date)}</time>` : ""}
      <div class="entry-actions">
        <button type="button" class="btn-icon btn-edit" aria-label="Edit achievement">✎</button>
        <button type="button" class="btn-icon btn-delete" aria-label="Delete achievement">×</button>
      </div>
    </div>
    ${bulletsMarkup}
    ${foot}
  `;

  const proofChip = createProofChip(achievement);
  const footEl = card.querySelector(".entry-foot");
  if (proofChip && footEl) {
    footEl.appendChild(proofChip);
  }

  card.querySelector(".btn-edit").addEventListener("click", () => startEditing(achievement.id));

  bindEntryDeleteButton(card.querySelector(".btn-delete"), achievement);

  return card;
}

function createTimelineGroup(yearLabel, achievements, { showYear = true } = {}) {
  const group = document.createElement("div");
  group.className = "entries-timeline-group";

  const marker = document.createElement("aside");
  marker.className = "entries-timeline-marker";
  marker.setAttribute("aria-hidden", showYear ? "false" : "true");

  if (showYear && yearLabel) {
    const yearEl = document.createElement("time");
    yearEl.className = "entries-timeline-year";
    yearEl.dateTime = String(yearLabel);
    yearEl.textContent = String(yearLabel);
    marker.appendChild(yearEl);
  }

  const entriesCol = document.createElement("div");
  entriesCol.className = "entries-timeline-entries";
  achievements.forEach((achievement) => {
    entriesCol.appendChild(createDisplayEntry(achievement));
  });

  group.append(marker, entriesCol);
  return group;
}

function filterAchievementsByCategory(achievements, filterId) {
  if (filterId === "all") {
    return achievements;
  }

  return achievements.filter(
    (achievement) => normalizeAchievementCategory(achievement.category) === filterId
  );
}

function createTimelineCategoryFilter(activeFilter, onChange) {
  const bar = document.createElement("div");
  bar.className = "timeline-category-filter";
  bar.setAttribute("role", "tablist");
  bar.setAttribute("aria-label", "Filter achievements by category");

  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.className = `timeline-category-filter-item${activeFilter === "all" ? " is-active" : ""}`;
  allBtn.setAttribute("role", "tab");
  allBtn.setAttribute("aria-selected", String(activeFilter === "all"));
  allBtn.textContent = "All";
  allBtn.addEventListener("click", () => onChange("all"));
  bar.appendChild(allBtn);

  ACHIEVEMENT_CATEGORIES.forEach((category) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `timeline-category-filter-item timeline-category-filter-item-icon${
      activeFilter === category.id ? " is-active" : ""
    }`;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-label", category.label);
    btn.setAttribute("aria-selected", String(activeFilter === category.id));
    btn.innerHTML = getCategoryIconMarkup(category.id, "timeline-category-filter-icon");
    btn.addEventListener("click", () => onChange(category.id));
    bar.appendChild(btn);
  });

  return bar;
}

function createTimelineCategoryEmpty(categoryId) {
  const empty = document.createElement("div");
  empty.className = "timeline-category-empty";
  const category = getAchievementCategory(categoryId);
  const message =
    CATEGORY_EMPTY_MESSAGES[categoryId] ||
    `No ${category.label.toLowerCase()} achievements yet. Add one to get started.`;

  empty.innerHTML = `
    <p class="timeline-category-empty-text">${escapeHtml(message)}</p>
    <button type="button" class="btn btn-ghost timeline-category-empty-cta">+ Add achievement</button>
  `;

  empty.querySelector(".timeline-category-empty-cta").addEventListener("click", addAchievement);
  return empty;
}

function createTimelineList(achievements) {
  const timeline = document.createElement("div");
  timeline.className = "entries-timeline";

  const { years, groups, undated } = groupAchievementsByYear(achievements);

  years.forEach((year) => {
    timeline.appendChild(createTimelineGroup(year, groups.get(year)));
  });

  if (undated.length > 0) {
    timeline.appendChild(createTimelineGroup(null, undated, { showYear: false }));
  }

  return timeline;
}

function createEditEntry(achievement) {
  const card = document.createElement("article");
  card.className = "entry is-editing";
  card.dataset.id = achievement.id;

  const draft = editingDraft || {
    title: achievement.title || "",
    date: achievement.date || "",
    category: normalizeAchievementCategory(achievement.category),
    starred: Boolean(achievement.starred),
    description: achievement.description || "",
    fileName: achievement.fileName || "",
    fileType: achievement.fileType || "",
    fileData: achievement.fileData || "",
    proofPath: achievement.proofPath || "",
  };

  card.innerHTML = `
    <div class="entry-edit-toolbar">
      <div class="entry-edit-category-group">
        <span class="label entry-edit-category-label">Category</span>
        <div class="category-toggle">
          <button
            type="button"
            class="category-toggle-btn"
            aria-haspopup="listbox"
            aria-expanded="false"
            aria-label="Choose category"
          >
            <span class="category-toggle-icon" aria-hidden="true"></span>
            <span class="category-toggle-text"></span>
            <span class="category-toggle-chevron" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
          </button>
          <div class="category-toggle-menu" role="listbox" aria-label="Category" hidden></div>
        </div>
      </div>
      <button
        type="button"
        class="btn-icon entry-star-btn"
        aria-label="Star achievement"
        aria-pressed="false"
      ></button>
    </div>
    <div class="entry-edit-row">
      <label class="entry-edit-title">
        <span class="label">Title</span>
        <input class="field-input" type="text" name="title" value="${escapeHtml(draft.title)}" placeholder="e.g. Dean's List Award" />
      </label>
      <label class="entry-edit-date">
        <span class="label">Date</span>
        <input class="field-input" type="text" name="date" value="${escapeHtml(draft.date)}" placeholder="May 2025" />
      </label>
    </div>
    <div class="entry-edit-row">
      <label class="entry-edit-description" style="flex:1;min-width:0;display:flex;flex-direction:column;">
        <span class="label">Description</span>
        <textarea class="entry-edit-textarea" name="description" placeholder="One line per bullet point">${escapeHtml(draft.description)}</textarea>
        <span class="caption" style="margin-top:6px;">One line per bullet point.</span>
      </label>
    </div>
    <div class="entry-edit-foot">
      <div class="entry-edit-proof"></div>
      <div class="entry-edit-actions">
        <button type="button" class="btn btn-ghost btn-cancel">Cancel</button>
        <button type="button" class="btn btn-primary btn-save">Save entry</button>
      </div>
    </div>
  `;

  const titleInput = card.querySelector('[name="title"]');
  const dateInput = card.querySelector('[name="date"]');
  const descriptionInput = card.querySelector('[name="description"]');
  const categoryToggle = card.querySelector(".category-toggle");
  const categoryToggleBtn = card.querySelector(".category-toggle-btn");
  const categoryToggleMenu = card.querySelector(".category-toggle-menu");
  const entryStarBtn = card.querySelector(".entry-star-btn");
  const proofWrap = card.querySelector(".entry-edit-proof");

  function updateStarButtonUI() {
    const starred = Boolean(draft.starred);
    entryStarBtn.innerHTML = getStarIconSvg(starred);
    entryStarBtn.classList.toggle("is-starred", starred);
    entryStarBtn.setAttribute("aria-pressed", String(starred));
    entryStarBtn.setAttribute("aria-label", starred ? "Unstar achievement" : "Star achievement");
  }

  entryStarBtn.addEventListener("click", () => {
    draft.starred = !draft.starred;
    syncDraft();
    updateStarButtonUI();
  });

  function closeCategoryMenu() {
    categoryToggleMenu.hidden = true;
    categoryToggleBtn.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDocumentClick);
  }

  function openCategoryMenu() {
    categoryToggleMenu.hidden = false;
    categoryToggleBtn.setAttribute("aria-expanded", "true");
    window.setTimeout(() => {
      document.addEventListener("click", onDocumentClick);
    }, 0);
  }

  function onDocumentClick(event) {
    if (!categoryToggle.contains(event.target)) {
      closeCategoryMenu();
    }
  }

  function updateCategoryToggleUI() {
    const category = getAchievementCategory(draft.category);
    categoryToggleBtn.className = "category-toggle-btn";
    categoryToggleBtn.querySelector(".category-toggle-icon").outerHTML = getCategoryIconMarkup(
      category.id,
      "category-toggle-icon"
    );
    categoryToggleBtn.querySelector(".category-toggle-text").textContent = category.label;

    categoryToggleMenu.querySelectorAll(".category-toggle-option").forEach((option) => {
      const isSelected = option.dataset.value === draft.category;
      option.classList.toggle("is-selected", isSelected);
      option.setAttribute("aria-selected", String(isSelected));
    });
  }

  function renderCategoryToggle() {
    categoryToggleMenu.innerHTML = ACHIEVEMENT_CATEGORIES.map(
      (category) => `
        <button
          type="button"
          class="category-toggle-option${draft.category === category.id ? " is-selected" : ""}"
          role="option"
          data-value="${category.id}"
          aria-selected="${draft.category === category.id}"
        >
          ${getCategoryIconMarkup(category.id, "category-toggle-option-icon")}
          <span>${category.label}</span>
        </button>
      `
    ).join("");

    categoryToggleMenu.querySelectorAll(".category-toggle-option").forEach((option) => {
      option.addEventListener("click", () => {
        draft.category = option.dataset.value;
        syncDraft();
        updateCategoryToggleUI();
        closeCategoryMenu();
      });
    });

    updateCategoryToggleUI();
  }

  categoryToggleBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (categoryToggleMenu.hidden) {
      openCategoryMenu();
      return;
    }
    closeCategoryMenu();
  });

  function syncDraft() {
    editingDraft = {
      ...draft,
      title: titleInput.value,
      date: dateInput.value,
      category: normalizeAchievementCategory(draft.category),
      starred: Boolean(draft.starred),
      description: descriptionInput.value,
      fileName: draft.fileName,
      fileType: draft.fileType,
      fileData: draft.fileData,
      proofPath: draft.proofPath,
      isNew: draft.isNew,
    };
  }

  function renderProofControls() {
    proofWrap.innerHTML = "";

    if (draft.fileName) {
      const chip = document.createElement("span");
      chip.className = "proof-chip";
      chip.textContent = `📎 ${draft.fileName}`;
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn-icon btn-icon-sm";
      removeBtn.setAttribute("aria-label", "Remove proof");
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", () => {
        draft.fileName = "";
        draft.fileType = "";
        draft.fileData = "";
        draft.proofPath = "";
        syncDraft();
        renderProofControls();
      });
      proofWrap.append(chip, removeBtn);
      return;
    }

    const attachBtn = document.createElement("button");
    attachBtn.type = "button";
    attachBtn.className = "btn btn-ghost";
    attachBtn.textContent = "📎 Attach proof";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.hidden = true;
    fileInput.accept = ".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp";
    attachBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) {
        return;
      }

      if (!validateProofFile(file)) {
        fileInput.value = "";
        return;
      }

      try {
        const dataUrl = await readFileAsDataUrl(file);
        const achievementId = editingAchievementId;
        syncDraft();
        const fits = canPersistMutatedState((snapshot) => {
          const target = snapshot.achievements.find((item) => item.id === achievementId);
          if (!target) {
            return;
          }
          target.title = (editingDraft?.title || draft.title || "").trim();
          target.date = (editingDraft?.date || draft.date || "").trim();
          target.category = normalizeAchievementCategory(
            editingDraft?.category || draft.category
          );
          target.starred = Boolean(editingDraft?.starred ?? draft.starred);
          target.description = stripBulletGlyphs(
            editingDraft?.description || draft.description || ""
          );
          target.showDescription =
            getDescriptionLines(target.description).length > 0;
          target.fileName = file.name;
          target.fileType = file.type;
          target.fileData = dataUrl;
          target.proofPath = "";
        });

        if (!fits) {
          showToast(
            "Storage is full — this attachment couldn't be saved. Try a smaller file.",
            { tone: "danger" }
          );
          fileInput.value = "";
          return;
        }

        draft.fileName = file.name;
        draft.fileType = file.type;
        draft.fileData = dataUrl;
        draft.proofPath = "";
        syncDraft();
        renderProofControls();
      } catch (error) {
        console.warn("Could not read file:", error);
        showToast("Couldn't read that file", { tone: "danger" });
        fileInput.value = "";
      }
    });
    proofWrap.append(attachBtn, fileInput);
  }

  renderCategoryToggle();
  updateStarButtonUI();
  renderProofControls();

  titleInput.addEventListener("input", syncDraft);
  dateInput.addEventListener("input", syncDraft);
  descriptionInput.addEventListener("input", syncDraft);

  card.querySelector(".btn-cancel").addEventListener("click", cancelEditing);
  card.querySelector(".btn-save").addEventListener("click", () => {
    syncDraft();
    saveEditing();
  });

  card.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!categoryToggleMenu.hidden) {
        event.preventDefault();
        closeCategoryMenu();
        return;
      }
      event.preventDefault();
      cancelEditing();
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      syncDraft();
      saveEditing();
    }
  });

  window.requestAnimationFrame(() => titleInput.focus());

  return card;
}

function renderAchievements() {
  if (!achievementsList) {
    return;
  }

  const logbookView = document.getElementById("viewLogbook");
  const preservedScrollTop = logbookView?.scrollTop ?? 0;

  updateEntryCount();
  achievementsList.innerHTML = "";

  if (logbookLoading) {
    renderLogbookSkeleton();
    return;
  }

  if (state.achievements.length === 0) {
    renderEmptyState();
    return;
  }

  clampDeckFrontIndex();

  if (editingAchievementId) {
    const editingAchievement = state.achievements.find((item) => item.id === editingAchievementId);
    if (editingAchievement) {
      achievementsList.appendChild(createEditEntry(editingAchievement));
    }
  } else {
    achievementsList.appendChild(createDeckStack());
  }

  const listWrap = document.createElement("section");
  listWrap.className = "entries-list-all";
  listWrap.setAttribute("aria-label", "All achievements");

  const listHeader = document.createElement("div");
  listHeader.className = "entries-list-all-header";

  const listHeading = document.createElement("h2");
  listHeading.className = "entries-list-all-heading";
  listHeading.textContent = "All achievements";

  const visibleAchievements = state.achievements.filter(
    (achievement) => achievement.id !== editingAchievementId
  );

  listHeader.append(
    listHeading,
    createTimelineCategoryFilter(timelineCategoryFilter, (filterId) => {
      timelineCategoryFilter = filterId;
      renderAchievements();
    })
  );

  const filteredAchievements = filterAchievementsByCategory(
    visibleAchievements,
    timelineCategoryFilter
  );

  if (visibleAchievements.length > 0) {
    listWrap.appendChild(listHeader);

    const listBody = document.createElement("div");
    listBody.className = "entries-list-all-body";

    if (filteredAchievements.length > 0) {
      listBody.appendChild(createTimelineList(filteredAchievements));
    } else {
      listBody.appendChild(createTimelineCategoryEmpty(timelineCategoryFilter));
    }

    listWrap.appendChild(listBody);
    achievementsList.appendChild(listWrap);

    window.requestAnimationFrame(() => {
      if (logbookView) {
        logbookView.scrollTop = preservedScrollTop;
      }
    });
  }
}

function addAchievement() {
  const achievement = {
    id: createId(),
    title: "",
    date: "",
    category: DEFAULT_ACHIEVEMENT_CATEGORY,
    starred: false,
    description: "",
    showDescription: true,
    fileName: "",
    fileType: "",
    fileData: "",
    proofPath: "",
  };

  state.achievements.push(achievement);
  deckFrontIndex = state.achievements.length - 1;
  editingAchievementId = achievement.id;
  editingDraft = {
    title: "",
    date: "",
    category: DEFAULT_ACHIEVEMENT_CATEGORY,
    starred: false,
    description: "",
    fileName: "",
    fileType: "",
    fileData: "",
    proofPath: "",
    isNew: true,
  };
  saveState();
  renderAchievements();
  refreshCvSurfaces();
}

function bindPersonalForm() {
  if (!personalForm) {
    return;
  }

  personalForm.addEventListener("input", (event) => {
    const { name, value } = event.target;
    if (!personalFields.includes(name)) {
      return;
    }
    state.personalInfo[name] = value;
    updateSidebarIdentitySummary();
    saveState();
    if (state.achievements.length === 0) {
      renderAchievements();
    }
    if (window.AchieveMateCvPreview) {
      window.AchieveMateCvPreview.render();
    }
  });
}

function finishLogbookLoading() {
  logbookLoading = false;
  renderAchievements();
}

loadState();
populatePersonalForm();
bindPersonalForm();
finishLogbookLoading();

window.AchieveMateApp = {
  state,
  saveState,
  saveCvSettings,
  resetCvSettings,
  saveCustomDefaults,
  getCustomDefaults,
  DEFAULT_CV_SETTINGS,
  createId,
  escapeHtml,
  getStarIconSvg,
  normalizeLibraryEntry,
  LIBRARY_FIELDS,
  formatBulletText,
  stripBulletGlyphs,
  getDescriptionLines,
  refreshPersonalForm: populatePersonalForm,
  updateSidebarIdentitySummary,
  renderAchievements,
  finishLogbookLoading,
  isAchievementDescriptionVisible,
  sortAchievementsByTimeline,
  sortAchievementsForStudio,
  ACHIEVEMENT_CATEGORIES,
  normalizeAchievementCategory,
};

window.AchieveMateToast = { show: showToast };

addAchievementBtn.addEventListener("click", addAchievement);
