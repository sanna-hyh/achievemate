const STORAGE_KEY = "achievemate-data";
const GUEST_STORAGE_KEY = "achievemate_guest_data";
const CV_SETTINGS_STORAGE_KEY = "achievemate_cv_settings";
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

const state = {
  personalInfo: {
    name: "",
    phone: "",
    email: "",
  },
  achievements: [],
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

function createId(prefix = "ach") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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

function persistGuestSnapshot() {
  if (window.AchieveMateAuth?.isSignedIn?.()) {
    return;
  }

  const guestPayload = {
    personalInfo: state.personalInfo,
    achievements: state.achievements,
    cvLayout: state.cvLayout,
    cvPreviewEdits: state.cvPreviewEdits,
    cvSettings: state.cvSettings,
    exportHistory: state.exportHistory,
  };

  localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(guestPayload));
}

function saveCvSettings() {
  window.AchieveMateSaveStatus?.markPending();
  localStorage.setItem(CV_SETTINGS_STORAGE_KEY, JSON.stringify(state.cvSettings));
  persistGuestSnapshot();
  if (window.AchieveMateSync?.queuePush) {
    window.AchieveMateSync.queuePush();
  } else {
    window.AchieveMateSaveStatus?.markComplete();
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
          description: stripBulletGlyphs(achievement.description || ""),
          proofPath: achievement.proofPath || "",
        }));
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

