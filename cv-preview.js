(function initCvPreview() {
  const app = window.AchieveMateApp;
  if (!app) {
    return;
  }

  const { state, saveState, createId, escapeHtml, getStarIconSvg } = app;

  const cvPreview = document.getElementById("cvPreview");
  const cvPreviewScaler = document.getElementById("cvPreviewScaler");
  const exportPdfBtn = document.getElementById("exportPdfBtn");
  const exportHistoryList = document.getElementById("exportHistoryList");
  const drawerExportHistoryList = document.getElementById("drawerExportHistoryList");
  const exportModal = document.getElementById("exportModal");
  const exportModalOverlay = document.getElementById("exportModalOverlay");
  const exportModalCaption = document.getElementById("exportModalCaption");
  const exportFileNameInput = document.getElementById("exportFileNameInput");
  const exportModalCancel = document.getElementById("exportModalCancel");
  const exportModalConfirm = document.getElementById("exportModalConfirm");
  const exportModalConfirmLabel = document.getElementById("exportModalConfirmLabel");

  let isEditingPreview = false;
  let isExportingPdf = false;
  let lastExportFileName = null;
  let armedRestoreEntryId = null;
  let armedRestoreTimer = null;
  let armedRestoreButton = null;
  let layoutFrame = null;
  let pdfFitOverride = null;
  let fitPreviewFrame = null;
  let editSaveTimer = null;
  let layoutDebounceTimer = null;
  let baseFitScale = 1;
  let userZoom = 1.72;
  let documentDragState = null;
  let documentDragCancelled = false;
  let sectionPointer = null;
  let sectionDragSession = null;
  let cvItemEnterNavSource = null;
  const editSessionDirty = new WeakMap();

  function markEditSessionDirty(node) {
    if (node) {
      editSessionDirty.set(node, true);
    }
  }

  function consumeEditSessionDirty(node) {
    if (!node || !editSessionDirty.get(node)) {
      return false;
    }
    editSessionDirty.delete(node);
    return true;
  }

  function beginEditSession(node) {
    if (node) {
      editSessionDirty.set(node, false);
    }
  }
  const SECTION_DRAG_THRESHOLD_PX = 8;
  const CV_ITEM_PLACEHOLDERS = {
    title: "Title",
    subtitle: "Subtitle",
    date: "DATE",
    location: "Location",
    description: "Bullet 1\nBullet 2\nBullet 3",
  };
  const CV_BULLET_PREFIX = "• ";

  function clearSectionPointer() {
    if (sectionPointer?.wrap) {
      sectionPointer.wrap.classList.remove("is-drag-armed");
    }
    sectionPointer = null;
    setPointerDragSelectLock(false);
  }

  function setPointerDragSelectLock(active) {
    document.body.classList.toggle("cv-pointer-drag-active", active);
  }

  function resolveEditTarget(target) {
    if (!target) {
      return null;
    }

    return target.closest("[data-edit-key]");
  }

  function placeCaretAtPoint(clientX, clientY) {
    if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(clientX, clientY);
      if (range) {
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return;
      }
    }

    if (document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(clientX, clientY);
      if (position) {
        const range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  }

  function normalizePlaceholderCompare(value) {
    return editPlainText(value).replace(/\s+/g, " ").trim();
  }

  function descriptionPlaceholderLines(value) {
    return String(value || "")
      .split("\n")
      .map((line) => line.trim().replace(/^[•\-*]\s*/, ""))
      .filter(Boolean);
  }

  function descriptionsMatchPlaceholder(content, placeholder) {
    const current = descriptionPlaceholderLines(content);
    const expected = descriptionPlaceholderLines(placeholder);
    if (current.length !== expected.length) {
      return false;
    }
    return current.every((line, index) => line === expected[index]);
  }

  function nodeShowsPlaceholder(node) {
    const placeholder = node.dataset.placeholderText;
    if (!placeholder) {
      return false;
    }

    if (node.classList.contains("cv-preview-description")) {
      return descriptionsMatchPlaceholder(getNodeEditContent(node), placeholder);
    }

    return normalizePlaceholderCompare(node.textContent) === normalizePlaceholderCompare(placeholder);
  }

  function syncNodePlaceholderClass(node) {
    if (node.classList.contains("is-editing")) {
      node.classList.remove("cv-preview-placeholder");
      return;
    }

    node.classList.toggle("cv-preview-placeholder", nodeShowsPlaceholder(node));
  }

  function syncAllPlaceholderClasses() {
    cvPreview?.querySelectorAll("[data-placeholder-text]").forEach(syncNodePlaceholderClass);
  }

  function selectAllInNode(node) {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function placeCaretAfterFirstBullet(node) {
    const selection = window.getSelection();
    const range = document.createRange();
    const treeWalker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let textNode = treeWalker.nextNode();

    while (textNode) {
      const text = textNode.textContent || "";
      const bulletIndex = text.indexOf("•");
      if (bulletIndex !== -1) {
        let offset = bulletIndex + 1;
        while (offset < text.length && text[offset] === " ") {
          offset += 1;
        }
        range.setStart(textNode, Math.min(offset, text.length));
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);
        return;
      }
      textNode = treeWalker.nextNode();
    }

    if (!node.textContent?.trim()) {
      node.textContent = CV_BULLET_PREFIX;
    }

    range.selectNodeContents(node);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function setTextOffsetRange(root, start, end) {
    const range = document.createRange();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let pos = 0;
    let startSet = false;
    let textNode = walker.nextNode();

    while (textNode) {
      const len = textNode.textContent?.length || 0;
      if (!startSet && pos + len >= start) {
        range.setStart(textNode, Math.max(0, start - pos));
        startSet = true;
      }
      if (startSet && pos + len >= end) {
        range.setEnd(textNode, Math.max(0, end - pos));
        break;
      }
      pos += len;
      textNode = walker.nextNode();
    }

    if (!startSet) {
      return;
    }

    if (range.compareBoundaryPoints(Range.END_TO_START, range) >= 0) {
      range.collapse(true);
    }

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function descriptionLineIndexAtPoint(node, clientX, clientY) {
    placeCaretAtPoint(clientX, clientY);
    const selection = window.getSelection();
    if (!selection?.rangeCount) {
      return 0;
    }

    const range = selection.getRangeAt(0);
    const preRange = document.createRange();
    preRange.selectNodeContents(node);
    preRange.setEnd(range.startContainer, range.startOffset);
    const textBefore = preRange.toString();
    return (textBefore.match(/\n/g) || []).length;
  }

  function selectDescriptionPlaceholderLine(node, lineIndex) {
    const fullText = node.textContent || "";
    const lines = fullText.split("\n");
    const idx = Math.max(0, Math.min(lineIndex, lines.length - 1));
    let charStart = 0;

    for (let i = 0; i < idx; i += 1) {
      charStart += lines[i].length + 1;
    }

    const line = lines[idx] || "";
    const match = line.match(/^(\s*•\s*)(.*)$/);
    if (!match) {
      setTextOffsetRange(node, charStart, charStart + line.length);
      return;
    }

    const prefixLen = match[1].length;
    setTextOffsetRange(node, charStart + prefixLen, charStart + line.length);
  }

  function activateDescriptionEdit(node, event) {
    const isPlaceholder = cvItemFieldShowsPlaceholder(node);

    if (isPlaceholder) {
      const lineIndex = event
        ? descriptionLineIndexAtPoint(node, event.clientX, event.clientY)
        : 0;
      selectDescriptionPlaceholderLine(node, lineIndex);
      return;
    }

    if (event) {
      placeCaretAtPoint(event.clientX, event.clientY);
      return;
    }

    placeCaretAfterFirstBullet(node);
  }

  function restorePlaceholderDisplay(node) {
    const placeholder = node.dataset.placeholderText;
    if (!placeholder) {
      return;
    }

    if (node.classList.contains("cv-preview-description")) {
      node.innerHTML = descriptionToEditableHtml(placeholder);
    } else {
      node.innerHTML = richTextToHtml(placeholder);
    }

    syncNodePlaceholderClass(node);
  }

  function normalizeSavedEditValue(node, value) {
    const placeholder = node.dataset.placeholderText;
    if (!placeholder) {
      return value;
    }

    if (node.classList.contains("cv-preview-description")) {
      if (descriptionsMatchPlaceholder(value, placeholder)) {
        return "";
      }
      return value;
    }

    if (normalizePlaceholderCompare(value) === normalizePlaceholderCompare(placeholder)) {
      return "";
    }

    return value;
  }

  function isEditValueEmpty(node, value) {
    if (node.classList.contains("cv-preview-description")) {
      return descriptionPlaceholderLines(value).length === 0;
    }

    return normalizePlaceholderCompare(value) === "";
  }

  const CV_ITEM_FIELD_KEYS = ["title", "date", "subtitle", "location", "description"];

  function getCvItemStoredField(item, field) {
    const bucket = state.cvPreviewEdits?.items?.[item.id];
    if (!bucket || !Object.prototype.hasOwnProperty.call(bucket, field)) {
      return undefined;
    }
    return bucket[field];
  }

  function getCvItemFieldContent(item, field) {
    const stored = getCvItemStoredField(item, field);
    if (stored == null || stored === "") {
      return "";
    }

    const placeholder = CV_ITEM_PLACEHOLDERS[field];
    if (placeholder && field === "description" && descriptionsMatchPlaceholder(stored, placeholder)) {
      return "";
    }
    if (
      placeholder &&
      field !== "description" &&
      normalizePlaceholderCompare(stored) === normalizePlaceholderCompare(placeholder)
    ) {
      return "";
    }

    return stored;
  }

  function isCvItemFieldFilled(value, field) {
    if (value == null) {
      return false;
    }

    const placeholder = CV_ITEM_PLACEHOLDERS[field];
    if (field === "description") {
      if (placeholder && descriptionsMatchPlaceholder(value, placeholder)) {
        return false;
      }
      return descriptionPlaceholderLines(value).length > 0;
    }

    if (placeholder && normalizePlaceholderCompare(value) === normalizePlaceholderCompare(placeholder)) {
      return false;
    }

    return normalizePlaceholderCompare(value) !== "";
  }

  function cvItemHasUserContent(item) {
    return CV_ITEM_FIELD_KEYS.some((field) => {
      const stored = getCvItemStoredField(item, field);
      return stored !== undefined && isCvItemFieldFilled(stored, field);
    });
  }

  function parseCvItemEditKey(editKey) {
    if (!editKey?.startsWith("items.")) {
      return null;
    }

    const suffix = editKey.slice("items.".length);
    const dot = suffix.lastIndexOf(".");
    if (dot === -1) {
      return null;
    }

    const itemId = suffix.slice(0, dot);
    const field = suffix.slice(dot + 1);
    if (!CV_ITEM_FIELD_KEYS.includes(field)) {
      return null;
    }

    const item = state.cvLayout.find((entry) => entry.id === itemId && entry.type === "cv-item");
    if (!item) {
      return null;
    }

    return { item, field };
  }

  function cvItemFieldShowsPlaceholder(node) {
    const parsed = parseCvItemEditKey(node.dataset.editKey);
    if (!parsed) {
      return nodeShowsPlaceholder(node);
    }

    const content = getCvItemFieldContent(parsed.item, parsed.field);
    return !isCvItemFieldFilled(content, parsed.field);
  }

  function syncCvItemWrapAfterEdit(section) {
    const itemId = section?.dataset?.itemId;
    const item = state.cvLayout.find((entry) => entry.id === itemId && entry.type === "cv-item");
    const wrap = section?.closest(".cv-section-wrap");
    if (!item || !wrap) {
      return;
    }

    const isDraft = !cvItemHasUserContent(item);
    wrap.classList.toggle("is-cv-item-collapsed", !isDraft);
    refreshLibrarySaveButton(item.id);

    CV_ITEM_FIELD_KEYS.forEach((field) => {
      const node = section.querySelector(`[data-edit-key$=".${field}"]`);
      if (!node || node.classList.contains("is-editing")) {
        return;
      }

      const content = getCvItemFieldContent(item, field);
      const filled = isCvItemFieldFilled(content, field);

      node.classList.toggle("cv-cv-item-field-hidden", !isDraft && !filled);
      node.classList.toggle("cv-preview-placeholder", !filled);

      if (!filled) {
        restorePlaceholderDisplay(node);
        return;
      }

      if (field === "description") {
        node.innerHTML = descriptionToEditableHtml(content);
      } else {
        node.innerHTML = richTextToHtml(content);
      }
    });
  }

  function getCvItemEditableFields(section) {
    if (!section) {
      return [];
    }

    return CV_ITEM_FIELD_KEYS.map((key) =>
      section.querySelector(`[data-edit-key$=".${key}"]`)
    ).filter(Boolean);
  }

  function commitEditableField(node) {
    finishFieldEdit(node);
  }

  function saveCvItemFieldValue(node) {
    const value = normalizeSavedEditValue(node, getNodeEditContent(node));
    return commitEditKey(node.dataset.editKey, value, { flushSave: true });
  }

  function prepareCvItemFieldNavigation(section, fromIndex) {
    const itemId = section?.dataset?.itemId;
    const item = state.cvLayout.find((entry) => entry.id === itemId && entry.type === "cv-item");
    const wrap = section?.closest(".cv-section-wrap");
    const fields = getCvItemEditableFields(section);

    if (item && wrap && cvItemHasUserContent(item)) {
      wrap.classList.add("is-cv-item-collapsed");
    }

    fields.slice(fromIndex + 1).forEach((fieldNode) => {
      fieldNode.classList.remove("cv-cv-item-field-hidden");
    });
  }

  function finishFieldEdit(node) {
    node.classList.remove("is-editing");
    node.setAttribute("contenteditable", "false");
    if (node.classList.contains("cv-preview-description")) {
      normalizeDescriptionBulletSpacing(node);
    }
    const value = normalizeSavedEditValue(node, getNodeEditContent(node));
    commitEditKey(node.dataset.editKey, value, { flushSave: true });
    const changed = consumeEditSessionDirty(node);

    const cvSection = node.closest(".cv-preview-cv-item");
    if (cvSection) {
      syncCvItemWrapAfterEdit(cvSection);
      syncLibraryStars();
      if (changed) {
        recordCvHistory("Edit text");
      }
      return;
    }

    if (node.dataset.placeholderText && isEditValueEmpty(node, value)) {
      restorePlaceholderDisplay(node);
    } else {
      syncNodePlaceholderClass(node);
    }
    syncLibraryStars();
    if (changed) {
      recordCvHistory("Edit text");
    }
  }

  function updateEditingPreviewFlag() {
    const active = document.activeElement;
    if (active && cvPreview.contains(active) && active.matches("[data-edit-key]")) {
      isEditingPreview = true;
      return;
    }
    isEditingPreview = false;
    scheduleSmartLayoutDebounced();
  }

  function focusEditableField(node) {
    if (!node) {
      return;
    }

    activateEdit(node);
  }

  function bindCvItemEnterNavigation(node) {
    node.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Enter" || event.shiftKey) {
          return;
        }

        const section = node.closest(".cv-preview-cv-item");
        if (!section || node.classList.contains("cv-preview-description")) {
          return;
        }

        const fields = getCvItemEditableFields(section);
        const index = fields.indexOf(node);
        if (index === -1 || index >= fields.length - 1) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        saveCvItemFieldValue(node);
        if (consumeEditSessionDirty(node)) {
          recordCvHistory("Edit text");
        }
        node.classList.remove("is-editing");
        node.setAttribute("contenteditable", "false");

        cvItemEnterNavSource = node;
        prepareCvItemFieldNavigation(section, index);
        focusEditableField(fields[index + 1]);
      },
      true
    );
  }

  function activateEdit(node, event) {
    if (!node) {
      return;
    }

    clearSectionPointer();
    beginEditSession(node);
    const showingPlaceholder = cvItemFieldShowsPlaceholder(node);
    node.setAttribute("contenteditable", "true");
    node.classList.add("is-editing");
    node.classList.remove("cv-preview-placeholder");
    isEditingPreview = true;
    node.focus({ preventScroll: true });

    if (showingPlaceholder) {
      if (node.classList.contains("cv-preview-description")) {
        activateDescriptionEdit(node, event);
      } else {
        selectAllInNode(node);
      }
      return;
    }

    if (event) {
      placeCaretAtPoint(event.clientX, event.clientY);
    }
  }

  function tryActivateEdit(event, explicitTarget = null) {
    if (event.target.closest(".cv-section-remove, .cv-section-handle")) {
      return false;
    }
    if (event.target.closest('[contenteditable="true"].is-editing')) {
      return false;
    }

    const editTarget = explicitTarget || resolveEditTarget(event.target);
    if (!editTarget) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    activateEdit(editTarget, event);
    return true;
  }

  function scheduleEditSave() {
    window.clearTimeout(editSaveTimer);
    editSaveTimer = window.setTimeout(flushEditSave, 500);
  }

  function flushEditSave() {
    window.clearTimeout(editSaveTimer);
    editSaveTimer = null;
    saveState();
  }

  function recordCvHistory(label = "Edit") {
    if (window.AchieveMateCvHistory?.isApplying?.()) {
      return;
    }
    window.AchieveMateCvHistory?.record?.(label);
  }

  function scheduleSmartLayoutDebounced() {
    window.clearTimeout(layoutDebounceTimer);
    layoutDebounceTimer = window.setTimeout(() => {
      layoutDebounceTimer = null;
      if (isEditingPreview) {
        scheduleSmartLayoutDebounced();
        return;
      }
      scheduleSmartLayout({ quiet: true });
    }, 450);
  }

  function beginDocumentDrag(wrap, layoutItemId, event, previewSource) {
    const layoutIndex = state.cvLayout.findIndex((item) => item.id === layoutItemId);
    window.AchieveMateDrag.payload = {
      source: "document",
      layoutItemId,
      layoutIndex,
    };
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData("application/json", JSON.stringify(window.AchieveMateDrag.payload));
    documentDragState = { layoutItemId, handled: false };
    documentDragCancelled = false;
    wrap.classList.add("is-dragging");
    window.AchieveMateDragPreview?.begin(event, previewSource || wrap, { variant: "document" });
  }

  function finishDocumentDrag(event) {
    const wrap = cvPreview?.querySelector(
      `.cv-section-wrap[data-layout-item-id="${documentDragState?.layoutItemId || ""}"]`
    );
    wrap?.classList.remove("is-dragging");
    hideInsertionLine();
    setLibraryDropActive(false);
    removeDraggedSectionIfDroppedOutside(event);
    documentDragState = null;
    documentDragCancelled = false;
    window.AchieveMateDrag.payload = null;
    window.AchieveMateDragPreview?.end();
    sectionDragSession = null;
    clearSectionPointer();
  }

  function startPointerSectionDrag(wrap, layoutItemId, moveEvent) {
    if (sectionDragSession || !wrap) {
      return;
    }

    const layoutIndex = state.cvLayout.findIndex((item) => item.id === layoutItemId);
    if (layoutIndex === -1) {
      return;
    }

    window.AchieveMateDrag.payload = {
      source: "document",
      layoutItemId,
      layoutIndex,
    };
    documentDragState = { layoutItemId, handled: false };
    documentDragCancelled = false;
    wrap.classList.add("is-dragging");

    window.AchieveMateDragPreview?.beginPointer(wrap, {
      variant: "document",
      clientX: moveEvent.clientX,
      clientY: moveEvent.clientY,
    });

    sectionDragSession = { wrap, layoutItemId };

    const onMove = (event) => {
      window.AchieveMateDragPreview?.movePointer(event.clientX, event.clientY);
      const overLibrary = isPointerOverLibrary(event.clientX, event.clientY);
      setLibraryDropActive(overLibrary);
      if (!overLibrary && isPointerOverDocument(event.clientX, event.clientY)) {
        showInsertionLine(resolveDropIndex(getPreviewBody(), event.clientY));
      } else {
        hideInsertionLine();
      }
    };

    const onUp = (event) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);

      const builder = window.AchieveMateCvBuilder;
      hideInsertionLine();

      if (builder && documentDragState && !documentDragCancelled) {
        const currentIndex = state.cvLayout.findIndex((item) => item.id === layoutItemId);

        if (isPointerOverLibrary(event.clientX, event.clientY)) {
          documentDragState.handled = true;
          saveLayoutItemToLibrary(layoutItemId);
          refreshLibrarySaveButton(layoutItemId);
        } else if (currentIndex !== -1 && isPointerOverDocument(event.clientX, event.clientY)) {
          const index = resolveDropIndex(getPreviewBody(), event.clientY);
          documentDragState.handled = true;
          builder.moveLayoutItem(currentIndex, index);
        } else if (event.clientX !== 0 || event.clientY !== 0) {
          documentDragState.handled = true;
          removeSectionFromCv(layoutItemId);
        }
      }

      setLibraryDropActive(false);
      wrap.classList.remove("is-dragging");
      sectionDragSession = null;
      documentDragState = null;
      documentDragCancelled = false;
      window.AchieveMateDrag.payload = null;
      window.AchieveMateDragPreview?.end();
      clearSectionPointer();
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function bindPreviewPointerInteraction() {
    if (!cvPreview) {
      return;
    }

    cvPreview.addEventListener("mousedown", (event) => {
      if (event.button !== 0) {
        return;
      }
      if (event.target.closest(".cv-section-remove, .cv-section-handle, .cv-section-save")) {
        return;
      }
      if (event.target.closest('[contenteditable="true"].is-editing')) {
        return;
      }

      // One click to type — activate the field immediately.
      const editTarget = resolveEditTarget(event.target);
      if (editTarget) {
        tryActivateEdit(event, editTarget);
        return;
      }

      const wrap = event.target.closest(".cv-section-wrap");
      if (!wrap) {
        return;
      }

      sectionPointer = {
        wrap,
        layoutItemId: wrap?.dataset.layoutItemId || null,
        x: event.clientX,
        y: event.clientY,
        target: event.target,
        moved: false,
      };

      event.preventDefault();
      setPointerDragSelectLock(true);

      const onMove = (moveEvent) => {
        if (!sectionPointer) {
          return;
        }

        const distance = Math.hypot(moveEvent.clientX - sectionPointer.x, moveEvent.clientY - sectionPointer.y);
        if (distance >= SECTION_DRAG_THRESHOLD_PX) {
          moveEvent.preventDefault();
          window.getSelection()?.removeAllRanges();
          sectionPointer.moved = true;
          sectionPointer.wrap?.classList.add("is-drag-armed");

          if (sectionPointer.wrap && sectionPointer.layoutItemId) {
            startPointerSectionDrag(sectionPointer.wrap, sectionPointer.layoutItemId, moveEvent);
          }
        }
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);

        if (!sectionPointer) {
          return;
        }

        if (sectionPointer.moved || sectionDragSession) {
          if (!documentDragState) {
            clearSectionPointer();
          }
          return;
        }

        clearSectionPointer();
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    document.addEventListener("selectstart", (event) => {
      if (document.body.classList.contains("cv-pointer-drag-active")) {
        event.preventDefault();
        return;
      }

      const target = event.target;
      if (!(target instanceof Element) || !cvPreview.contains(target)) {
        return;
      }

      // Keep selection inside an active editable field — never the CV chrome.
      if (!target.closest('[data-edit-key].is-editing, [contenteditable="true"].is-editing')) {
        event.preventDefault();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "a") {
        return;
      }

      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        cvPreview.contains(active) &&
        active.matches('[data-edit-key].is-editing, [contenteditable="true"].is-editing')
      ) {
        event.preventDefault();
        selectAllInNode(active);
      }
    });
  }
  const DEFAULT_USER_ZOOM = 1.72;
  const MIN_USER_ZOOM = 1;
  const MAX_USER_ZOOM = 3;
  const ZOOM_STEP = 0.12;

  function displayZoomPercent() {
    return Math.round((userZoom / DEFAULT_USER_ZOOM) * 100);
  }

  function isAtDefaultZoomLevel() {
    return Math.abs(userZoom - DEFAULT_USER_ZOOM) <= 0.001;
  }

  function resetPreviewTransform() {
    if (!cvPreview || !cvPreviewScaler) {
      return;
    }

    cvPreview.style.transform = "none";
  }

  function getPreviewWrap() {
    return document.getElementById("cvPreviewWrap");
  }

  function capturePreviewScroll() {
    const wrap = getPreviewWrap();
    if (!wrap) {
      return null;
    }
    return {
      scrollTop: wrap.scrollTop,
      scrollLeft: wrap.scrollLeft,
    };
  }

  function restorePreviewScroll(snapshot) {
    if (!snapshot) {
      return;
    }
    const wrap = getPreviewWrap();
    if (!wrap) {
      return;
    }
    wrap.scrollTop = snapshot.scrollTop;
    wrap.scrollLeft = snapshot.scrollLeft;
  }

  function measurePreviewFit() {
    const wrap = getPreviewWrap();
    const studioView = document.getElementById("viewStudio");
    if (!wrap || !cvPreview || !studioView || !studioView.classList.contains("is-active")) {
      return null;
    }

    const wrapStyle = getComputedStyle(wrap);
    const padX = parseFloat(wrapStyle.paddingLeft) + parseFloat(wrapStyle.paddingRight);
    const padY = parseFloat(wrapStyle.paddingTop) + parseFloat(wrapStyle.paddingBottom);
    const availableW = Math.max(0, wrap.clientWidth - padX);
    const availableH = Math.max(0, wrap.clientHeight - padY);
    const docW = cvPreview.offsetWidth;
    const docH = cvPreview.offsetHeight;

    if (docW <= 0 || docH <= 0 || availableW <= 0 || availableH <= 0) {
      return null;
    }

    return {
      wrap,
      docW,
      docH,
      availableW,
      availableH,
      baseFitScale: Math.min(availableW / docW, availableH / docH),
    };
  }

  let zoomChipHideTimer = null;
  const ZOOM_CHIP_IDLE_MS = 1500;

  function syncZoomChipLabel() {
    const zoomValue = document.getElementById("previewZoomValue");
    if (zoomValue) {
      zoomValue.textContent = `${displayZoomPercent()}%`;
    }
  }

  function hideZoomChip({ immediate = false } = {}) {
    const chip = document.getElementById("previewZoomChip");
    if (!chip) {
      return;
    }

    window.clearTimeout(zoomChipHideTimer);
    zoomChipHideTimer = null;
    chip.classList.remove("is-visible");

    if (immediate) {
      chip.hidden = true;
      return;
    }

    const finishHide = () => {
      if (!chip.classList.contains("is-visible")) {
        chip.hidden = true;
      }
    };

    chip.addEventListener("transitionend", finishHide, { once: true });
    window.setTimeout(finishHide, 560);
  }

  function scheduleZoomChipHide() {
    const chip = document.getElementById("previewZoomChip");
    if (!chip) {
      return;
    }

    window.clearTimeout(zoomChipHideTimer);
    zoomChipHideTimer = window.setTimeout(() => {
      zoomChipHideTimer = null;
      if (chip.matches(":hover")) {
        scheduleZoomChipHide();
        return;
      }
      hideZoomChip();
    }, ZOOM_CHIP_IDLE_MS);
  }

  function revealZoomChip() {
    const chip = document.getElementById("previewZoomChip");
    if (!chip) {
      return;
    }

    syncZoomChipLabel();

    if (isAtDefaultZoomLevel()) {
      hideZoomChip({ immediate: true });
      return;
    }

    chip.hidden = false;
    chip.offsetWidth;
    chip.classList.add("is-visible");
    scheduleZoomChipHide();
  }

  function updatePreviewZoomChip({ reveal = false } = {}) {
    syncZoomChipLabel();

    if (isAtDefaultZoomLevel()) {
      hideZoomChip({ immediate: true });
      return;
    }

    if (reveal) {
      revealZoomChip();
    }
  }

  function applyPreviewZoom(options = {}) {
    const metrics = measurePreviewFit();
    if (!metrics || !cvPreviewScaler || !cvPreview) {
      return false;
    }

    const { wrap, docW, docH, baseFitScale: nextBaseFitScale } = metrics;
    const preservedScroll = options.resetScroll ? null : capturePreviewScroll();
    baseFitScale = nextBaseFitScale;
    userZoom = Math.max(MIN_USER_ZOOM, Math.min(MAX_USER_ZOOM, userZoom));

    const scale = baseFitScale * userZoom;
    cvPreview.style.transform = `scale(${scale})`;
    cvPreview.style.transformOrigin = "top left";
    cvPreviewScaler.style.width = `${docW * scale}px`;
    cvPreviewScaler.style.height = `${docH * scale}px`;
    wrap.dataset.previewScale = scale.toFixed(3);
    wrap.dataset.userZoom = userZoom.toFixed(3);
    wrap.classList.add("is-preview-fit");

    const isZoomed = userZoom > MIN_USER_ZOOM + 0.001;
    wrap.classList.toggle("is-zoomed", isZoomed);

    if (options.resetScroll || !isZoomed) {
      wrap.scrollTop = 0;
      wrap.scrollLeft = 0;
    } else {
      restorePreviewScroll(preservedScroll);
    }

    if (isAtDefaultZoomLevel()) {
      updatePreviewZoomChip();
    } else {
      syncZoomChipLabel();
    }

    return true;
  }

  function setUserZoom(nextZoom) {
    userZoom = Math.max(MIN_USER_ZOOM, Math.min(MAX_USER_ZOOM, nextZoom));
    applyPreviewZoom();
    updatePreviewZoomChip({ reveal: true });
  }

  function fitPreviewToScreen() {
    userZoom = DEFAULT_USER_ZOOM;
    applyPreviewZoom({ resetScroll: true });
  }

  let fitRevealAttempts = 0;

  function scheduleFitPreview() {
    if (fitPreviewFrame) {
      cancelAnimationFrame(fitPreviewFrame);
    }

    fitPreviewFrame = requestAnimationFrame(() => {
      fitPreviewFrame = null;
      if (applyPreviewZoom()) {
        fitRevealAttempts = 0;
        return;
      }

      const studioView = document.getElementById("viewStudio");
      if (!studioView?.classList.contains("is-active")) {
        return;
      }

      fitRevealAttempts += 1;
      if (fitRevealAttempts < 30) {
        scheduleFitPreview();
      }
    });
  }

  function bindPreviewResizeObserver() {
    const wrap = getPreviewWrap();
    if (!wrap || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      scheduleFitPreview();
    });
    observer.observe(wrap);

    const drawer = document.getElementById("cvLayoutDrawer");
    if (drawer) {
      observer.observe(drawer);
    }

    const appSidebar = document.getElementById("appSidebar");
    if (appSidebar) {
      observer.observe(appSidebar);
    }

    const studioRail = document.getElementById("studioRail");
    if (studioRail) {
      observer.observe(studioRail);
    }

    window.addEventListener("resize", scheduleFitPreview);
  }

  function isStudioViewActive() {
    return document.getElementById("viewStudio")?.classList.contains("is-active");
  }

  function pointerOverPreviewZoomTarget(clientX, clientY) {
    const well = document.querySelector(".studio-well");
    if (!well || !isStudioViewActive()) {
      return false;
    }
    const rect = well.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  function bindPreviewZoomControls() {
    const zoomFitBtn = document.getElementById("previewZoomFitBtn");
    const chip = document.getElementById("previewZoomChip");

    zoomFitBtn?.addEventListener("click", () => {
      fitPreviewToScreen();
    });

    chip?.addEventListener("mouseenter", () => {
      window.clearTimeout(zoomChipHideTimer);
      zoomChipHideTimer = null;
    });

    chip?.addEventListener("mouseleave", () => {
      if (!isAtDefaultZoomLevel() && !chip.hidden) {
        scheduleZoomChipHide();
      }
    });

    document.addEventListener(
      "wheel",
      (event) => {
        if (!(event.ctrlKey || event.metaKey)) {
          return;
        }
        if (!pointerOverPreviewZoomTarget(event.clientX, event.clientY)) {
          return;
        }

        // Block browser page zoom; zoom only the CV sheet.
        event.preventDefault();
        if (!isStudioViewActive()) {
          return;
        }

        const direction = event.deltaY > 0 ? -1 : 1;
        setUserZoom(userZoom + direction * ZOOM_STEP);
      },
      { passive: false, capture: true }
    );

    document.addEventListener("keydown", (event) => {
      if (!isStudioViewActive()) {
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }

      const key = event.key;
      if (key === "=" || key === "+") {
        event.preventDefault();
        setUserZoom(userZoom + ZOOM_STEP);
      } else if (key === "-" || key === "_") {
        event.preventDefault();
        setUserZoom(userZoom - ZOOM_STEP);
      } else if (key === "0") {
        event.preventDefault();
        fitPreviewToScreen();
      }
    });
  }

  function bindLayoutDrawerToggle() {
    const toggleBtn = document.getElementById("toggleLayoutDrawerBtn");
    const cockpit = document.getElementById("studioCockpit");
    const drawer = document.getElementById("cvLayoutDrawer");
    const drawerScrim = document.getElementById("drawerScrim");
    if (!toggleBtn || !cockpit) {
      return;
    }

    if (drawerScrim) {
      drawerScrim.hidden = true;
      drawerScrim.classList.remove("is-visible");
      drawerScrim.setAttribute("aria-hidden", "true");
    }

    function setDrawerOpen(isOpen) {
      cockpit.classList.toggle("is-drawer-collapsed", !isOpen);
      document.body.classList.toggle("layout-drawer-collapsed", !isOpen);
      toggleBtn.setAttribute("aria-expanded", String(isOpen));
      toggleBtn.classList.toggle("is-active", isOpen);
      scheduleFitPreview();
      window.setTimeout(scheduleFitPreview, 320);
    }

    function isDrawerOpen() {
      return !cockpit.classList.contains("is-drawer-collapsed");
    }

    toggleBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      setDrawerOpen(!isDrawerOpen());
    });

    document.addEventListener("pointerdown", (event) => {
      if (!isDrawerOpen()) {
        return;
      }

      const target = event.target;
      if (drawer?.contains(target) || toggleBtn.contains(target)) {
        return;
      }

      setDrawerOpen(false);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isDrawerOpen()) {
        setDrawerOpen(false);
      }
    });

    setDrawerOpen(false);
  }

  const LAYOUT = {
    ...(window.AchieveMateApp?.CV_TYPOGRAPHY || {
      minBodyPt: 10,
      maxBodyPt: 12,
      minHeaderPt: 10.5,
      maxHeaderPt: 12,
      minLineHeight: 1.1,
      maxLineHeight: 1.5,
      minSpacingPx: 0,
      maxSpacingPx: 24,
    }),
    pageHeightMm: 297,
  };

  const PAGE_MARGIN_MAP = {
    compact: "0.5in",
    cozy: "0.65in",
    normal: "0.75in",
    spacious: "1.0in",
  };

  function getLayoutStyles() {
    return state.cvSettings || {};
  }

  function fontFamilyStack(family) {
    const stacks = {
      "Times New Roman": '"Times New Roman", Times, serif',
      Arial: "Arial, Helvetica, sans-serif",
      Calibri: "Calibri, Candara, Segoe, sans-serif",
      Garamond: "Garamond, 'Times New Roman', serif",
    };

    return stacks[family] || stacks["Times New Roman"];
  }

  function manualTypographyFromBase(baseFontSize) {
    const bodyFontPt = Math.max(
      LAYOUT.minBodyPt,
      Math.min(LAYOUT.maxBodyPt, Number(baseFontSize) || LAYOUT.minBodyPt)
    );
    return {
      bodyFontPt,
      headerFontPt: Math.min(bodyFontPt + 0.5, LAYOUT.maxHeaderPt),
    };
  }

  function getNameFontSizePt(styles) {
    return Math.max(16, Math.min(26, styles.nameFontSize ?? 20));
  }

  function getHeadingFontSizePt(styles) {
    return Math.max(12, Math.min(16, styles.headingFontSize ?? 13));
  }

  function sanitizeRichText(html) {
    const template = document.createElement("div");
    template.innerHTML = String(html ?? "");

    const allowedTags = new Set(["B", "STRONG", "I", "EM", "U", "BR"]);

    function cleanNode(node) {
      [...node.childNodes].forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          return;
        }

        if (child.nodeType !== Node.ELEMENT_NODE) {
          child.remove();
          return;
        }

        if (child.tagName === "BR") {
          return;
        }

        if (!allowedTags.has(child.tagName)) {
          const fragment = document.createDocumentFragment();
          while (child.firstChild) {
            fragment.appendChild(child.firstChild);
          }
          child.replaceWith(fragment);
          cleanNode(node);
          return;
        }

        [...child.attributes].forEach((attr) => {
          child.removeAttribute(attr.name);
        });
        cleanNode(child);
      });
    }

    cleanNode(template);
    return template.innerHTML.trim();
  }

  function richTextToHtml(value) {
    const str = String(value ?? "").trim();
    if (!str) {
      return "";
    }

    if (!/<[a-z][\s\S]*>/i.test(str)) {
      return escapeHtml(str);
    }

    return sanitizeRichText(str);
  }

  function inlineRunsFromValue(value) {
    const source = String(value ?? "").replace(/\r\n/g, "\n");
    if (!source.trim()) {
      return [];
    }

    const template = document.createElement("div");
    if (/<[a-z][\s\S]*>/i.test(source)) {
      template.innerHTML = sanitizeRichText(source.replace(/\n/g, "<br>"));
    } else {
      template.innerHTML = escapeHtml(source).replace(/\n/g, "<br>");
    }

    const lines = [[]];
    const pushText = (text, style) => {
      if (!text) {
        return;
      }
      const parts = String(text).split("\n");
      parts.forEach((part, index) => {
        if (index > 0) {
          lines.push([]);
        }
        if (part) {
          lines[lines.length - 1].push({
            text: part,
            bold: style.bold,
            italic: style.italic,
            underline: style.underline,
          });
        }
      });
    };

    const walk = (node, style) => {
      node.childNodes.forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          pushText(child.textContent || "", style);
          return;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) {
          return;
        }
        if (child.tagName === "BR") {
          lines.push([]);
          return;
        }
        const next = { ...style };
        if (child.tagName === "B" || child.tagName === "STRONG") {
          next.bold = true;
        }
        if (child.tagName === "I" || child.tagName === "EM") {
          next.italic = true;
        }
        if (child.tagName === "U") {
          next.underline = true;
        }
        walk(child, next);
      });
    };

    walk(template, { bold: false, italic: false, underline: false });
    return lines;
  }

  function stripLeadingBullet(line) {
    if (!line?.length) {
      return [];
    }

    const next = line.map((run) => ({ ...run }));
    next[0] = {
      ...next[0],
      text: String(next[0].text || "").replace(/^[•\-*]\s*/, ""),
    };
    if (!next.some((run) => String(run.text || "").trim())) {
      return [];
    }
    return next;
  }

  function exportFieldLines(value, placeholder) {
    const raw = String(value ?? "");
    if (!comparableEditText(raw)) {
      return [];
    }
    if (placeholder && normalizePlaceholderCompare(raw) === normalizePlaceholderCompare(placeholder)) {
      return [];
    }
    return inlineRunsFromValue(raw).filter((line) => line.some((run) => String(run.text || "").trim()));
  }

  function exportBulletLines(value, placeholder) {
    const raw = String(value ?? "");
    if (placeholder && descriptionsMatchPlaceholder(raw, placeholder)) {
      return [];
    }
    return inlineRunsFromValue(raw)
      .map(stripLeadingBullet)
      .filter((line) => line.some((run) => String(run.text || "").trim()));
  }

  function editPlainText(value) {
    if (value == null || value === "") {
      return "";
    }

    const str = String(value);
    if (!/<[a-z][\s\S]*>/i.test(str)) {
      return str;
    }

    const template = document.createElement("div");
    template.innerHTML = sanitizeRichText(str);
    return template.textContent || "";
  }

  function getEditableContent(node) {
    return sanitizeRichText(node.innerHTML);
  }

  function splitDescriptionLineHtml(node) {
    const lines = [[]];

    const append = (html) => {
      lines[lines.length - 1].push(html);
    };

    node.childNodes.forEach((child) => {
      if (child.nodeName === "BR") {
        lines.push([]);
        return;
      }

      if (child.nodeType === Node.TEXT_NODE) {
        append(escapeHtml(child.textContent || ""));
        return;
      }

      append(sanitizeRichText(child.outerHTML));
    });

    return lines
      .map((parts) => parts.join("").trim())
      .filter(Boolean)
      .map((line) => line.replace(/^[•\-*]\s*/, ""))
      .filter((line) => line !== "Add description points");
  }

  function getDescriptionEditableContent(node) {
    return splitDescriptionLineHtml(node)
      .map((line) => `• ${line}`)
      .join("\n");
  }

  function getNodeEditContent(node) {
    if (node.classList.contains("cv-preview-description")) {
      return getDescriptionEditableContent(node);
    }

    return getEditableContent(node);
  }

  const HEADING_DIVIDER_CLASSES = [
    "cv-heading-divider-solid",
    "cv-heading-divider-dotted",
    "cv-heading-divider-none",
  ];

  function applyHeadingDividerStyles(styles) {
    const divider = styles.headingDivider ?? "solid";
    const normalizedDivider = ["solid", "dotted", "none"].includes(divider) ? divider : "solid";

    cvPreview.classList.remove(...HEADING_DIVIDER_CLASSES);
    cvPreview.classList.add(`cv-heading-divider-${normalizedDivider}`);
  }

  function applyLayoutStyles() {
    const styles = getLayoutStyles();
    const pagePadding = PAGE_MARGIN_MAP[styles.pageMargin] || PAGE_MARGIN_MAP.normal;

    applyHeadingDividerStyles(styles);

    cvPreview.style.setProperty("--cv-font-family", fontFamilyStack(styles.fontFamily));
    cvPreview.style.setProperty("--cv-text-color", styles.textColor || "#000000");
    cvPreview.style.setProperty("--cv-accent-color", styles.accentColor || "#000000");
    cvPreview.style.setProperty("--cv-page-padding", pagePadding);
    cvPreview.style.setProperty("--cv-item-gap", `${styles.itemGap ?? 4}px`);
    cvPreview.style.setProperty("--cv-name-font", `${getNameFontSizePt(styles)}pt`);
    cvPreview.style.setProperty("--cv-section-heading-font", `${getHeadingFontSizePt(styles)}pt`);

    if (styles.autoFit !== true) {
      cvPreview.classList.add("cv-preview-manual-layout");
    } else {
      cvPreview.classList.remove("cv-preview-manual-layout");
    }

    if (styles.autoFit !== true) {
      const typography = manualTypographyFromBase(styles.baseFontSize ?? 11);
      cvPreview.style.setProperty("--cv-body-font", `${typography.bodyFontPt}pt`);
      cvPreview.style.setProperty("--cv-header-font", `${typography.headerFontPt}pt`);
      cvPreview.style.setProperty("--cv-line-height", String(styles.lineHeight ?? 1.3));
      cvPreview.style.setProperty("--cv-section-gap", `${styles.sectionGap ?? 12}px`);
      cvPreview.style.setProperty("--cv-section-margin", `${styles.sectionGap ?? 12}px`);
      pdfFitOverride = null;
    }

    if (styles.autoFit === true && pdfFitOverride) {
      writeFittedTypography(pdfFitOverride);
    }
  }

  function lerp(min, max, ratio) {
    return min + (max - min) * ratio;
  }

  function collectContentMetrics() {
    let charCount = 0;
    let itemCount = state.cvLayout.length;
    let bulletCount = 0;

    const name = getEdit("personal.name", state.personalInfo.name || "");
    const phone = getEdit("personal.phone", state.personalInfo.phone || "");
    const email = getEdit("personal.email", state.personalInfo.email || "");
    const contact = getEdit("personal.contact", [phone, email].filter(Boolean).join("  |  "));

    charCount += String(
      editPlainText(name) + editPlainText(phone) + editPlainText(email) + editPlainText(contact)
    ).length;

    state.cvLayout.forEach((item) => {
      if (item.type === "heading") {
        charCount += editPlainText(getEdit(`items.${item.id}.title`, item.title || "")).length;
        return;
      }

      if (item.type === "cv-item") {
        if (!cvItemHasUserContent(item)) {
          return;
        }

        CV_ITEM_FIELD_KEYS.forEach((field) => {
          if (field === "description") {
            return;
          }
          const content = getCvItemFieldContent(item, field);
          if (isCvItemFieldFilled(content, field)) {
            charCount += editPlainText(content).length;
          }
        });

        const description = getCvItemFieldContent(item, "description");
        const lines = descriptionPlaceholderLines(description);
        bulletCount += lines.length;
        charCount += lines.join("").length;
        return;
      }

      const achievement = getAchievement(item.achievementId);
      const title = getEdit(`items.${item.id}.title`, achievement?.title || "");
      const date = getEdit(`items.${item.id}.date`, achievement?.date || "");
      charCount += editPlainText(title + date).length;

      if (isAchievementDescriptionVisible(achievement)) {
        const description = getEdit(`items.${item.id}.description`, achievement?.description || "");
        const lines = String(description)
          .split("\n")
          .map((line) => editPlainText(line.trim()))
          .filter(Boolean);
        bulletCount += lines.length;
        charCount += lines.join("").length;
      }
    });

    return { charCount, itemCount, bulletCount };
  }

  function layoutParamsFromRatio(ratio) {
    const bodyFontPt = lerp(LAYOUT.minBodyPt, LAYOUT.maxBodyPt, ratio);
    const headerFontPt = lerp(LAYOUT.minHeaderPt, LAYOUT.maxHeaderPt, ratio);
    const lineHeight = lerp(LAYOUT.minLineHeight, LAYOUT.maxLineHeight, ratio);
    const spacingPx = lerp(LAYOUT.minSpacingPx, LAYOUT.maxSpacingPx, ratio);

    return {
      bodyFontPt: Math.round(bodyFontPt * 10) / 10,
      headerFontPt: Math.round(headerFontPt * 10) / 10,
      lineHeight: Math.round(lineHeight * 100) / 100,
      sectionGapPx: Math.round(spacingPx),
      sectionMarginPx: Math.round(spacingPx),
      singlePage: true,
      density: ratio >= 0.65 ? "spacious" : ratio <= 0.35 ? "compact" : "balanced",
    };
  }

  function setPreviewPageMode({ singlePage }) {
    if (!cvPreview) {
      return;
    }

    if (singlePage) {
      cvPreview.classList.add("cv-preview-single-page");
      cvPreview.classList.remove("cv-preview-multipage");
      return;
    }

    cvPreview.classList.remove("cv-preview-single-page");
    cvPreview.classList.add("cv-preview-multipage");
  }

  function applyLayoutParams(params) {
    applyLayoutStyles();

    if (getLayoutStyles().autoFit === true) {
      cvPreview.style.setProperty("--cv-body-font", `${params.bodyFontPt}pt`);
      cvPreview.style.setProperty("--cv-header-font", `${params.headerFontPt}pt`);
      cvPreview.style.setProperty("--cv-line-height", String(params.lineHeight));
      cvPreview.style.setProperty("--cv-section-gap", `${params.sectionGapPx}px`);
      cvPreview.style.setProperty("--cv-section-margin", `${params.sectionMarginPx}px`);
    }

    cvPreview.dataset.layoutDensity = params.density;
    setPreviewPageMode({ singlePage: params.singlePage !== false });

    if (getLayoutStyles().autoFit === true && pdfFitOverride) {
      writeFittedTypography(pdfFitOverride);
    }
  }

  function ptToCssPx(pt) {
    return Math.round((Number(pt) / 0.75) * 1000) / 1000;
  }

  function writeFittedTypography(fit) {
    if (!fit || !cvPreview) {
      return;
    }

    const minBodyPt = LAYOUT.minBodyPt;
    const bodyPt = Math.max(minBodyPt, Number(fit.bodyPt) || minBodyPt);
    const titlePt = Math.max(LAYOUT.minHeaderPt, Number(fit.titlePt) || bodyPt + 0.5);

    cvPreview.style.setProperty("--cv-body-font", `${bodyPt}pt`);
    cvPreview.style.setProperty("--cv-header-font", `${titlePt}pt`);
    cvPreview.style.setProperty("--cv-name-font", `${fit.namePt}pt`);
    cvPreview.style.setProperty("--cv-section-heading-font", `${fit.headingPt}pt`);
    if (Number.isFinite(Number(fit.lineHeight))) {
      cvPreview.style.setProperty("--cv-line-height", String(fit.lineHeight));
    }
    cvPreview.style.setProperty("--cv-section-gap", `${ptToCssPx(fit.sectionGapPt)}px`);
    cvPreview.style.setProperty("--cv-section-margin", `${ptToCssPx(fit.sectionMarginPt)}px`);
    cvPreview.style.setProperty("--cv-item-gap", `${ptToCssPx(fit.itemGapPt)}px`);
    if (Number.isFinite(Number(fit.marginPt))) {
      cvPreview.style.setProperty("--cv-page-padding", `${fit.marginPt}pt`);
    }

    // Same overflow rule as PDF: clip only while content fits one page;
    // at the 10pt floor, grow the sheet (multi-page) with page seams.
    setPreviewPageMode({ singlePage: !fit.fitOverflow });
  }

  function rememberPdfFit(fit) {
    pdfFitOverride = fit?.fitChanged || fit?.fitOverflow ? fit : null;
    if (pdfFitOverride) {
      writeFittedTypography(pdfFitOverride);
    }
  }

  function measurePageOverflow() {
    if (!cvPreview.classList.contains("cv-preview-single-page")) {
      return false;
    }

    return cvPreview.scrollHeight > cvPreview.clientHeight + 2;
  }

  function getLiveTypography() {
    if (!cvPreview) {
      return null;
    }

    const lineHeightRaw = parseFloat(cvPreview.style.getPropertyValue("--cv-line-height"));
    const sectionGapRaw = parseFloat(cvPreview.style.getPropertyValue("--cv-section-gap"));

    return {
      bodyFontPt: Math.round(readCssPt("--cv-body-font", LAYOUT.minBodyPt) * 10) / 10,
      lineHeight: Number.isFinite(lineHeightRaw)
        ? Math.round(lineHeightRaw * 100) / 100
        : LAYOUT.minLineHeight,
      sectionGapPx: Number.isFinite(sectionGapRaw) ? Math.round(sectionGapRaw) : LAYOUT.minSpacingPx,
      singlePage: cvPreview.classList.contains("cv-preview-single-page"),
    };
  }

  function syncDesignFittedOutputs() {
    window.AchieveMateCvLayoutPanel?.syncFittedOutputs?.(getLiveTypography());
  }

  function applySmartLayout(options = {}) {
    pdfFitOverride = null;
    applyLayoutStyles();

    const finishLayout = () => {
      syncDesignFittedOutputs();
      if (options.syncFit) {
        applyPreviewZoom();
      } else {
        scheduleFitPreview();
      }
    };

    if (state.cvLayout.length === 0) {
      cvPreview.classList.remove("cv-preview-single-page", "cv-preview-multipage");
      cvPreview.dataset.layoutDensity = "";
      cvPreview.dataset.contentChars = "";
      cvPreview.dataset.contentItems = "";
      finishLayout();
      return;
    }

    if (getLayoutStyles().autoFit !== true) {
      setPreviewPageMode({ singlePage: true });
      cvPreview.dataset.layoutDensity = "manual";
      finishLayout();
      return;
    }

    const metrics = collectContentMetrics();
    cvPreview.dataset.contentChars = String(metrics.charCount);
    cvPreview.dataset.contentItems = String(metrics.itemCount);
    cvPreview.dataset.contentBullets = String(metrics.bulletCount);

    let low = 0;
    let high = 1;

    for (let step = 0; step < 14; step += 1) {
      const mid = (low + high) / 2;
      applyLayoutParams(layoutParamsFromRatio(mid));

      if (measurePageOverflow()) {
        high = mid;
      } else {
        low = mid;
      }
    }

    const cssParams = layoutParamsFromRatio(low);
    applyLayoutParams(cssParams);

    let overflow = measurePageOverflow();
    if (overflow) {
      // Hard floor reached — keep min typography, allow multi-page (no clip).
      applyLayoutParams({
        ...layoutParamsFromRatio(0),
        singlePage: false,
        density: "compact",
      });
    }

    if (window.AchieveMatePdf?.shrinkPdfModelToOnePage) {
      const fitted = window.AchieveMatePdf.shrinkPdfModelToOnePage(buildPdfModel(), {
        alsoFits(candidate) {
          writeFittedTypography({ ...candidate, fitOverflow: false });
          return !measurePageOverflow();
        },
      });
      rememberPdfFit(fitted);
      if (!fitted.fitChanged && !fitted.fitOverflow) {
        applyLayoutParams({
          ...(overflow
            ? { ...layoutParamsFromRatio(0), density: "compact" }
            : cssParams),
          singlePage: !overflow,
        });
      } else if (fitted.fitOverflow) {
        setPreviewPageMode({ singlePage: false });
      }
    }

    finishLayout();
  }

  let layoutSkeletonTimer = null;

  function showLayoutSkeleton() {
    window.clearTimeout(layoutSkeletonTimer);
    layoutSkeletonTimer = window.setTimeout(() => {
      cvPreview?.classList.add("is-layout-running");
    }, 150);
  }

  function hideLayoutSkeleton() {
    window.clearTimeout(layoutSkeletonTimer);
    cvPreview?.classList.remove("is-layout-running");
  }

  function scheduleSmartLayout(options = {}) {
    if (layoutFrame) {
      cancelAnimationFrame(layoutFrame);
    }

    if (!options.quiet) {
      showLayoutSkeleton();
    }

    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = null;
      applySmartLayout({ syncFit: true });
      hideLayoutSkeleton();
      options.onComplete?.();
    });
  }

  function getAchievement(achievementId) {
    return state.achievements.find((item) => item.id === achievementId);
  }

  function isAchievementDescriptionVisible(achievement) {
    return app.isAchievementDescriptionVisible(achievement);
  }

  function getLibraryDropTarget() {
    return document.getElementById("studioRail");
  }

  function isPointerOverLibrary(clientX, clientY) {
    const target = getLibraryDropTarget();
    if (!target || (clientX === 0 && clientY === 0)) {
      return false;
    }
    const rect = target.getBoundingClientRect();
    const pageRect = cvPreview?.getBoundingClientRect();
    const rightEdge = pageRect ? Math.max(rect.right, Math.min(pageRect.left, rect.right + 96)) : rect.right + 32;
    return (
      clientX >= rect.left - 12 &&
      clientX <= rightEdge &&
      clientY >= rect.top - 12 &&
      clientY <= rect.bottom + 12
    );
  }

  function setLibraryDropActive(active) {
    document.getElementById("cvLibrarySection")?.classList.toggle("is-drop-active", Boolean(active));
    getLibraryDropTarget()?.classList.toggle("is-library-drop-active", Boolean(active));
  }

  function commitActivePreviewEdit() {
    const active = document.activeElement;
    if (active && cvPreview?.contains(active) && active.matches("[data-edit-key]")) {
      finishFieldEdit(active);
    }
  }

  function meaningfulFieldText(value, placeholder, field) {
    const text = String(value ?? "");
    if (!text.trim()) {
      return "";
    }
    if (field === "description" && placeholder && descriptionsMatchPlaceholder(text, placeholder)) {
      return "";
    }
    if (placeholder && normalizePlaceholderCompare(text) === normalizePlaceholderCompare(placeholder)) {
      return "";
    }
    return text;
  }

  function snapshotLayoutItem(item) {
    if (!item) {
      return null;
    }

    if (item.type === "cv-item") {
      const snapshot = {};
      let hasContent = false;
      CV_ITEM_FIELD_KEYS.forEach((field) => {
        const content = getCvItemFieldContent(item, field);
        if (isCvItemFieldFilled(content, field)) {
          snapshot[field] = content;
          hasContent = true;
        } else {
          snapshot[field] = "";
        }
      });
      return hasContent ? snapshot : null;
    }

    if (item.type === "achievement") {
      const achievement = getAchievement(item.achievementId);
      const title = meaningfulFieldText(
        preferStoredField(`items.${item.id}.title`, achievement?.title || ""),
        "Untitled achievement",
        "title"
      );
      const date = meaningfulFieldText(
        preferStoredField(`items.${item.id}.date`, achievement?.date || ""),
        "Date",
        "date"
      );
      const descriptionSource = isAchievementDescriptionVisible(achievement)
        ? preferStoredField(`items.${item.id}.description`, achievement?.description || "")
        : "";
      const description = meaningfulFieldText(descriptionSource, "", "description");
      if (!title && !date && !description.trim()) {
        return null;
      }
      return {
        title,
        subtitle: "",
        date,
        location: "",
        description,
      };
    }

    return null;
  }

  function preferStoredField(editKey, source) {
    const raw = getRawEdit(editKey);
    if (raw != null && String(raw).trim() !== "") {
      return String(raw);
    }
    return source || "";
  }

  function getLayoutItemLibrarySnapshot(layoutItemId, { commit = false } = {}) {
    if (commit) {
      commitActivePreviewEdit();
    }

    const item = state.cvLayout.find((entry) => entry.id === layoutItemId);
    if (!item || (item.type !== "cv-item" && item.type !== "achievement")) {
      return { snapshot: null, reason: "unsupported" };
    }

    const snapshot = snapshotLayoutItem(item);
    if (!snapshot) {
      return { snapshot: null, reason: "empty" };
    }

    return { snapshot, reason: null };
  }

  function isLayoutItemInLibrary(layoutItemId) {
    const item = state.cvLayout.find((entry) => entry.id === layoutItemId);
    if (!item?.libraryEntryId) {
      return false;
    }
    return (state.cvLibrary || []).some((entry) => entry.id === item.libraryEntryId);
  }

  function libraryStarButtonMarkup(inLibrary) {
    const label = inLibrary ? "Update library item" : "Save to library";
    return `<button type="button" class="btn-icon cv-section-save${
      inLibrary ? " is-in-library" : ""
    }" aria-label="${label}" title="${label}" aria-pressed="${String(inLibrary)}">
      <span class="cv-section-save-icon cv-section-save-icon-hollow" aria-hidden="true">${getStarIconSvg(false)}</span>
      <span class="cv-section-save-icon cv-section-save-icon-filled" aria-hidden="true">${getStarIconSvg(true)}</span>
    </button>`;
  }

  function setLibraryStarButtonState(button, inLibrary) {
    if (!button) {
      return;
    }

    button.classList.toggle("is-in-library", inLibrary);
    button.setAttribute("aria-pressed", String(inLibrary));
    const label = inLibrary ? "Update library item" : "Save to library";
    button.setAttribute("aria-label", label);
    button.title = label;
  }

  function syncLibraryStars() {
    if (!cvPreview) {
      return;
    }

    cvPreview.querySelectorAll(".cv-section-wrap[data-layout-item-id]").forEach((wrap) => {
      const button = wrap.querySelector(".cv-section-save");
      if (!button) {
        return;
      }
      setLibraryStarButtonState(button, isLayoutItemInLibrary(wrap.dataset.layoutItemId));
    });
  }

  function saveLayoutItemToLibrary(layoutItemId) {
    const { snapshot, reason } = getLayoutItemLibrarySnapshot(layoutItemId, { commit: true });
    if (reason === "unsupported") {
      window.AchieveMateToast?.show("Only CV items can be saved to the library.", { tone: "neutral" });
      return { saved: false, reason: "unsupported" };
    }
    if (reason === "empty" || !snapshot) {
      window.AchieveMateToast?.show("Add some text before saving this item.", { tone: "neutral" });
      return { saved: false, reason: "empty" };
    }

    // Linked items update that Library card in place; unlinked items save as new.
    // Never remove/delete on restar.
    return window.AchieveMateCvBuilder?.saveLibrarySnapshot(snapshot, {
      sourceLayoutItemId: layoutItemId,
      layoutItemId,
    });
  }

  function toggleLayoutItemInLibrary(layoutItemId) {
    const item = state.cvLayout.find((entry) => entry.id === layoutItemId);
    if (!item || (item.type !== "cv-item" && item.type !== "achievement")) {
      window.AchieveMateToast?.show("Only CV items can be saved to the library.", { tone: "neutral" });
      return { saved: false, reason: "unsupported" };
    }

    return saveLayoutItemToLibrary(layoutItemId);
  }

  function acceptDocumentDropOnLibrary(layoutItemId) {
    if (documentDragState) {
      documentDragState.handled = true;
    }
    setLibraryDropActive(false);
    if (layoutItemId) {
      saveLayoutItemToLibrary(layoutItemId);
      syncLibraryStars();
    }
  }

  function parseDragPayload(event) {
    const raw = event.dataTransfer.getData("application/json");
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {
        /* fall through */
      }
    }
    return window.AchieveMateDrag?.payload || null;
  }

  function getPreviewBody() {
    return cvPreview?.querySelector(".cv-preview-body");
  }

  function resolveDropIndex(container, clientY) {
    if (!container) {
      return 0;
    }

    const items = [...container.querySelectorAll(":scope > .cv-section-wrap")];
    if (items.length === 0) {
      return 0;
    }

    for (let index = 0; index < items.length; index += 1) {
      const rect = items[index].getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      if (clientY < midpoint) {
        return index;
      }
    }

    return items.length;
  }

  function isPointerOverDocument(clientX, clientY) {
    if (!cvPreview) {
      return false;
    }
    const rect = cvPreview.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  function getInsertionLine() {
    return cvPreview?.querySelector(".cv-insertion-line");
  }

  function hideInsertionLine() {
    const line = getInsertionLine();
    if (!line) {
      return;
    }
    line.classList.remove("is-visible");
    line.setAttribute("aria-hidden", "true");
  }

  function showInsertionLine(index) {
    const body = getPreviewBody();
    const insertionLine = getInsertionLine();
    if (!insertionLine || !body) {
      return;
    }

    const children = [...body.querySelectorAll(":scope > .cv-section-wrap")];
    let lineTop;

    if (children.length === 0 || index === 0) {
      lineTop = 0;
    } else if (index >= children.length) {
      const last = children[children.length - 1];
      lineTop = last.offsetTop + last.offsetHeight;
    } else {
      lineTop = children[index].offsetTop;
    }

    insertionLine.style.top = `${lineTop}px`;
    insertionLine.classList.add("is-visible");
    insertionLine.removeAttribute("aria-hidden");
  }

  function flashSection(layoutItemId) {
    const section = cvPreview?.querySelector(`.cv-section-wrap[data-layout-item-id="${layoutItemId}"]`);
    if (!section) {
      return;
    }

    section.classList.add("is-entering", "is-dropped");
    window.setTimeout(() => section.classList.remove("is-entering"), 220);
    window.setTimeout(() => section.classList.remove("is-dropped"), 600);
  }

  function focusSectionHandle(layoutItemId) {
    if (!layoutItemId || !cvPreview) {
      return;
    }

    const section = cvPreview.querySelector(`.cv-section-wrap[data-layout-item-id="${layoutItemId}"]`);
    const handle = section?.querySelector(".cv-section-handle");
    if (!handle) {
      return;
    }

    handle.focus({ preventScroll: true });
  }

  function focusFirstFieldOfItem(layoutItemId) {
    if (!layoutItemId || !cvPreview) {
      return;
    }

    const wrap = cvPreview.querySelector(`.cv-section-wrap[data-layout-item-id="${layoutItemId}"]`);
    if (!wrap) {
      return;
    }

    wrap.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    const firstField = wrap.querySelector("[data-edit-key]");
    if (firstField) {
      activateEdit(firstField);
      return;
    }

    focusSectionHandle(layoutItemId);
  }

  function removeSectionFromCv(layoutItemId) {
    const builder = window.AchieveMateCvBuilder;
    if (!builder) {
      return;
    }

    const result = builder.removeLayoutItem(layoutItemId);
    if (!result) {
      return;
    }

    window.AchieveMateToast?.show("Removed from CV", {
      actionLabel: "Undo",
      onAction: () => {
        if (window.AchieveMateCvHistory?.canUndo?.()) {
          window.AchieveMateCvHistory.undo();
          return;
        }
        const next = [...state.cvLayout];
        next.splice(result.index, 0, result.removed);
        state.cvLayout = next;
        saveState();
        builder.render();
        renderPreview({ flashItemId: result.removed.id });
        recordCvHistory("Restore item");
      },
    });
  }

  function removeDraggedSectionIfDroppedOutside(event) {
    const pending = documentDragState;
    if (!pending || pending.handled || documentDragCancelled) {
      return false;
    }

    if (event.clientX === 0 && event.clientY === 0) {
      return false;
    }

    if (isPointerOverLibrary(event.clientX, event.clientY)) {
      pending.handled = true;
      saveLayoutItemToLibrary(pending.layoutItemId);
      syncLibraryStars();
      window.AchieveMateDragPreview?.end();
      return false;
    }

    if (isPointerOverDocument(event.clientX, event.clientY)) {
      return false;
    }

    pending.handled = true;
    removeSectionFromCv(pending.layoutItemId);
    window.AchieveMateDragPreview?.end();
    documentDragState = null;
    window.AchieveMateDrag.payload = null;
    return true;
  }

  function bindDocumentDragDrop() {
    if (!cvPreview) {
      return;
    }

    const studioWell = document.querySelector(".studio-well");

    cvPreview.addEventListener("dragover", (event) => {
      const payload = parseDragPayload(event);
      if (!payload) {
        return;
      }

      if (!isPointerOverDocument(event.clientX, event.clientY)) {
        event.dataTransfer.dropEffect = "none";
        hideInsertionLine();
        return;
      }

      event.preventDefault();
      const dropPayload = window.AchieveMateDrag?.payload;
      event.dataTransfer.dropEffect = dropPayload?.type === "library" ? "copy" : "move";
      const index = resolveDropIndex(getPreviewBody(), event.clientY);
      showInsertionLine(index);
    });

    cvPreview.addEventListener("dragleave", (event) => {
      if (!cvPreview.contains(event.relatedTarget)) {
        hideInsertionLine();
      }
    });

    cvPreview.addEventListener("drop", (event) => {
      event.preventDefault();
      hideInsertionLine();

      const payload = parseDragPayload(event);
      if (!payload || !isPointerOverDocument(event.clientX, event.clientY)) {
        documentDragState = null;
        window.AchieveMateDrag.payload = null;
        window.AchieveMateDragPreview?.end();
        return;
      }

      const builder = window.AchieveMateCvBuilder;
      if (!builder) {
        return;
      }

      const index = resolveDropIndex(getPreviewBody(), event.clientY);

      if (payload.source === "rail") {
        if (payload.type === "library") {
          builder.insertLibraryEntry(payload.libraryId, index);
          window.AchieveMateDragPreview?.end();
          return;
        }
        if (payload.type === "add" && payload.addKind) {
          builder.addBlockKind?.(payload.addKind, index);
          window.AchieveMateDragPreview?.end();
          return;
        }
        if (payload.type === "achievement" && !builder.getAchievement(payload.achievementId)) {
          return;
        }
        const item = builder.createLayoutItem(payload.type, payload.achievementId);
        builder.insertLayoutItem(item, index);
        window.AchieveMateDragPreview?.end();
        return;
      }

      if (payload.source === "document" && payload.layoutIndex != null) {
        if (documentDragState) {
          documentDragState.handled = true;
        }
        builder.moveLayoutItem(payload.layoutIndex, index);
        window.AchieveMateDragPreview?.end();
      }
    });

    studioWell?.addEventListener("dragover", (event) => {
      const payload = parseDragPayload(event);
      if (payload?.source !== "document") {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      hideInsertionLine();
    });

    studioWell?.addEventListener("drop", (event) => {
      if (removeDraggedSectionIfDroppedOutside(event)) {
        event.preventDefault();
      }
    });

    const studioRail = getLibraryDropTarget();
    studioRail?.addEventListener("dragover", (event) => {
      const payload = window.AchieveMateDrag?.payload;
      if (payload?.source !== "document") {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setLibraryDropActive(true);
    });

    studioRail?.addEventListener("dragleave", (event) => {
      if (!studioRail.contains(event.relatedTarget)) {
        setLibraryDropActive(false);
      }
    });

    studioRail?.addEventListener("drop", (event) => {
      const payload = parseDragPayload(event);
      if (payload?.source !== "document") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      acceptDocumentDropOnLibrary(payload.layoutItemId);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        setLibraryDropActive(false);
        if (sectionDragSession) {
          documentDragCancelled = true;
          hideInsertionLine();
          return;
        }
        if (documentDragState) {
          documentDragCancelled = true;
        }
        hideInsertionLine();
      }
    });
  }

  function bindSectionHandles() {
    cvPreview.querySelectorAll(".cv-section-wrap").forEach((wrap) => {
      const layoutItemId = wrap.dataset.layoutItemId;
      const handle = wrap.querySelector(".cv-section-handle");
      const removeBtn = wrap.querySelector(".cv-section-remove");

      wrap.draggable = false;

      handle?.addEventListener("dragstart", (event) => {
        event.stopPropagation();
        beginDocumentDrag(wrap, layoutItemId, event, handle);
      });

      handle?.addEventListener("dragend", (event) => {
        if (documentDragState?.layoutItemId !== layoutItemId) {
          return;
        }
        finishDocumentDrag(event);
      });

      handle?.addEventListener("keydown", (event) => {
        if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) {
          return;
        }

        event.preventDefault();
        const currentIndex = state.cvLayout.findIndex((item) => item.id === layoutItemId);
        if (currentIndex === -1) {
          return;
        }

        const nextIndex = event.key === "ArrowUp" ? currentIndex - 1 : currentIndex + 1;
        if (nextIndex < 0 || nextIndex >= state.cvLayout.length) {
          return;
        }

        window.AchieveMateCvBuilder?.moveLayoutItem(currentIndex, nextIndex);
      });

      removeBtn?.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      removeBtn?.addEventListener("click", (event) => {
        event.stopPropagation();
        removeSectionFromCv(layoutItemId);
      });

      const saveBtn = wrap.querySelector(".cv-section-save");
      saveBtn?.addEventListener("mousedown", (event) => {
        // Keep click from focusing the star so :focus-within doesn't pin chrome open.
        event.preventDefault();
        event.stopPropagation();
      });
      saveBtn?.addEventListener("click", (event) => {
        event.stopPropagation();
        event.preventDefault();
        toggleLayoutItemInLibrary(layoutItemId);
        setLibraryStarButtonState(saveBtn, isLayoutItemInLibrary(layoutItemId));
        saveBtn.blur();
      });
    });
  }

  function getEdit(path, fallback) {
    const parts = path.split(".");
    let current = state.cvPreviewEdits;

    for (const part of parts) {
      if (!current || typeof current !== "object") {
        return fallback;
      }
      current = current[part];
    }

    if (current == null || current === "") {
      return fallback;
    }

    return current;
  }

  function layoutItemFromEditKey(editKey) {
    if (!editKey?.startsWith("items.")) {
      return null;
    }

    const suffix = editKey.slice("items.".length);
    const dot = suffix.lastIndexOf(".");
    if (dot === -1) {
      return null;
    }

    const itemId = suffix.slice(0, dot);
    return state.cvLayout.find((entry) => entry.id === itemId) || null;
  }

  function placeholderForEditKey(editKey) {
    if (editKey === "personal.name") {
      return "Your Name";
    }
    if (editKey === "personal.contact") {
      return "Phone | Email";
    }

    const cvItem = parseCvItemEditKey(editKey);
    if (cvItem) {
      return CV_ITEM_PLACEHOLDERS[cvItem.field] || "";
    }

    const item = layoutItemFromEditKey(editKey);
    const field = editKey.slice(editKey.lastIndexOf(".") + 1);
    if (field === "title") {
      if (!item || item.type === "heading") {
        return "Section Title";
      }
      if (item.type === "achievement") {
        return "Untitled achievement";
      }
    }
    if (field === "date" && (!item || item.type === "achievement")) {
      return "Date";
    }
    return "";
  }

  function editFallbackValue(editKey) {
    if (editKey === "personal.name") {
      return state.personalInfo.name || "";
    }
    if (editKey === "personal.contact") {
      return [state.personalInfo.phone, state.personalInfo.email].filter(Boolean).join("  |  ");
    }

    if (parseCvItemEditKey(editKey)) {
      return "";
    }

    const item = layoutItemFromEditKey(editKey);
    if (!item) {
      return "";
    }

    const field = editKey.slice(editKey.lastIndexOf(".") + 1);
    if (item.type === "heading") {
      return field === "title" ? item.title || "" : "";
    }

    if (item.type === "achievement") {
      const achievement = getAchievement(item.achievementId);
      if (field === "title") {
        return achievement?.title?.trim() || "";
      }
      if (field === "date") {
        return achievement?.date?.trim() || "";
      }
      if (field === "description") {
        return achievement?.description || "";
      }
    }

    return "";
  }

  function hasInlineFormatting(value) {
    return /<(b|strong|i|em|u)\b/i.test(String(value ?? ""));
  }

  function comparableEditText(value) {
    return descriptionPlaceholderLines(editPlainText(value))
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
  }

  function normalizedEditValue(editKey, rawValue) {
    let value = String(rawValue ?? "");
    const placeholder = placeholderForEditKey(editKey);
    if (placeholder) {
      if (editKey.endsWith(".description")) {
        if (descriptionsMatchPlaceholder(value, placeholder)) {
          value = "";
        }
      } else if (normalizePlaceholderCompare(value) === normalizePlaceholderCompare(placeholder)) {
        value = "";
      }
    }

    if (!hasInlineFormatting(value) && comparableEditText(value) === "") {
      return null;
    }

    if (
      !hasInlineFormatting(value) &&
      comparableEditText(value) === comparableEditText(editFallbackValue(editKey))
    ) {
      return null;
    }

    return value;
  }

  function getRawEdit(path) {
    const parts = path.split(".");
    let current = state.cvPreviewEdits;

    for (const part of parts) {
      if (!current || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, part)) {
        return undefined;
      }
      current = current[part];
    }

    return current;
  }

  function deleteEdit(path) {
    const parts = path.split(".");
    let current = state.cvPreviewEdits;

    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index];
      if (!current?.[part] || typeof current[part] !== "object") {
        return;
      }
      current = current[part];
    }

    if (current && Object.prototype.hasOwnProperty.call(current, parts[parts.length - 1])) {
      delete current[parts[parts.length - 1]];
    }
  }

  function commitEditKey(editKey, rawValue, options = {}) {
    const next = normalizedEditValue(editKey, rawValue);
    const current = getRawEdit(editKey);
    let changed = false;

    if (next == null) {
      if (current !== undefined) {
        deleteEdit(editKey);
        changed = true;
      }
    } else if (current !== next) {
      setEdit(editKey, next, { skipSave: true });
      changed = true;
    }

    if (editKey === "personal.name") {
      const displayName =
        next == null ? "" : editPlainText(next).replace(/\s+/g, " ").trim();
      if ((state.personalInfo.name || "") !== displayName) {
        state.personalInfo.name = displayName;
        window.AchieveMateApp?.refreshPersonalForm?.();
        window.AchieveMateApp?.updateSidebarIdentitySummary?.();
        changed = true;
      }
    }

    if (changed && !options.skipSave) {
      if (options.flushSave) {
        flushEditSave();
      } else {
        scheduleEditSave();
      }
    }

    return changed;
  }

  function healPreviewEdits() {
    let changed = false;
    const personal = state.cvPreviewEdits?.personal;
    if (personal && typeof personal === "object") {
      Object.keys(personal).forEach((field) => {
        if (commitEditKey(`personal.${field}`, personal[field], { skipSave: true })) {
          changed = true;
        }
      });
    }

    const items = state.cvPreviewEdits?.items;
    if (items && typeof items === "object") {
      Object.keys(items).forEach((id) => {
        const bucket = items[id];
        if (!bucket || typeof bucket !== "object") {
          return;
        }
        Object.keys(bucket).forEach((field) => {
          if (commitEditKey(`items.${id}.${field}`, bucket[field], { skipSave: true })) {
            changed = true;
          }
        });
      });
    }

    if (changed) {
      flushEditSave();
    }

    return changed;
  }

  function setEdit(path, value, options = {}) {
    const parts = path.split(".");
    let current = state.cvPreviewEdits;

    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index];
      if (!current[part] || typeof current[part] !== "object") {
        current[part] = {};
      }
      current = current[part];
    }

    current[parts[parts.length - 1]] = value;

    if (options.skipSave) {
      return;
    }

    if (options.flushSave) {
      flushEditSave();
      return;
    }

    scheduleEditSave();
  }

  function captureEditsFromDom() {
    if (document.activeElement && cvPreview.contains(document.activeElement)) {
      document.activeElement.blur();
    }

    let changed = false;
    cvPreview.querySelectorAll("[data-edit-key]").forEach((node) => {
      const value = normalizeSavedEditValue(node, getNodeEditContent(node));
      if (commitEditKey(node.dataset.editKey, value, { skipSave: true })) {
        changed = true;
      }
    });

    if (changed) {
      flushEditSave();
    }
  }

  function descriptionToEditableHtml(description) {
    const lines = String(description || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^[•\-*]\s*/, ""))
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => line !== "Add description points");

    if (lines.length === 0) {
      return "";
    }

    return lines.map((line) => richTextToHtml(`${CV_BULLET_PREFIX}${line}`)).join("<br>");
  }

  function normalizeDescriptionBulletSpacing(node) {
    node.childNodes.forEach((child) => {
      if (child.nodeType !== Node.TEXT_NODE) {
        return;
      }

      const fixed = child.textContent.replace(/•([^\s\n])/g, "• $1");
      if (fixed !== child.textContent) {
        child.textContent = fixed;
      }
    });
  }

  function getCaretLineContext(node, range) {
    const preRange = document.createRange();
    preRange.selectNodeContents(node);
    preRange.setEnd(range.startContainer, range.startOffset);
    const before = preRange.toString();
    const lineStart = before.lastIndexOf("\n") + 1;

    return {
      before,
      beforeOnLine: before.slice(lineStart),
    };
  }

  function shouldCapitalizeEditableInput(node, range, key) {
    if (key.length !== 1 || !/[a-z]/.test(key)) {
      return false;
    }

    if (!range.collapsed) {
      return true;
    }

    if (node.classList.contains("cv-preview-description")) {
      if (!range.collapsed) {
        return true;
      }
      return false;
    }

    return getCaretLineContext(node, range).before.length === 0;
  }

  function insertDescriptionBulletLine(node) {
    const selection = window.getSelection();
    if (!selection?.rangeCount) {
      return;
    }

    const range = selection.getRangeAt(0);
    range.deleteContents();

    const br = document.createElement("br");
    const bulletChar = document.createTextNode("•");
    const spacer = document.createTextNode(" ");
    const caretSeed = document.createTextNode("\u00A0");
    const fragment = document.createDocumentFragment();
    fragment.append(br, bulletChar, spacer, caretSeed);

    range.insertNode(fragment);

    const selectRange = document.createRange();
    selectRange.selectNodeContents(caretSeed);
    selection.removeAllRanges();
    selection.addRange(selectRange);
  }

  function bindPlaceholderAutoCapitalize(node, onEdit) {
    node.addEventListener("keydown", (event) => {
      if (!node.classList.contains("is-editing")) {
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (event.key.length !== 1 || !/[a-z]/.test(event.key)) {
        return;
      }

      const selection = window.getSelection();
      if (!selection?.rangeCount) {
        return;
      }

      const range = selection.getRangeAt(0);
      if (!shouldCapitalizeEditableInput(node, range, event.key)) {
        return;
      }

      event.preventDefault();
      document.execCommand("insertText", false, event.key.toUpperCase());
      onEdit?.();
    });
  }

  function escapeDataPlaceholder(value) {
    return String(value || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  }

  function bindDescriptionEnterHandler(node, onEdit) {
    node.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey) {
        return;
      }

      event.preventDefault();
      insertDescriptionBulletLine(node);
      onEdit?.();
    });
  }

  function bindRichTextShortcuts(node, onEdit) {
    node.addEventListener("keydown", (event) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) {
        return;
      }

      if (event.key === "b" || event.key === "B") {
        event.preventDefault();
        document.execCommand("bold");
        onEdit?.();
      } else if (event.key === "i" || event.key === "I") {
        event.preventDefault();
        document.execCommand("italic");
        onEdit?.();
      }
    });
  }

  function bindCvPasteHandler(node, onEdit) {
    node.addEventListener("paste", (event) => {
      event.preventDefault();

      const clipboard = event.clipboardData;
      if (!clipboard) {
        return;
      }

      const html = clipboard.getData("text/html");
      const plain = clipboard.getData("text/plain");

      let insertHtml;
      if (html?.trim()) {
        insertHtml = sanitizeRichText(html);
      } else if (plain) {
        insertHtml = escapeHtml(plain).replace(/\r\n/g, "\n").replace(/\n/g, "<br>");
      } else {
        return;
      }

      document.execCommand("insertHTML", false, insertHtml);
      onEdit?.();
    });
  }

  function bindEditableNodes() {
    cvPreview.querySelectorAll("[data-edit-key]").forEach((node) => {
      const persistEdit = (options = {}) => {
        const raw = getNodeEditContent(node);
        const value = normalizeSavedEditValue(node, raw);
        if (commitEditKey(node.dataset.editKey, value, options)) {
          markEditSessionDirty(node);
        }
      };

      node.addEventListener("focus", () => {
        isEditingPreview = true;
        beginEditSession(node);
        node.classList.add("is-editing");
        node.classList.remove("cv-preview-placeholder");
      });

      node.addEventListener("blur", () => {
        if (cvItemEnterNavSource === node) {
          cvItemEnterNavSource = null;
          window.requestAnimationFrame(() => {
            updateEditingPreviewFlag();
          });
          return;
        }

        finishFieldEdit(node);
        window.requestAnimationFrame(() => {
          updateEditingPreviewFlag();
        });
      });

      node.addEventListener("input", () => persistEdit());
      bindRichTextShortcuts(node, () => persistEdit());
      bindCvPasteHandler(node, () => persistEdit());
      bindPlaceholderAutoCapitalize(node, () => persistEdit());

      if (node.classList.contains("cv-preview-description")) {
        bindDescriptionEnterHandler(node, () => persistEdit());
      }

      if (node.closest(".cv-preview-cv-item") && !node.classList.contains("cv-preview-description")) {
        bindCvItemEnterNavigation(node);
      }
    });

    syncAllPlaceholderClasses();
  }

  function renderPersonalSection() {
    const name = getEdit("personal.name", state.personalInfo.name || "Your Name");
    const phone = getEdit("personal.phone", state.personalInfo.phone || "");
    const email = getEdit("personal.email", state.personalInfo.email || "");

    const contactParts = [phone, email].filter(Boolean);
    const contactLine = contactParts.join("  |  ");

    return `
      <header class="cv-preview-header">
        <h1 class="cv-preview-name" contenteditable="false" data-edit-key="personal.name" data-placeholder-text="Your Name">${richTextToHtml(name)}</h1>
        ${
          contactLine
            ? `<p class="cv-preview-contact" contenteditable="false" data-edit-key="personal.contact" data-placeholder-text="Phone | Email">${richTextToHtml(
                getEdit("personal.contact", contactLine)
              )}</p>`
            : `<p class="cv-preview-contact" contenteditable="false" data-edit-key="personal.contact" data-placeholder-text="Phone | Email">Phone | Email</p>`
        }
      </header>
    `;
  }

  function renderCvItemSection(item, { publish = false } = {}) {
    const isDraft = !cvItemHasUserContent(item);
    if (publish && isDraft) {
      return "";
    }

    const filled = {};
    CV_ITEM_FIELD_KEYS.forEach((field) => {
      filled[field] = isCvItemFieldFilled(getCvItemFieldContent(item, field), field);
    });

    const shouldShow = (field) => (publish ? filled[field] : true);

    const hiddenFieldClass = (field) => {
      if (publish || filled[field] || isDraft) {
        return "";
      }
      return " cv-cv-item-field-hidden";
    };

    const placeholderClass = (field) =>
      !publish && !filled[field] ? " cv-preview-placeholder" : "";

    const fieldText = (field) =>
      filled[field] ? getCvItemFieldContent(item, field) : CV_ITEM_PLACEHOLDERS[field];

    let titleHtml = "";
    if (shouldShow("title") || shouldShow("date")) {
      titleHtml = `
        <div class="cv-preview-entry-header cv-preview-cv-item-title-row">
          ${
            shouldShow("title")
              ? `<h3
            class="cv-preview-entry-title cv-preview-cv-item-title${placeholderClass("title")}${hiddenFieldClass("title")}"
            contenteditable="false"
            data-edit-key="items.${item.id}.title"
            data-placeholder-text="Title"
          >${richTextToHtml(fieldText("title"))}</h3>`
              : ""
          }
          ${
            shouldShow("date")
              ? `<span
            class="cv-preview-entry-date cv-preview-cv-item-date${placeholderClass("date")}${hiddenFieldClass("date")}"
            contenteditable="false"
            data-edit-key="items.${item.id}.date"
            data-placeholder-text="DATE"
          >${richTextToHtml(fieldText("date"))}</span>`
              : ""
          }
        </div>
      `;
    }

    let subrowHtml = "";
    if (shouldShow("subtitle")) {
      subrowHtml = `
        <div class="cv-preview-cv-item-subrow">
          <span
            class="cv-preview-cv-item-subtitle${placeholderClass("subtitle")}${hiddenFieldClass("subtitle")}"
            contenteditable="false"
            data-edit-key="items.${item.id}.subtitle"
            data-placeholder-text="Subtitle"
          >${richTextToHtml(fieldText("subtitle"))}</span>
        </div>
      `;
    }

    let locationHtml = "";
    if (shouldShow("location")) {
      locationHtml = `
        <p
          class="cv-preview-cv-item-location${placeholderClass("location")}${hiddenFieldClass("location")}"
          contenteditable="false"
          data-edit-key="items.${item.id}.location"
          data-placeholder-text="Location"
        >${richTextToHtml(fieldText("location"))}</p>
      `;
    }

    let bulletsHtml = "";
    if (shouldShow("description")) {
      const bulletContent = filled.description
        ? getCvItemFieldContent(item, "description")
        : CV_ITEM_PLACEHOLDERS.description;
      const bulletMarkup = descriptionToEditableHtml(bulletContent);
      if (bulletMarkup || !publish) {
        bulletsHtml = `
          <div
            class="cv-preview-entry-body cv-preview-description cv-preview-cv-item-bullets${placeholderClass("description")}${hiddenFieldClass("description")}"
            contenteditable="false"
            data-edit-key="items.${item.id}.description"
            data-placeholder-text="${escapeDataPlaceholder(CV_ITEM_PLACEHOLDERS.description)}"
          >${bulletMarkup || descriptionToEditableHtml(CV_ITEM_PLACEHOLDERS.description)}</div>
        `;
      }
    }

    if (publish && !titleHtml && !subrowHtml && !locationHtml && !bulletsHtml) {
      return "";
    }

    return `
      <section class="cv-preview-entry cv-preview-cv-item" data-item-id="${item.id}">
        ${titleHtml}
        ${subrowHtml}
        ${locationHtml}
        ${bulletsHtml}
      </section>
    `;
  }

  function renderLayoutItem(item, options = {}) {
    let inner = "";
    let wrapExtraClass = "";

    if (item.type === "heading") {
      const title = getEdit(`items.${item.id}.title`, item.title || "Section Title");
      inner = `
        <h2 class="cv-preview-section-heading" contenteditable="false" data-edit-key="items.${item.id}.title" data-item-id="${item.id}" data-placeholder-text="Section Title">
          ${richTextToHtml(title)}
        </h2>
      `;
    } else if (item.type === "cv-item") {
      inner = renderCvItemSection(item, options);
      if (!inner) {
        return "";
      }
      if (!options.publish && cvItemHasUserContent(item)) {
        wrapExtraClass = " is-cv-item-collapsed";
      }
    } else {
      const achievement = getAchievement(item.achievementId);
      const title = getEdit(
        `items.${item.id}.title`,
        achievement?.title?.trim() || "Untitled achievement"
      );
      const date = getEdit(`items.${item.id}.date`, achievement?.date?.trim() || "");
      const showDescription = isAchievementDescriptionVisible(achievement);
      const description = showDescription
        ? getEdit(`items.${item.id}.description`, achievement?.description || "")
        : "";

      const descriptionHtml = showDescription ? descriptionToEditableHtml(description) : "";
      const descriptionMarkup = descriptionHtml
        ? `<div class="cv-preview-entry-body cv-preview-description" contenteditable="false" data-edit-key="items.${item.id}.description">${descriptionHtml}</div>`
        : "";

      inner = `
        <section class="cv-preview-entry" data-item-id="${item.id}">
          <div class="cv-preview-entry-header">
            <h3 class="cv-preview-entry-title" contenteditable="false" data-edit-key="items.${item.id}.title" data-placeholder-text="Untitled achievement">${richTextToHtml(title)}</h3>
            <span class="cv-preview-entry-date" contenteditable="false" data-edit-key="items.${item.id}.date" data-placeholder-text="Date">${richTextToHtml(date || "Date")}</span>
          </div>
          ${descriptionMarkup}
        </section>
      `;
    }

    const saveButton =
      item.type === "cv-item" || item.type === "achievement"
        ? libraryStarButtonMarkup(isLayoutItemInLibrary(item.id))
        : "";

    return `
      <div class="cv-section-wrap${wrapExtraClass}" data-layout-item-id="${item.id}">
        <div class="cv-section-handles">
          <button type="button" class="btn-icon cv-section-handle" draggable="true" aria-label="Drag to reorder section">⠿</button>
          <button type="button" class="btn-icon cv-section-remove" aria-label="Remove section from CV">×</button>
        </div>
        ${saveButton}
        ${inner}
      </div>
    `;
  }

  function renderDocumentEmptyState() {
    return `
      <div class="cv-doc-empty">
        <div class="cv-doc-empty-glyph" aria-hidden="true">¶</div>
        <p class="cv-doc-empty-headline">Start your CV</p>
        <p class="cv-doc-empty-body">Add Experience, Education, Skills, or Free text — or drag a saved item from Library.</p>
      </div>
    `;
  }

  function renderPreview(options = {}) {
    if (isEditingPreview) {
      const active = document.activeElement;
      const stillEditing =
        active &&
        cvPreview.contains(active) &&
        active.matches("[data-edit-key]") &&
        active.getAttribute("contenteditable") === "true";
      if (stillEditing) {
        return;
      }
      isEditingPreview = false;
    }

    if (!options.publish) {
      healPreviewEdits();
    }

    const preservedScroll = capturePreviewScroll();
    const focusItemId = options.focusItemId || options.flashItemId || null;

    const bodyContent =
      state.cvLayout.length === 0
        ? renderDocumentEmptyState()
        : state.cvLayout.map((item) => renderLayoutItem(item, options)).join("");

    cvPreview.innerHTML = `
      <div class="cv-preview-layout">
        ${renderPersonalSection()}
        <div class="cv-layout-skeleton" aria-hidden="true"></div>
        <div class="cv-preview-body">
          <div class="cv-insertion-line" aria-hidden="true"></div>
          ${bodyContent}
        </div>
      </div>
    `;

    bindEditableNodes();
    bindSectionHandles();
    scheduleSmartLayout({
      onComplete: () => {
        restorePreviewScroll(preservedScroll);
        if (focusItemId && options.focusFirstField) {
          focusFirstFieldOfItem(focusItemId);
        } else if (focusItemId) {
          focusSectionHandle(focusItemId);
        }
        if (options.flashItemId) {
          flashSection(options.flashItemId);
        }
        // Scaler size can settle one frame later; re-apply in case scroll was clamped.
        window.requestAnimationFrame(() => {
          if (focusItemId && options.focusFirstField) {
            const wrap = cvPreview.querySelector(
              `.cv-section-wrap[data-layout-item-id="${focusItemId}"]`
            );
            wrap?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
          } else {
            restorePreviewScroll(preservedScroll);
          }
        });
      },
    });
  }

  function sanitizeFileName(value) {
    const cleaned = String(value || "My_CV")
      .trim()
      .replace(/[<>:"/\\|?*]+/g, "")
      .replace(/\s+/g, "_");

    return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
  }

  function stripPdfSuffix(value) {
    return String(value || "").trim().replace(/\.pdf$/i, "");
  }

  function getCanvasDisplayName() {
    const raw = getEdit("personal.name", state.personalInfo.name || "");
    const plain = editPlainText(raw).replace(/\s+/g, " ").trim();
    if (
      !plain ||
      normalizePlaceholderCompare(plain) === normalizePlaceholderCompare("Your Name")
    ) {
      return "";
    }
    return plain;
  }

  function getDefaultExportBaseName() {
    const name = getCanvasDisplayName();
    if (name) {
      return `${name.replace(/\s+/g, "_")}_CV`;
    }
    return "My_CV";
  }

  function getExportDensityLabel() {
    const base = getLayoutStyles().baseFontSize;
    return base != null ? `${base}pt` : "—";
  }

  function getExportModalCaption() {
    const count = state.cvLayout.length;
    const noun = count === 1 ? "section" : "sections";
    return `A4 · ${count} ${noun} · ${getExportDensityLabel()}`;
  }

  function setExportModalBusy(isBusy) {
    isExportingPdf = isBusy;
    exportModalConfirm.disabled = isBusy;
    exportModalCancel.disabled = isBusy;
    exportFileNameInput.disabled = isBusy;

    if (isBusy) {
      exportModalConfirmLabel.innerHTML =
        '<span class="btn-spinner" aria-hidden="true"></span><span>Exporting…</span>';
      return;
    }

    exportModalConfirmLabel.textContent = "Export";
  }

  function openExportModal() {
    if (!exportModal || !exportFileNameInput) {
      return;
    }

    exportModalCaption.textContent = getExportModalCaption();
    exportFileNameInput.value = getDefaultExportBaseName();
    exportModal.hidden = false;
    exportModal.removeAttribute("aria-hidden");
    setExportModalBusy(false);
    setModalBackgroundHidden(true);

    window.requestAnimationFrame(() => {
      exportFileNameInput.focus();
      exportFileNameInput.select();
    });
  }

  function closeExportModal() {
    if (!exportModal) {
      return;
    }

    exportModal.hidden = true;
    exportModal.setAttribute("aria-hidden", "true");
    setExportModalBusy(false);
    setModalBackgroundHidden(false);
    exportPdfBtn?.focus();
  }

  function setModalBackgroundHidden(hidden) {
    const topbar = document.querySelector(".topbar");
    const logbook = document.getElementById("viewLogbook");
    const studio = document.getElementById("viewStudio");
    const activeView = window.AchieveMateViews?.getActiveView?.() || "studio";

    if (hidden) {
      topbar?.setAttribute("aria-hidden", "true");
      logbook?.setAttribute("aria-hidden", "true");
      studio?.setAttribute("aria-hidden", "true");
      return;
    }

    topbar?.removeAttribute("aria-hidden");
    logbook?.setAttribute("aria-hidden", activeView === "logbook" ? "false" : "true");
    studio?.setAttribute("aria-hidden", activeView === "studio" ? "false" : "true");
  }

  function bindExportModal() {
    if (!exportModal || !exportModalConfirm) {
      return;
    }

    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

    exportPdfBtn?.addEventListener("click", async () => {
      if (!pdfLibraryReady()) {
        window.AchieveMateToast?.show("PDF export library failed to load", {
          tone: "danger",
          actionLabel: "Retry",
          onAction: () => openExportModal(),
        });
        return;
      }

      if (state.cvLayout.length === 0) {
        window.AchieveMateToast?.show("Add sections to your CV before exporting", {
          tone: "neutral",
        });
        return;
      }

      openExportModal();
    });

    exportModalCancel?.addEventListener("click", () => {
      if (!isExportingPdf) {
        closeExportModal();
      }
    });

    exportModalOverlay?.addEventListener("click", () => {
      if (!isExportingPdf) {
        closeExportModal();
      }
    });

    exportModalConfirm?.addEventListener("click", () => {
      if (!isExportingPdf) {
        performPdfExport();
      }
    });

    exportFileNameInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !isExportingPdf) {
        event.preventDefault();
        performPdfExport();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (exportModal.hidden) {
        return;
      }

      if (event.key === "Escape" && !isExportingPdf) {
        closeExportModal();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const panel = exportModal.querySelector(".modal-panel");
      const focusables = [...panel.querySelectorAll(focusableSelector)];
      if (focusables.length === 0) {
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  function clearArmedRestore() {
    if (armedRestoreButton) {
      armedRestoreButton.classList.remove("is-armed");
      armedRestoreButton.textContent = "↺";
      if (armedRestoreButton.dataset.defaultLabel) {
        armedRestoreButton.setAttribute("aria-label", armedRestoreButton.dataset.defaultLabel);
      }
    }

    armedRestoreEntryId = null;
    armedRestoreButton = null;
    window.clearTimeout(armedRestoreTimer);
    armedRestoreTimer = null;
  }

  function armRestoreConfirm(entry, restoreBtn) {
    clearArmedRestore();
    armedRestoreEntryId = entry.id;
    armedRestoreButton = restoreBtn;
    restoreBtn.classList.add("is-armed");
    restoreBtn.textContent = "Sure?";
    restoreBtn.setAttribute("aria-label", "Restore this snapshot?");
    armedRestoreTimer = window.setTimeout(() => {
      if (armedRestoreEntryId === entry.id) {
        clearArmedRestore();
      }
    }, 2000);
  }

  function buildHistorySnapshot() {
    captureEditsFromDom();

    return {
      personalInfo: { ...state.personalInfo },
      cvLayout: JSON.parse(JSON.stringify(state.cvLayout)),
      cvPreviewEdits: JSON.parse(JSON.stringify(state.cvPreviewEdits)),
      cvSettings: JSON.parse(JSON.stringify(state.cvSettings)),
      previewHtml: cvPreview.innerHTML,
    };
  }

  function addExportHistoryEntry(fileName, snapshot) {
    const entry = {
      id: createId("exp"),
      fileName,
      exportedAt: new Date().toISOString(),
      snapshot,
    };

    state.exportHistory.unshift(entry);

    if (state.exportHistory.length > 20) {
      state.exportHistory = state.exportHistory.slice(0, 20);
    }

    saveState();
    renderExportHistory();
  }

  function deleteExportHistoryEntry(entryId) {
    state.exportHistory = state.exportHistory.filter((item) => item.id !== entryId);
    saveState();
    renderExportHistory();
  }

  function restoreExportSnapshot(entry) {
    if (!entry.snapshot) {
      return;
    }

    state.personalInfo = {
      ...state.personalInfo,
      ...(entry.snapshot.personalInfo || {}),
    };
    state.cvLayout = entry.snapshot.cvLayout || [];
    state.cvPreviewEdits = entry.snapshot.cvPreviewEdits || { personal: {}, items: {} };
    const restoredSettings = entry.snapshot.cvSettings || entry.snapshot.cvLayoutStyles;
    if (restoredSettings) {
      state.cvSettings = {
        ...app.DEFAULT_CV_SETTINGS,
        ...restoredSettings,
      };
    }
    app.saveCvSettings();
    saveState();

    if (window.AchieveMateCvLayoutPanel) {
      window.AchieveMateCvLayoutPanel.syncFormFromState();
    }

    if (window.AchieveMateApp?.refreshPersonalForm) {
      window.AchieveMateApp.refreshPersonalForm();
    }

    if (window.AchieveMateCvBuilder) {
      window.AchieveMateCvBuilder.render();
    } else {
      renderPreview();
    }

    window.AchieveMateCvHistory?.seed?.();
  }

  function buildExportHistoryItem(entry) {
    const item = document.createElement("li");
    item.className = "export-history-item";

    const date = new Date(entry.exportedAt);
    const formatted = Number.isNaN(date.getTime())
      ? entry.exportedAt
      : date.toLocaleString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

    item.innerHTML = `
      <div class="export-history-meta">
        <span class="mono-sm export-history-filename">${escapeHtml(entry.fileName)}</span>
        <span class="caption export-history-timestamp">${escapeHtml(formatted)}</span>
      </div>
      <div class="export-history-actions">
        <button type="button" class="btn-icon export-history-restore" aria-label="Restore ${escapeHtml(entry.fileName)}">↺</button>
        <button type="button" class="btn-icon export-history-delete" aria-label="Delete export history for ${escapeHtml(entry.fileName)}">×</button>
      </div>
    `;

    const restoreBtn = item.querySelector(".export-history-restore");
    restoreBtn.dataset.defaultLabel = `Restore ${entry.fileName}`;
    restoreBtn.addEventListener("click", (event) => {
      const button = event.currentTarget;
      if (armedRestoreEntryId === entry.id) {
        clearArmedRestore();
        restoreExportSnapshot(entry);
        return;
      }

      armRestoreConfirm(entry, button);
    });

    item.querySelector(".export-history-delete").addEventListener("click", () => {
      deleteExportHistoryEntry(entry.id);
    });

    return item;
  }

  function renderExportHistoryList(listEl) {
    if (!listEl) {
      return;
    }

    listEl.innerHTML = "";

    if (state.exportHistory.length === 0) {
      const empty = document.createElement("li");
      empty.className = "export-history-empty";
      empty.textContent = "No exports yet";
      listEl.appendChild(empty);
      return;
    }

    state.exportHistory.forEach((entry) => {
      listEl.appendChild(buildExportHistoryItem(entry));
    });
  }

  function renderExportHistory() {
    clearArmedRestore();
    renderExportHistoryList(exportHistoryList);
    renderExportHistoryList(drawerExportHistoryList);
  }

  function pdfLibraryReady() {
    return Boolean(window.jspdf?.jsPDF && window.AchieveMatePdf?.createCvPdf);
  }

  function readCssPt(variableName, fallbackPt) {
    const raw = cvPreview?.style.getPropertyValue(variableName)?.trim() || "";
    if (!raw) {
      return fallbackPt;
    }
    if (raw.endsWith("pt")) {
      return parseFloat(raw) || fallbackPt;
    }
    if (raw.endsWith("px")) {
      return (parseFloat(raw) || 0) * 0.75 || fallbackPt;
    }
    if (raw.endsWith("in")) {
      return (parseFloat(raw) || 0) * 72 || fallbackPt;
    }
    if (raw.endsWith("mm")) {
      return ((parseFloat(raw) || 0) * 72) / 25.4 || fallbackPt;
    }
    const value = parseFloat(raw);
    return Number.isFinite(value) ? value : fallbackPt;
  }

  function parsePdfColor(hex) {
    const match = String(hex || "").trim().match(/^#?([0-9a-f]{6})$/i);
    const value = match ? match[1] : "000000";
    return [
      parseInt(value.slice(0, 2), 16),
      parseInt(value.slice(2, 4), 16),
      parseInt(value.slice(4, 6), 16),
    ];
  }

  function buildPdfModel() {
    const styles = getLayoutStyles();
    const manual = manualTypographyFromBase(styles.baseFontSize ?? 11);
    const nameValue = getEdit("personal.name", state.personalInfo.name || "");
    const contactFallback = [state.personalInfo.phone, state.personalInfo.email].filter(Boolean).join("  |  ");
    const contactValue = getEdit("personal.contact", contactFallback);
    const nameLines = exportFieldLines(nameValue, "Your Name");
    const blocks = [];

    state.cvLayout.forEach((item) => {
      if (item.type === "heading") {
        const title = exportFieldLines(
          getEdit(`items.${item.id}.title`, item.title || "Section Title"),
          "Section Title"
        );
        if (title.length) {
          blocks.push({ kind: "heading", title });
        }
        return;
      }

      if (item.type === "cv-item") {
        const block = {
          kind: "cv-item",
          title: [],
          subtitle: [],
          date: [],
          location: [],
          bullets: [],
        };
        CV_ITEM_FIELD_KEYS.forEach((field) => {
          const content = getCvItemFieldContent(item, field);
          if (!isCvItemFieldFilled(content, field)) {
            return;
          }
          if (field === "description") {
            block.bullets = exportBulletLines(content, CV_ITEM_PLACEHOLDERS.description);
            return;
          }
          block[field] = exportFieldLines(content, CV_ITEM_PLACEHOLDERS[field]);
        });
        const hasContent = [block.title, block.subtitle, block.date, block.location, block.bullets].some(
          (group) => group.length > 0
        );
        if (hasContent) {
          blocks.push(block);
        }
        return;
      }

      const achievement = getAchievement(item.achievementId);
      const title = exportFieldLines(
        getEdit(`items.${item.id}.title`, achievement?.title?.trim() || ""),
        "Untitled achievement"
      );
      const date = exportFieldLines(
        getEdit(`items.${item.id}.date`, achievement?.date?.trim() || ""),
        "Date"
      );
      const description = isAchievementDescriptionVisible(achievement)
        ? getEdit(`items.${item.id}.description`, achievement?.description || "")
        : "";
      const bullets = exportBulletLines(description, "");
      if (!title.length && !date.length && !bullets.length) {
        return;
      }
      blocks.push({
        kind: "achievement",
        title,
        subtitle: [],
        date,
        location: [],
        bullets,
      });
    });

    const lineHeightRaw = parseFloat(cvPreview?.style.getPropertyValue("--cv-line-height"));
    const autoFit = styles.autoFit === true;

    const model = {
      documentTitle: nameLines.length ? editPlainText(nameValue) : "CV",
      fontFamily: styles.fontFamily,
      textColor: parsePdfColor(styles.textColor),
      accentColor: parsePdfColor(styles.accentColor),
      marginPt: readCssPt("--cv-page-padding", 54),
      namePt: readCssPt("--cv-name-font", getNameFontSizePt(styles)),
      headingPt: readCssPt("--cv-section-heading-font", getHeadingFontSizePt(styles)),
      titlePt: readCssPt("--cv-header-font", manual.headerFontPt),
      bodyPt: Math.max(LAYOUT.minBodyPt, readCssPt("--cv-body-font", manual.bodyFontPt)),
      lineHeight: Number.isFinite(lineHeightRaw) ? lineHeightRaw : styles.lineHeight || 1.3,
      sectionGapPt: readCssPt("--cv-section-gap", (styles.sectionGap ?? 12) * 0.75),
      sectionMarginPt: readCssPt("--cv-section-margin", (styles.sectionGap ?? 12) * 0.75),
      itemGapPt: readCssPt("--cv-item-gap", (styles.itemGap ?? 4) * 0.75),
      headingDivider: styles.headingDivider || "solid",
      name: nameLines,
      contact: exportFieldLines(contactValue, "Phone | Email"),
      blocks,
      autoFit,
    };

    if (autoFit && pdfFitOverride) {
      model.marginPt = pdfFitOverride.marginPt;
      model.namePt = pdfFitOverride.namePt;
      model.headingPt = pdfFitOverride.headingPt;
      model.titlePt = pdfFitOverride.titlePt;
      model.bodyPt = Math.max(LAYOUT.minBodyPt, Number(pdfFitOverride.bodyPt) || LAYOUT.minBodyPt);
      model.lineHeight = pdfFitOverride.lineHeight;
      model.sectionGapPt = pdfFitOverride.sectionGapPt;
      model.sectionMarginPt = pdfFitOverride.sectionMarginPt;
      model.itemGapPt = pdfFitOverride.itemGapPt;
    }

    return model;
  }

  async function createExportPdfDoc() {
    captureEditsFromDom();
    healPreviewEdits();
    if (getLayoutStyles().autoFit === true) {
      applySmartLayout();
    } else {
      pdfFitOverride = null;
      applyLayoutStyles();
    }
    const model = buildPdfModel();
    const doc = await window.AchieveMatePdf.createCvPdf(model);
    const fit = window.AchieveMatePdf.getCvPdfFit?.(doc);
    if (model.autoFit && (fit?.fitChanged || fit?.fitOverflow)) {
      rememberPdfFit(fit);
      syncDesignFittedOutputs();
    }
    return doc;
  }

  async function performPdfExport() {
    const baseName = stripPdfSuffix(exportFileNameInput?.value);
    if (!baseName) {
      window.AchieveMateToast?.show("Please enter a valid file name", { tone: "neutral" });
      exportFileNameInput?.focus();
      return;
    }

    const fileName = sanitizeFileName(baseName);
    lastExportFileName = fileName;
    setExportModalBusy(true);

    try {
      const doc = await createExportPdfDoc();
      const snapshot = buildHistorySnapshot();
      doc.save(fileName);
      addExportHistoryEntry(fileName, snapshot);
      closeExportModal();
      window.AchieveMateToast?.show(`Exported ${fileName}`, { tone: "success" });
    } catch (error) {
      console.error("PDF export failed:", error);
      setExportModalBusy(false);
      window.AchieveMateToast?.show("PDF export failed", {
        tone: "danger",
        actionLabel: "Retry",
        onAction: () => performPdfExport(),
      });
    } finally {
      if (isExportingPdf) {
        setExportModalBusy(false);
      }
    }
  }
  renderPreview();
  renderExportHistory();
  applyLayoutStyles();
  bindPreviewResizeObserver();
  bindExportModal();
  bindLayoutDrawerToggle();
  bindPreviewZoomControls();
  bindDocumentDragDrop();
  bindPreviewPointerInteraction();
  applyPreviewZoom();
  scheduleFitPreview();

  window.AchieveMateCvPreview = {
    render: renderPreview,
    applyLayoutStyles,
    scheduleSmartLayout,
    getLiveTypography,
    fitPreviewToScreen,
    scheduleFitPreview,
    setUserZoom,
    hideInsertionLine,
    renderExportHistory,
    createExportPdfDoc,
    syncLibraryStars,
    refreshLibraryStars: syncLibraryStars,
  };
})();
