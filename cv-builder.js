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
    window.AchieveMateCvHistory?.record?.("Clear CV");

    window.AchieveMateToast?.show("CV cleared — start fresh", {
      actionLabel: "Undo",
      onAction: () => {
        if (window.AchieveMateCvHistory?.canUndo?.()) {
          window.AchieveMateCvHistory.undo();
          return;
        }
        state.cvLayout = previousLayout;
        state.cvPreviewEdits.items = previousItemEdits;
        saveState();
        renderRail();
        window.AchieveMateCvPreview?.render();
        window.AchieveMateCvHistory?.record?.("Restore CV");
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
    if (!studioRailCount) {
      return;
    }
    const count = state.cvLibrary?.length || 0;
    studioRailCount.textContent = String(count);
    studioRailCount.hidden = count === 0;
  }

  function librarySnapshotKey(entry) {
    return (LIBRARY_FIELDS || ['title', 'subtitle', 'date', 'location', 'description'])
      .map((field) => String(entry?.[field] || '').replace(/\s+/g, ' ').trim())
      .join('\u0001');
  }

  function linkLayoutItemToLibrary(layoutItem, libraryEntryId) {
    if (!layoutItem || !libraryEntryId) {
      return;
    }
    layoutItem.libraryEntryId = libraryEntryId;
    state.cvLayout = [...state.cvLayout];
  }

  function findLibraryEntryBySnapshot(snapshot) {
    const entry = normalizeLibraryEntry?.({ ...snapshot, id: 'tmp', savedAt: 0 });
    if (!entry || !Array.isArray(state.cvLibrary)) {
      return null;
    }
    const key = librarySnapshotKey(entry);
    return state.cvLibrary.find((item) => librarySnapshotKey(item) === key) || null;
  }

  function saveLibrarySnapshot(snapshot, options = {}) {
    const sourceLayoutItemId =
      typeof options.sourceLayoutItemId === 'string'
        ? options.sourceLayoutItemId
        : typeof options.layoutItemId === 'string'
          ? options.layoutItemId
          : '';
    const layoutItem = sourceLayoutItemId
      ? state.cvLayout.find((item) => item.id === sourceLayoutItemId)
      : null;

    const draft = normalizeLibraryEntry?.({
      ...snapshot,
      id: createId('lib'),
      savedAt: Date.now(),
      sourceLayoutItemId: sourceLayoutItemId || undefined,
    });
    if (!draft) {
      window.AchieveMateToast?.show('Add some text before saving this item.', { tone: 'neutral' });
      return { saved: false, reason: 'empty' };
    }

    if (!Array.isArray(state.cvLibrary)) {
      state.cvLibrary = [];
    }

    const linkedId = typeof layoutItem?.libraryEntryId === 'string' ? layoutItem.libraryEntryId : '';
    if (linkedId) {
      const linkedIndex = state.cvLibrary.findIndex((item) => item.id === linkedId);
      if (linkedIndex !== -1) {
        const linked = state.cvLibrary[linkedIndex];
        if (librarySnapshotKey(linked) === librarySnapshotKey(draft)) {
          linkLayoutItemToLibrary(layoutItem, linked.id);
          saveState();
          window.AchieveMateCvPreview?.syncLibraryStars?.();
          window.AchieveMateToast?.show('Already in your library', { tone: 'neutral' });
          return { saved: false, reason: 'duplicate', entry: linked };
        }

        const updated = normalizeLibraryEntry({
          ...draft,
          id: linked.id,
          savedAt: Date.now(),
          sourceLayoutItemId: sourceLayoutItemId || linked.sourceLayoutItemId,
        });
        const next = [...state.cvLibrary];
        next.splice(linkedIndex, 1);
        state.cvLibrary = [updated, ...next];
        linkLayoutItemToLibrary(layoutItem, updated.id);
        saveState();
        renderRail();
        window.AchieveMateCvPreview?.syncLibraryStars?.();
        window.AchieveMateCvHistory?.record?.('Update library');
        window.AchieveMateToast?.show('Updated in library');
        return { saved: true, updated: true, entry: updated };
      }
    }

    const existing = findLibraryEntryBySnapshot(draft);
    if (existing) {
      if (layoutItem && layoutItem.libraryEntryId !== existing.id) {
        linkLayoutItemToLibrary(layoutItem, existing.id);
        saveState();
        window.AchieveMateCvPreview?.syncLibraryStars?.();
        window.AchieveMateCvHistory?.record?.('Save to library');
      }
      window.AchieveMateToast?.show('Already in your library', { tone: 'neutral' });
      return { saved: false, reason: 'duplicate', entry: existing };
    }

    const entry = draft;
    state.cvLibrary = [entry, ...state.cvLibrary];
    linkLayoutItemToLibrary(layoutItem, entry.id);
    saveState();
    renderRail();
    window.AchieveMateCvPreview?.syncLibraryStars?.();
    window.AchieveMateCvHistory?.record?.('Save to library');
    window.AchieveMateToast?.show('Saved to library');
    return { saved: true, entry };
  }

  function toggleLibrarySnapshot(snapshot, options = {}) {
    const sourceLayoutItemId =
      typeof options.sourceLayoutItemId === 'string'
        ? options.sourceLayoutItemId
        : typeof options.layoutItemId === 'string'
          ? options.layoutItemId
          : '';
    if (sourceLayoutItemId) {
      const layoutItem = state.cvLayout.find((item) => item.id === sourceLayoutItemId);
      if (layoutItem?.libraryEntryId) {
        const linked = state.cvLibrary.find((item) => item.id === layoutItem.libraryEntryId);
        if (linked) {
          removeLibraryEntry(linked.id);
          return { saved: false, removed: true, entry: linked };
        }
      }
    }

    const existing = findLibraryEntryBySnapshot(snapshot);
    if (existing) {
      removeLibraryEntry(existing.id);
      return { saved: false, removed: true, entry: existing };
    }
    return saveLibrarySnapshot(snapshot, options);
  }

  function seedLayoutItemFromLibrary(entry) {
    const item = createLayoutItem('cv-item');
    item.libraryEntryId = entry.id;
    const bucket = {};
    (LIBRARY_FIELDS || ['title', 'subtitle', 'date', 'location', 'description']).forEach((field) => {
      if (String(entry[field] || '').trim()) {
        bucket[field] = entry[field];
      }
    });

    if (!state.cvPreviewEdits.items || typeof state.cvPreviewEdits.items !== 'object') {
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

  function clearLibraryLinks(libraryId) {
    const linkedIds = [];
    let changed = false;
    state.cvLayout.forEach((item) => {
      if (item?.libraryEntryId === libraryId) {
        linkedIds.push(item.id);
        delete item.libraryEntryId;
        changed = true;
      }
    });
    if (changed) {
      state.cvLayout = [...state.cvLayout];
    }
    return linkedIds;
  }

  function restoreLibraryLinks(libraryId, layoutItemIds) {
    if (!Array.isArray(layoutItemIds) || layoutItemIds.length === 0) {
      return;
    }
    const idSet = new Set(layoutItemIds);
    let changed = false;
    state.cvLayout.forEach((item) => {
      if (idSet.has(item.id) && item.libraryEntryId !== libraryId) {
        item.libraryEntryId = libraryId;
        changed = true;
      }
    });
    if (changed) {
      state.cvLayout = [...state.cvLayout];
    }
  }

  function removeLibraryEntry(libraryId) {
    const index = state.cvLibrary.findIndex((item) => item.id === libraryId);
    if (index === -1) {
      return null;
    }

    const [removed] = state.cvLibrary.splice(index, 1);
    state.cvLibrary = [...state.cvLibrary];
    const linkedIds = clearLibraryLinks(libraryId);
    saveState();
    renderRail();
    window.AchieveMateCvPreview?.syncLibraryStars?.();
    window.AchieveMateCvHistory?.record?.('Remove from library');

    window.AchieveMateToast?.show('Removed from library', {
      actionLabel: 'Undo',
      onAction: () => {
        if (window.AchieveMateCvHistory?.canUndo?.()) {
          window.AchieveMateCvHistory.undo();
          return;
        }
        const next = [...state.cvLibrary];
        next.splice(index, 0, removed);
        state.cvLibrary = next;
        restoreLibraryLinks(removed.id, linkedIds);
        saveState();
        renderRail();
        window.AchieveMateCvPreview?.syncLibraryStars?.();
        window.AchieveMateCvHistory?.record?.('Restore library item');
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

    if (type === "skills") {
      return {
        id: createId("cv"),
        type: "skills",
        title: "Skills",
        skills: [],
      };
    }

    return {
      id: createId("cv"),
      type: "achievement",
      achievementId,
    };
  }

  function historyLabelForItem(item) {
    if (item?.type === "heading") {
      const title = String(item.title || "").trim();
      return title ? `Add ${title}` : "Add heading";
    }
    if (item?.type === "skills") {
      return "Add Skills";
    }
    if (item?.type === "cv-item") {
      return item.libraryEntryId ? "Add from library" : "Add CV item";
    }
    return "Add item";
  }

  function insertLayoutItem(item, index, options = {}) {
    const next = [...state.cvLayout];
    const safeIndex = index == null ? next.length : Math.max(0, Math.min(index, next.length));
    next.splice(safeIndex, 0, item);
    state.cvLayout = next;
    saveState();
    renderRail();
    window.AchieveMateCvPreview?.render({
      flashItemId: item.id,
      focusFirstField: Boolean(options.focusFirstField),
    });
    window.AchieveMateCvHistory?.record?.(options.historyLabel || historyLabelForItem(item));
    return item.id;
  }

  function headingTitleMatches(item, title) {
    if (!item || item.type !== "heading") {
      return false;
    }
    const stored = state.cvPreviewEdits?.items?.[item.id]?.title;
    const current = String(stored != null ? stored : item.title || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    return current === String(title || "").trim().toLowerCase();
  }

  function findSectionHeading(title) {
    return state.cvLayout.find((item) => headingTitleMatches(item, title)) || null;
  }

  const ADD_KINDS = {
    experience: { sectionTitle: "Experience", historyLabel: "Add Experience" },
    education: { sectionTitle: "Education", historyLabel: "Add Education" },
    skills: { historyLabel: "Add Skills", layoutType: "skills" },
    "free-text": { sectionTitle: null, historyLabel: "Add CV item" },
  };

  function addBlockKind(kind, index = null) {
    const config = ADD_KINDS[kind] || ADD_KINDS["free-text"];
    const next = [...state.cvLayout];
    let insertAt = index == null ? next.length : Math.max(0, Math.min(index, next.length));
    let focusId = null;

    if (config.layoutType === "skills") {
      const item = createLayoutItem("skills");
      next.splice(insertAt, 0, item);
      focusId = item.id;
    } else {
      if (config.sectionTitle && !findSectionHeading(config.sectionTitle)) {
        const heading = createLayoutItem("heading");
        heading.title = config.sectionTitle;
        next.splice(insertAt, 0, heading);
        insertAt += 1;
      }

      const item = createLayoutItem("cv-item");
      if (kind === "experience" || kind === "education") {
        item.itemKind = kind;
      }
      next.splice(insertAt, 0, item);
      focusId = item.id;
    }

    state.cvLayout = next;
    saveState();
    renderRail();
    window.AchieveMateCvPreview?.render({
      flashItemId: focusId,
      focusFirstField: true,
    });
    window.AchieveMateCvHistory?.record?.(config.historyLabel);
    return focusId;
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
    window.AchieveMateCvHistory?.record?.("Move item");
    return moved.id;
  }

  function removeLayoutItem(layoutItemId, options = {}) {
    const index = state.cvLayout.findIndex((item) => item.id === layoutItemId);
    if (index === -1) {
      return null;
    }

    const [removed] = state.cvLayout.splice(index, 1);
    const itemEdits = (() => {
      const bucket = state.cvPreviewEdits?.items?.[layoutItemId];
      if (!bucket || typeof bucket !== "object") {
        return null;
      }
      const copy = JSON.parse(JSON.stringify(bucket));
      delete state.cvPreviewEdits.items[layoutItemId];
      return copy;
    })();

    const alsoRemoved = [];
    if (
      options.pruneKindHeading &&
      removed?.type === "cv-item" &&
      (removed.itemKind === "experience" || removed.itemKind === "education")
    ) {
      const sectionTitle = removed.itemKind === "experience" ? "Experience" : "Education";
      const stillHasKind = state.cvLayout.some(
        (item) => item.type === "cv-item" && item.itemKind === removed.itemKind
      );
      if (!stillHasKind) {
        const headingIndex = state.cvLayout.findIndex((item) => headingTitleMatches(item, sectionTitle));
        if (headingIndex !== -1) {
          const [heading] = state.cvLayout.splice(headingIndex, 1);
          const headingEdits = (() => {
            const bucket = state.cvPreviewEdits?.items?.[heading.id];
            if (!bucket || typeof bucket !== "object") {
              return null;
            }
            const copy = JSON.parse(JSON.stringify(bucket));
            delete state.cvPreviewEdits.items[heading.id];
            return copy;
          })();
          alsoRemoved.push({ item: heading, index: headingIndex, itemEdits: headingEdits });
        }
      }
    }

    state.cvLayout = [...state.cvLayout];
    saveState();
    renderRail();
    window.AchieveMateCvPreview?.render({ force: Boolean(options.forceRender) });
    window.AchieveMateCvHistory?.record?.(
      removed?.type === "heading" ? "Remove heading" : "Remove item"
    );
    return { removed, index, itemEdits, alsoRemoved };
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

  function bindPaletteRailBlock(block, { type, addToCv, titleHint, addKind = null }) {
    if (!block) {
      return;
    }

    let suppressClick = false;

    block.setAttribute("title", titleHint);
    block.setAttribute("role", "button");
    if (!block.hasAttribute("tabindex")) {
      block.tabIndex = 0;
    }

    block.addEventListener("dragstart", (event) => {
      suppressClick = true;
      const payload = addKind
        ? { source: "rail", type: "add", addKind }
        : { source: "rail", type };
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
    cvPalette?.querySelectorAll("[data-add-kind]").forEach((block) => {
      const addKind = block.dataset.addKind;
      if (!ADD_KINDS[addKind]) {
        return;
      }
      bindPaletteRailBlock(block, {
        type: addKind === "free-text" ? "cv-item" : "add",
        addKind,
        addToCv: () => addBlockKind(addKind),
        titleHint: "Click to add at end, or drag to place on CV",
      });
    });
  }

  function setRailTab(tab) {
    const addTab = document.getElementById("railTabAdd");
    const libraryTab = document.getElementById("railTabLibrary");
    const addPanel = document.getElementById("railAddPanel");
    const libraryPanel = document.getElementById("cvLibrarySection");
    const showLibrary = tab === "library";

    addTab?.setAttribute("aria-selected", showLibrary ? "false" : "true");
    libraryTab?.setAttribute("aria-selected", showLibrary ? "true" : "false");
    if (addPanel) {
      addPanel.hidden = showLibrary;
    }
    if (libraryPanel) {
      libraryPanel.hidden = !showLibrary;
    }
  }

  function bindRailTabs() {
    document.getElementById("railTabAdd")?.addEventListener("click", () => setRailTab("add"));
    document.getElementById("railTabLibrary")?.addEventListener("click", () => setRailTab("library"));
    setRailTab("add");
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
      window.AchieveMateApp?.renderAchievements?.();
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

    window.AchieveMateApp?.renderAchievements?.();
  }

  function renderRail() {
    renderLibrary();
    updateClearCvButton();
  }

  bindPaletteHeading();
  bindRailTabs();
  studioClearCvBtn?.addEventListener("click", handleClearCvClick);
  renderRail();

  window.AchieveMateCvBuilder = {
    render: renderRail,
    createLayoutItem,
    insertLayoutItem,
    addBlockKind,
    moveLayoutItem,
    removeLayoutItem,
    clearAllCvItems,
    getAchievement,
    isOnCv,
    saveLibrarySnapshot,
    toggleLibrarySnapshot,
    findLibraryEntryBySnapshot,
    insertLibraryEntry,
    removeLibraryEntry,
  };
})();
