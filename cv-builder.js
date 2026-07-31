(function initCvBuilder() {
  const app = window.AchieveMateApp;
  if (!app) {
    return;
  }

  const { state, saveState, createId, escapeHtml, sortAchievementsForStudio } = app;

  const cvPalette = document.getElementById("cvPalette");
  const cvAchievementPalette = document.getElementById("cvAchievementPalette");
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
      studioRailCount.textContent = String(state.achievements.length);
    }
  }

  function createLayoutItem(type, achievementId) {
    if (type === "heading") {
      return {
        id: createId("cv"),
        type: "heading",
        title: "Section Title",
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
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/json", JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", payload.type || "block");
  }

  function beginDragPreview(event, sourceEl, payload) {
    window.AchieveMateDragPreview?.begin(event, sourceEl, { variant: "rail", payload });
  }

  function bindPaletteHeading() {
    const headingBlock = cvPalette?.querySelector('[data-block-type="heading"]');
    if (!headingBlock) {
      return;
    }

    headingBlock.addEventListener("dragstart", (event) => {
      setDragPayload(event, {
        source: "rail",
        type: "heading",
      });
      beginDragPreview(event, headingBlock, {
        source: "rail",
        type: "heading",
      });
      headingBlock.classList.add("is-dragging");
    });

    headingBlock.addEventListener("dragend", () => {
      headingBlock.classList.remove("is-dragging");
      window.AchieveMateDrag.payload = null;
      window.AchieveMateDragPreview?.end();
      window.AchieveMateCvPreview?.hideInsertionLine();
    });
  }

  function renderRailEmpty() {
    const empty = document.createElement("div");
    empty.className = "empty-state is-compact";
    empty.innerHTML = `
      <div class="empty-state-glyph" aria-hidden="true">⚓</div>
      <h3 class="empty-state-headline">No achievements yet</h3>
      <p class="empty-state-body">Log entries in the Logbook to compose your CV.</p>
      <button type="button" class="btn btn-ghost">Open Logbook</button>
    `;
    empty.querySelector("button").addEventListener("click", () => {
      window.AchieveMateViews?.setActiveView("logbook");
    });
    cvAchievementPalette.appendChild(empty);
  }

  function renderAchievementPalette() {
    if (!cvAchievementPalette) {
      return;
    }

    cvAchievementPalette.innerHTML = "";
    updateRailCount();

    if (state.achievements.length === 0) {
      renderRailEmpty();
      return;
    }

    sortAchievementsForStudio(state.achievements).forEach((achievement) => {
      const onCv = isOnCv(achievement.id);
      const block = document.createElement("div");
      block.className = `rail-block rail-block-achievement cv-draggable${onCv ? " is-on-cv" : ""}`;
      block.draggable = true;
      block.dataset.blockType = "achievement";
      block.dataset.achievementId = achievement.id;
      block.dataset.source = "palette";

      const title = achievement.title?.trim() || "Untitled achievement";
      const date = achievement.date?.trim() || "No date";

      block.innerHTML = `
        ${onCv ? '<span class="rail-block-oncv">On CV</span>' : ""}
        <span class="rail-block-label">${escapeHtml(title)}</span>
        <span class="rail-block-meta">${escapeHtml(date)}</span>
      `;

      block.addEventListener("dragstart", (event) => {
        setDragPayload(event, {
          source: "rail",
          type: "achievement",
          achievementId: achievement.id,
        });
        beginDragPreview(event, block, {
          source: "rail",
          type: "achievement",
          achievementId: achievement.id,
        });
        block.classList.add("is-dragging");
      });

      block.addEventListener("dragend", () => {
        block.classList.remove("is-dragging");
        window.AchieveMateDrag.payload = null;
        window.AchieveMateDragPreview?.end();
        window.AchieveMateCvPreview?.hideInsertionLine();
      });

      cvAchievementPalette.appendChild(block);
    });
  }

  function renderRail() {
    renderAchievementPalette();
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
  };
})();