function saveState(options = {}) {
  window.AchieveMateSaveStatus?.markPending();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  persistGuestSnapshot();
  if (!options.skipSync && window.AchieveMateSync?.queuePush) {
    window.AchieveMateSync.queuePush();
  } else {
    window.AchieveMateSaveStatus?.markComplete();
  }
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

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
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

  const oldProofPath = achievement.proofPath || "";

  achievement.title = editingDraft.title.trim();
  achievement.date = editingDraft.date.trim();
  achievement.description = stripBulletGlyphs(editingDraft.description);
  achievement.fileName = editingDraft.fileName || "";
  achievement.fileType = editingDraft.fileType || "";
  achievement.fileData = editingDraft.fileData || "";
  achievement.proofPath = editingDraft.proofPath || "";
  achievement.showDescription = getDescriptionLines(achievement.description).length > 0;

  if (oldProofPath && !achievement.proofPath && window.AchieveMateSupabase) {
    window.AchieveMateSupabase.storage.from("proofs").remove([oldProofPath]);
  }

  editingAchievementId = null;
  editingDraft = null;
  saveState();
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
  empty.innerHTML = `
    <div class="empty-state-glyph" aria-hidden="true">◈</div>
    <h3 class="empty-state-headline">Your logbook is empty</h3>
    <p class="empty-state-body">Every achievement you log becomes a building block for your CV.</p>
    <button type="button" class="btn btn-primary empty-state-cta">+ Log your first achievement</button>
  `;
  empty.querySelector(".empty-state-cta").addEventListener("click", addAchievement);
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
    if (window.AchieveMateSync?.openProof) {
      window.AchieveMateSync.openProof(achievement);
      return;
    }
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

function navigateDeck(delta) {
  clampDeckFrontIndex();
  const next = deckFrontIndex + delta;
  if (next >= 0 && next < state.achievements.length) {
    deckFrontIndex = next;
    renderAchievements();
  }
}

function getCoverFlowCardMarkup(achievement) {
  const titleText = achievement.title?.trim() || "Untitled achievement";
  const titleClass = achievement.title?.trim() ? "cover-card-title" : "cover-card-title is-placeholder";
  const lines = getDescriptionLines(achievement.description);
  const bodyText = lines.join(" ");

  return `
    <div class="cover-card-actions deck-card-actions">
      <button type="button" class="btn-icon btn-edit" aria-label="Edit achievement">✎</button>
      <button type="button" class="btn-icon btn-delete" aria-label="Delete achievement">×</button>
    </div>
    <div class="cover-card-inner">
      <h3 class="${titleClass}">${escapeHtml(titleText)}</h3>
      ${achievement.date?.trim() ? `<time class="cover-card-date">${escapeHtml(achievement.date)}</time>` : ""}
      ${bodyText ? `<p class="cover-card-body">${escapeHtml(bodyText)}</p>` : ""}
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
  face.className = "cover-card-tilt-face";
  face.innerHTML = innerHtml;
  canvas.appendChild(face);

  tilt.appendChild(canvas);
  return { tilt, face };
}

function createDeckCard(achievement, offset, isFront) {
  const card = document.createElement("article");
  card.className = `cover-card deck-card${isFront ? " is-front" : " is-behind"}`;
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
  prevBtn.disabled = deckFrontIndex <= 0;
  prevBtn.addEventListener("click", () => navigateDeck(-1));

  const stage = document.createElement("div");
  stage.className = "cover-flow-stage";
  stage.setAttribute("role", "group");
  stage.setAttribute("aria-roledescription", "carousel");
  [-2, -1, 0, 1, 2].forEach((offset) => {
    const index = deckFrontIndex + offset;
    if (index < 0 || index >= state.achievements.length) {
      return;
    }
    stage.appendChild(createDeckCard(state.achievements[index], offset, offset === 0));
  });

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "cover-flow-nav cover-flow-nav-next";
  nextBtn.setAttribute("aria-label", "Next card");
  nextBtn.innerHTML = '<span aria-hidden="true">›</span>';
  nextBtn.disabled = deckFrontIndex >= state.achievements.length - 1;
  nextBtn.addEventListener("click", () => navigateDeck(1));

  carousel.append(prevBtn, stage, nextBtn);

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

  section.append(carousel, dots);
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

function createEditEntry(achievement) {
  const card = document.createElement("article");
  card.className = "entry is-editing";
  card.dataset.id = achievement.id;

  const draft = editingDraft || {
    title: achievement.title || "",
    date: achievement.date || "",
    description: achievement.description || "",
    fileName: achievement.fileName || "",
    fileType: achievement.fileType || "",
    fileData: achievement.fileData || "",
    proofPath: achievement.proofPath || "",
  };

  card.innerHTML = `
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
  const proofWrap = card.querySelector(".entry-edit-proof");

  function syncDraft() {
    editingDraft = {
      ...draft,
      title: titleInput.value,
      date: dateInput.value,
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

      if (window.AchieveMateSync?.uploadProofFile) {
        if (window.AchieveMateSync.validateProofFile && !window.AchieveMateSync.validateProofFile(file)) {
          fileInput.value = "";
          return;
        }

        try {
          const oldPath = draft.proofPath || "";
          const uploaded = await window.AchieveMateSync.uploadProofFile(
            file,
            achievement.id,
            oldPath
          );
          draft.fileName = uploaded.fileName;
          draft.fileType = uploaded.fileType;
          draft.proofPath = uploaded.proofPath;
          draft.fileData = "";
          syncDraft();
          renderProofControls();
        } catch (error) {
          console.warn("Could not upload proof:", error);
          if (!error.message?.includes("Invalid proof file")) {
            showToast(error.message || "Could not upload proof file", { tone: "danger" });
          }
        } finally {
          fileInput.value = "";
        }
        return;
      }

      try {
        draft.fileName = file.name;
        draft.fileType = file.type;
        draft.fileData = await readFileAsDataUrl(file);
        syncDraft();
        renderProofControls();
      } catch (error) {
        console.warn("Could not read file:", error);
      }
    });
    proofWrap.append(attachBtn, fileInput);
  }

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

  // #region agent log
  fetch('http://127.0.0.1:7398/ingest/523bc814-bbd5-4260-baf0-542146ab4ca4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5c4027'},body:JSON.stringify({sessionId:'5c4027',location:'app.js:renderAchievements',message:'renderAchievements called',data:{logbookLoading,achievementCount:state.achievements.length,editingId:editingAchievementId},timestamp:Date.now(),hypothesisId:'D'})}).catch(()=>{});
  // #endregion

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

  const listHeading = document.createElement("h2");
  listHeading.className = "entries-list-all-heading";
  listHeading.textContent = "All achievements";

  state.achievements.forEach((achievement) => {
    if (editingAchievementId === achievement.id) {
      return;
    }
    listWrap.appendChild(createDisplayEntry(achievement));
  });

  if (listWrap.childElementCount > 0) {
    listWrap.prepend(listHeading);
    achievementsList.appendChild(listWrap);
  }
}

function addAchievement() {
  const achievement = {
    id: createId(),
    title: "",
    date: "",
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
  formatBulletText,
  stripBulletGlyphs,
  getDescriptionLines,
  refreshPersonalForm: populatePersonalForm,
  updateSidebarIdentitySummary,
  renderAchievements,
  finishLogbookLoading,
  isAchievementDescriptionVisible,
};

window.AchieveMateToast = { show: showToast };

document.addEventListener("achievemate:authed", (event) => {
  window.AchieveMateSync?.handleBoot?.(event.detail.user);
});

addAchievementBtn.addEventListener("click", addAchievement);
