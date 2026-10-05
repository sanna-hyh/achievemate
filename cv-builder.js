(function initCvBuilder() {
  const app = window.AchieveMateApp;
  if (!app) {
    return;
  }

  const { state, saveState, createId, escapeHtml, normalizeLibraryEntry, LIBRARY_FIELDS } = app;

  const cvPalette = document.getElementById("cvPalette");
  const cvLibraryList = document.getElementById("cvLibraryList");
  const studioRailCount = document.getElementById("studioRailCount");
  const studioClearCvBtn = document.getElementById("studioClearCvBtn");

  window.AchieveMateDrag = window.AchieveMateDrag || { payload: null };

  const CLEAR_CV_LABEL = "Remove all items";
  let armedClearCv = false;
  let armedClearCvTimer = null;

  function resetClearCvButton() {
    armedClearCv = false;
    window.clearTimeout(armedClearCvTimer);
    armedClearCvTimer = null;

    if (!studioClearCvBtn) {
      return;
    }

    studioClearCvBtn.classList.remove("is-armed");
    studioClearCvBtn.textContent = CLEAR_CV_LABEL;
  }

  function updateClearCvButton() {
    if (!studioClearCvBtn) {
      return;
    }

    const hasItems = state.cvLayout.length > 0;
    studioClearCvBtn.disabled = !hasItems;

    if (!hasItems) {
      resetClearCvButton();
    }
  }

  function clearAllCvItems() {
    if (state.cvLayout.length === 0) {
      return;
    }

    const previousLayout = JSON.parse(JSON.stringify(state.cvLayout));
    const previousItemEdits = JSON.parse(JSON.stringify(state.cvPreviewEdits.items || {}));

    state.cvLayout = [];
    state.cvPreviewEdits.items = {};
    saveState();
    renderRail();
    window.AchieveMateCvPreview?.render();

    window.AchieveMateToast?.show("CV cleared — start fresh", {
      actionLabel: "Undo",
      onAction: () => {
        state.cvLayout = previousLayout;
        state.cvPreviewEdits.items = previousItemEdits;
        saveState();
        renderRail();
        window.AchieveMateCvPreview?.render();
      },
    });
  }

  function handleClearCvClick() {
    if (!studioClearCvBtn || studioClearCvBtn.disabled) {
      return;
    }

    if (!armedClearCv) {
      armedClearCv = true;
      studioClearCvBtn.classList.add("is-armed");
      studioClearCvBtn.textContent = "Sure?";
      armedClearCvTimer = window.setTimeout(resetClearCvButton, 2000);
      return;
    }

    resetClearCvButton();
    clearAllCvItems();
  }

  function getAchievement(achievementId) {
    return state.achievements.find((item) => item.id === achievementId);
  }

  function isOnCv(achievementId) {
    return state.cvLayout.some(
      (item) => item.type === "achievement" && item.achievementId === achievementId
    );
  }

  function updateRailCount() {
    if (studioRailCount) {
      studioRailCount.textContent = String(state.cvLibrary?.length || 0);
    }
  }

  function librarySnapshotKey(entry) {
    return (LIBRARY_FIELDS || ["title", "subtitle", "date", "location", "description"])
      .map((field) => String(entry?.[field] || "").replace(/\s+/g, " ").trim())
      .join("\u0001");
  }

  function saveLibrarySnapshot(snapshot) {
    const entry = normalizeLibraryEntry?.({ ...snapshot, id: createId("lib"), savedAt: Date.now() });
    if (!entry) {
      window.AchieveMateToast?.show("Add some text before saving this item.", { tone: "neutral" });
      return { saved: false, reason: "empty" };
    }

    if (!Array.isArray(state.cvLibrary)) {
      state.cvLibrary = [];
    }

    const key = librarySnapshotKey(entry);
    const existing = state.cvLibrary.find((item) => librarySnapshotKey(item) === key);
    if (existing) {
      window.AchieveMateToast?.show("Already in your library", { tone: "neutral" });
      return { saved: false, reason: "duplicate", entry: existing };
    }

    state.cvLibrary = [entry, ...state.cvLibrary];
    saveState();
    renderRail();
    window.AchieveMateToast?.show("Saved to library");
    return { saved: true, entry };
  }

  function seedLayoutItemFromLibrary(entry) {
    const item = createLayoutItem("cv-item");
    const bucket = {};
    (LIBRARY_FIELDS || ["title", "subtitle", "date", "location", "description"]).forEach((field) => {
      if (String(entry[field] || "").trim()) {
        bucket[field] = entry[field];
      }
    });

    if (!state.cvPreviewEdits.items || typeof state.cvPreviewEdits.items !== "object") {
      state.cvPreviewEdits.items = {};
    }
    state.cvPreviewEdits.items[item.id] = bucket;
    return item;
  }

  function insertLibraryEntry(libraryId, index = null) {
    const entry = state.cvLibrary?.find((item) => item.id === libraryId);
    if (!entry) {
      return null;
    }

    const item = seedLayoutItemFromLibrary(entry);
    insertLayoutItem(item, index);
    return item.id;
  }

  function removeLibraryEntry(libraryId) {
    const index = state.cvLibrary.findIndex((item) => item.id === libraryId);
    if (index === -1) {
      return null;
    }

    const [removed] = state.cvLibrary.splice(index, 1);
    state.cvLibrary = [...state.cvLibrary];
    saveState();
    renderRail();

    window.AchieveMateToast?.show("Removed from library", {
      actionLabel: "Undo",
      onAction: () => {
        const next = [...state.cvLibrary];
        next.splice(index, 0, removed);
        state.cvLibrary = next;
        saveState();
        renderRail();
      },
    });

    return removed;
  }

  function createLayoutItem(type, achievementId) {
    if (type === "heading") {
      return {
        id: createId("cv"),
        type: "heading",
        title: "",
      };
    }

    if (type === "cv-item") {
      return {
        id: createId("cv"),
        type: "cv-item",
        title: "",
        subtitle: "",
        date: "",
        location: "",
        description: "",
      };
    }

    return {
      id: createId("cv"),
      type: "achievement",
      achievementId,
    };
  }

  function insertLayoutItem(item, index) {
    const next = [...state.cvLayout];
    const safeIndex = index == null ? next.length : Math.max(0, Math.min(index, next.length));
    next.splice(safeIndex, 0, item);
    state.cvLayout = next;
    saveState();
    renderRail();
    window.AchieveMateCvPreview?.render({ flashItemId: item.id });
    return item.id;
  }

  function moveLayoutItem(fromIndex, toIndex) {
    const next = [...state.cvLayout];
    if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= next.length) {
      return null;
    }

    const [moved] = next.splice(fromIndex, 1);
    const safeIndex = toIndex > fromIndex ? toIndex - 1 : toIndex;
    next.splice(Math.max(0, Math.min(safeIndex, next.length)), 0, moved);
    state.cvLayout = next;
    saveState();
    renderRail();
    window.AchieveMateCvPreview?.render({ flashItemId: moved.id });
    return moved.id;
  }

  function removeLayoutItem(layoutItemId) {
    const index = state.cvLayout.findIndex((item) => item.id === layoutItemId);
    if (index === -1) {
      return null;
    }

    const [removed] = state.cvLayout.splice(index, 1);
    state.cvLayout = [...state.cvLayout];
    saveState();
    renderRail();
    window.AchieveMateCvPreview?.render();
    return { removed, index };
  }

  function setDragPayload(event, payload) {
    window.AchieveMateDrag.payload = payload;
    event.dataTransfer.effectAllowed = payload.type === "library" ? "copy" : "copyMove";
    event.dataTransfer.setData("application/json", JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", payload.type || "block");
  }

  function beginDragPreview(event, sourceEl, payload) {
    window.AchieveMateDragPreview?.begin(event, sourceEl, { variant: "rail", payload });
  }

  function addHeadingToCv(index = null) {
    const item = createLayoutItem("heading");
    insertLayoutItem(item, index);
  }

  function addCvItemToCv(index = null) {
    const item = createLayoutItem("cv-item");
    insertLayoutItem(item, index);
  }

  function bindPaletteRailBlock(block, { type, addToCv, titleHint }) {
    if (!block) {
      return;
    }

    let suppressClick = false;

    block.setAttribute("title", titleHint);
    block.setAttribute("role", "button");
    block.tabIndex = 0;

    block.addEventListener("dragstart", (event) => {
      suppressClick = true;
      const payload = { source: "rail", type };
      setDragPayload(event, payload);
      beginDragPreview(event, block, payload);
      block.classList.add("is-dragging");
    });

    block.addEventListener("dragend", () => {
      block.classList.remove("is-dragging");
      window.AchieveMateDrag.payload = null;
      window.AchieveMateDragPreview?.end();
      window.AchieveMateCvPreview?.hideInsertionLine();
      window.setTimeout(() => {
        suppressClick = false;
      }, 0);
    });

    block.addEventListener("click", () => {
      if (suppressClick) {
        return;
      }
      addToCv();
    });

    block.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      addToCv();
    });
  }

  function bindPaletteHeading() {
    bindPaletteRailBlock(cvPalette?.querySelector('[data-block-type="heading"]'), {
      type: "heading",
      addToCv: addHeadingToCv,
      titleHint: "Click to add at end, or drag to place on CV",
    });
    bindPaletteRailBlock(cvPalette?.querySelector('[data-block-type="cv-item"]'), {
      type: "cv-item",
      addToCv: addCvItemToCv,
      titleHint: "Click to add at end, or drag to place on CV",
    });
  }

  function libraryCardLabel(entry) {
    const title = entry.title?.trim();
    if (title) {
      return title;
    }
    const subtitle = entry.subtitle?.trim();
    if (subtitle) {
      return subtitle;
    }
    const description = String(entry.description || "")
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean);
    return description || "Saved item";
  }

  function libraryCardMeta(entry) {
    return [entry.date, entry.subtitle, entry.location]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .filter((value, index, list) => list.indexOf(value) === index)
      .slice(0, 2)
      .join(" · ");
  }

  function renderLibraryEmpty() {
    const empty = document.createElement("p");
    empty.className = "library-empty";
    empty.textContent = "Star an item on the CV to save it here.";
    cvLibraryList.appendChild(empty);
  }

  function bindLibraryBlock(block, entry) {
    let suppressClick = false;

    block.setAttribute("title", "Click to add at end, or drag to place on CV");
    block.setAttribute("aria-label", `Insert ${libraryCardLabel(entry)}`);
    block.tabIndex = 0;

    block.addEventListener("dragstart", (event) => {
      if (event.target.closest(".rail-block-remove")) {
        event.preventDefault();
        return;
      }
      suppressClick = true;
      const payload = { source: "rail", type: "library", libraryId: entry.id };
      setDragPayload(event, payload);
      beginDragPreview(event, block, payload);
      block.classList.add("is-dragging");
    });

    block.addEventListener("dragend", () => {
      block.classList.remove("is-dragging");
      window.AchieveMateDrag.payload = null;
      window.AchieveMateDragPreview?.end();
      window.AchieveMateCvPreview?.hideInsertionLine();
      window.setTimeout(() => {
        suppressClick = false;
      }, 0);
    });

    block.addEventListener("click", (event) => {
      if (suppressClick || event.target.closest(".rail-block-remove")) {
        return;
      }
      insertLibraryEntry(entry.id);
    });

    block.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      insertLibraryEntry(entry.id);
    });

    block.querySelector(".rail-block-remove")?.addEventListener("mousedown", (event) => {
      event.stopPropagation();
      event.preventDefault();
    });

    block.querySelector(".rail-block-remove")?.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      removeLibraryEntry(entry.id);
    });
  }

  function renderLibrary() {
    if (!cvLibraryList) {
      return;
    }

    cvLibraryList.innerHTML = "";
    updateRailCount();

    if (!Array.isArray(state.cvLibrary) || state.cvLibrary.length === 0) {
      renderLibraryEmpty();
      return;
    }

    state.cvLibrary.forEach((entry) => {
      const block = document.createElement("div");
      block.className = "rail-block rail-block-achievement rail-block-library cv-draggable";
      block.draggable = true;
      block.dataset.blockType = "library";
      block.dataset.libraryId = entry.id;
      block.dataset.source = "palette";

      const meta = libraryCardMeta(entry);
      block.innerHTML = `
        <span class="rail-block-label">${escapeHtml(libraryCardLabel(entry))}</span>
        ${meta ? `<span class="rail-block-meta">${escapeHtml(meta)}</span>` : ""}
        <button type="button" class="rail-block-remove" aria-label="Remove from library" draggable="false">×</button>
      `;

      bindLibraryBlock(block, entry);
      cvLibraryList.appendChild(block);
    });
  }

  function renderRail() {
    renderLibrary();
    updateClearCvButton();
  }

  bindPaletteHeading();
  studioClearCvBtn?.addEventListener("click", handleClearCvClick);
  renderRail();

  window.AchieveMateCvBuilder = {
    render: renderRail,
    createLayoutItem,
    insertLayoutItem,
    moveLayoutItem,
    removeLayoutItem,
    clearAllCvItems,
    getAchievement,
    isOnCv,
    saveLibrarySnapshot,
    insertLibraryEntry,
    removeLibraryEntry,
  };
})();
