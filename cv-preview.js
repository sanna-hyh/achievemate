(function initCvPreview() {
  const app = window.AchieveMateApp;
  if (!app) {
    return;
  }

  const { state, saveState, createId, escapeHtml } = app;

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
  let fitPreviewFrame = null;
  let editSaveTimer = null;
  let layoutDebounceTimer = null;
  let baseFitScale = 1;
  let userZoom = 1;
  let documentDragState = null;
  let documentDragCancelled = false;
  let sectionPointer = null;
  let sectionDragSession = null;
  let editClickState = null;
  const SECTION_DRAG_THRESHOLD_PX = 8;
  const EDIT_DOUBLE_CLICK_MS = 720;
  const EDIT_DOUBLE_CLICK_MAX_DISTANCE_PX = 16;

  function clearEditClickState() {
    editClickState = null;
  }

  function detectEditDoubleClick(event) {
    if (event.target.closest(".cv-section-remove, .cv-section-handle")) {
      clearEditClickState();
      return null;
    }
    if (event.target.closest('[contenteditable="true"].is-editing')) {
      clearEditClickState();
      return null;
    }

    const editTarget = resolveEditTarget(event.target);
    if (!editTarget) {
      clearEditClickState();
      return null;
    }

    const now = performance.now();
    const previous = editClickState;

    if (
      previous &&
      previous.target === editTarget &&
      now - previous.time <= EDIT_DOUBLE_CLICK_MS &&
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= EDIT_DOUBLE_CLICK_MAX_DISTANCE_PX
    ) {
      clearEditClickState();
      return editTarget;
    }

    editClickState = {
      target: editTarget,
      time: now,
      x: event.clientX,
      y: event.clientY,
    };
    return null;
  }

  function resolveEditDoubleClickTarget(event) {
    if (event.detail >= 2) {
      return resolveEditTarget(event.target);
    }
    return detectEditDoubleClick(event);
  }

  function clearSectionPointer() {
    if (sectionPointer?.wrap) {
      sectionPointer.wrap.classList.remove("is-drag-armed");
    }
    sectionPointer = null;
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

  function activateEdit(node, event) {
    if (!node) {
      return;
    }

    clearSectionPointer();
    node.setAttribute("contenteditable", "true");
    node.classList.add("is-editing");
    isEditingPreview = true;
    node.focus({ preventScroll: true });

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
    clearEditClickState();
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
    event.dataTransfer.effectAllowed = "move";
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
      if (isPointerOverDocument(event.clientX, event.clientY)) {
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

        if (currentIndex !== -1 && isPointerOverDocument(event.clientX, event.clientY)) {
          const index = resolveDropIndex(getPreviewBody(), event.clientY);
          documentDragState.handled = true;
          builder.moveLayoutItem(currentIndex, index);
        } else if (event.clientX !== 0 || event.clientY !== 0) {
          documentDragState.handled = true;
          removeSectionFromCv(layoutItemId);
        }
      }

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
      if (event.target.closest(".cv-section-remove, .cv-section-handle")) {
        return;
      }
      if (event.target.closest('[contenteditable="true"].is-editing')) {
        return;
      }

      const editDoubleTarget = resolveEditDoubleClickTarget(event);
      if (editDoubleTarget && tryActivateEdit(event, editDoubleTarget)) {
        return;
      }

      const wrap = event.target.closest(".cv-section-wrap");
      const editable = resolveEditTarget(event.target);
      if (!wrap && !editable) {
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

      const onMove = (moveEvent) => {
        if (!sectionPointer) {
          return;
        }

        const distance = Math.hypot(moveEvent.clientX - sectionPointer.x, moveEvent.clientY - sectionPointer.y);
        if (distance >= SECTION_DRAG_THRESHOLD_PX) {
          moveEvent.preventDefault();
          sectionPointer.moved = true;
          sectionPointer.wrap?.classList.add("is-drag-armed");

          if (sectionPointer.wrap && sectionPointer.layoutItemId) {
            startPointerSectionDrag(sectionPointer.wrap, sectionPointer.layoutItemId, moveEvent);
          }
        }
      };

      const onUp = (upEvent) => {
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

    cvPreview.addEventListener("dblclick", (event) => {
      const editTarget = resolveEditTarget(event.target);
      if (editTarget) {
        tryActivateEdit(event, editTarget);
      }
    });
  }
  const MIN_USER_ZOOM = 1;
  const MAX_USER_ZOOM = 3;
  const ZOOM_STEP = 0.12;

  function resetPreviewTransform() {
    if (!cvPreview || !cvPreviewScaler) {
      return;
    }

    cvPreview.style.transform = "none";
  }

  function getPreviewWrap() {
    return document.getElementById("cvPreviewWrap");
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

  function updatePreviewZoomUi() {
    const zoomValue = document.getElementById("previewZoomValue");
    const zoomOutBtn = document.getElementById("previewZoomOutBtn");
    const zoomInBtn = document.getElementById("previewZoomInBtn");
    const zoomFitBtn = document.getElementById("previewZoomFitBtn");
    const percent = Math.round(userZoom * 100);

    if (zoomValue) {
      zoomValue.textContent = `${percent}%`;
    }
    if (zoomOutBtn) {
      zoomOutBtn.disabled = userZoom <= MIN_USER_ZOOM + 0.001;
    }
    if (zoomInBtn) {
      zoomInBtn.disabled = userZoom >= MAX_USER_ZOOM - 0.001;
    }
    if (zoomFitBtn) {
      zoomFitBtn.disabled = userZoom <= MIN_USER_ZOOM + 0.001;
    }
  }

  function applyPreviewZoom() {
    const metrics = measurePreviewFit();
    if (!metrics || !cvPreviewScaler || !cvPreview) {
      return;
    }

    const { wrap, docW, docH, baseFitScale: nextBaseFitScale } = metrics;
    baseFitScale = nextBaseFitScale;
    userZoom = Math.max(MIN_USER_ZOOM, Math.min(MAX_USER_ZOOM, userZoom));

    const scale = baseFitScale * userZoom;
    cvPreview.style.transform = `scale(${scale})`;
    cvPreview.style.transformOrigin = "top left";
    cvPreviewScaler.style.width = `${docW * scale}px`;
    cvPreviewScaler.style.height = `${docH * scale}px`;
    wrap.dataset.previewScale = scale.toFixed(3);
    wrap.dataset.userZoom = userZoom.toFixed(3);

    const isZoomed = userZoom > MIN_USER_ZOOM + 0.001;
    wrap.classList.toggle("is-zoomed", isZoomed);

    if (!isZoomed) {
      wrap.scrollTop = 0;
      wrap.scrollLeft = 0;
    }

    updatePreviewZoomUi();
  }

  function setUserZoom(nextZoom) {
    userZoom = Math.max(MIN_USER_ZOOM, Math.min(MAX_USER_ZOOM, nextZoom));
    applyPreviewZoom();
  }

  function fitPreviewToScreen() {
    userZoom = MIN_USER_ZOOM;
    applyPreviewZoom();
  }

  function scheduleFitPreview() {
    if (fitPreviewFrame) {
      cancelAnimationFrame(fitPreviewFrame);
    }

    fitPreviewFrame = requestAnimationFrame(() => {
      fitPreviewFrame = null;
      applyPreviewZoom();
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

    window.addEventListener("resize", scheduleFitPreview);
  }

  function bindPreviewZoomControls() {
    const wrap = getPreviewWrap();
    const zoomInBtn = document.getElementById("previewZoomInBtn");
    const zoomOutBtn = document.getElementById("previewZoomOutBtn");
    const zoomFitBtn = document.getElementById("previewZoomFitBtn");

    zoomInBtn?.addEventListener("click", () => {
      setUserZoom(userZoom + ZOOM_STEP);
    });

    zoomOutBtn?.addEventListener("click", () => {
      setUserZoom(userZoom - ZOOM_STEP);
    });

    zoomFitBtn?.addEventListener("click", () => {
      fitPreviewToScreen();
    });

    wrap?.addEventListener(
      "wheel",
      (event) => {
        if (!(event.ctrlKey || event.metaKey)) {
          return;
        }

        event.preventDefault();
        const direction = event.deltaY > 0 ? -1 : 1;
        setUserZoom(userZoom + direction * ZOOM_STEP);
      },
      { passive: false }
    );
  }

  function bindLayoutDrawerToggle() {
    const toggleBtn = document.getElementById("toggleLayoutDrawerBtn");
    const cockpit = document.getElementById("studioCockpit");
    const drawerScrim = document.getElementById("drawerScrim");
    if (!toggleBtn || !cockpit) {
      return;
    }

    let collapsedInOverlay = false;

    function isDrawerOverlayMode() {
      return window.matchMedia("(max-width: 1100px)").matches;
    }

    function syncDrawerScrim() {
      if (!drawerScrim) {
        return;
      }

      const overlayMode = isDrawerOverlayMode();
      const isOpen = !cockpit.classList.contains("is-drawer-collapsed");
      const showScrim = overlayMode && isOpen;

      drawerScrim.hidden = !showScrim;
      drawerScrim.classList.toggle("is-visible", showScrim);
      drawerScrim.setAttribute("aria-hidden", String(!showScrim));
    }

    function setDrawerOpen(isOpen) {
      cockpit.classList.toggle("is-drawer-collapsed", !isOpen);
      document.body.classList.toggle("layout-drawer-collapsed", !isOpen);
      toggleBtn.setAttribute("aria-expanded", String(isOpen));
      toggleBtn.classList.toggle("is-active", isOpen);

      if (!isOpen && isDrawerOverlayMode()) {
        collapsedInOverlay = true;
      } else if (isOpen) {
        collapsedInOverlay = false;
      }

      syncDrawerScrim();
      window.setTimeout(scheduleFitPreview, 300);
    }

    function syncDrawerLayout() {
      syncDrawerScrim();

      if (!isDrawerOverlayMode() && collapsedInOverlay) {
        setDrawerOpen(true);
        collapsedInOverlay = false;
      }
    }

    toggleBtn.addEventListener("click", () => {
      const isCollapsed = cockpit.classList.contains("is-drawer-collapsed");
      setDrawerOpen(!isCollapsed);
    });

    drawerScrim?.addEventListener("click", () => {
      setDrawerOpen(false);
    });

    window.addEventListener("resize", syncDrawerLayout);
    document.addEventListener("keydown", (event) => {
      if (
        event.key === "Escape" &&
        isDrawerOverlayMode() &&
        !cockpit.classList.contains("is-drawer-collapsed")
      ) {
        setDrawerOpen(false);
      }
    });

    syncDrawerLayout();
  }

  function bindHistoryPopover() {
    const historyBtn = document.getElementById("historyBtn");
    const popover = document.getElementById("historyPopover");
    if (!historyBtn || !popover) {
      return;
    }

    function setOpen(isOpen) {
      popover.hidden = !isOpen;
      historyBtn.setAttribute("aria-expanded", String(isOpen));

      if (isOpen) {
        const firstFocusable = popover.querySelector("button, a, [tabindex='0']");
        if (firstFocusable) {
          firstFocusable.focus();
        } else {
          popover.focus();
        }
      } else {
        historyBtn.focus();
      }
    }

    popover.tabIndex = -1;

    historyBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      setOpen(popover.hidden);
    });

    document.addEventListener("click", (event) => {
      if (!popover.hidden && !popover.contains(event.target) && event.target !== historyBtn) {
        setOpen(false);
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !popover.hidden) {
        setOpen(false);
      }
    });
  }

  function updateDensityGauge({ ratio = null, bodyFontPt = null, mode = "auto", overflow = false } = {}) {
    const gauge = document.getElementById("densityGauge");
    const fill = document.getElementById("densityGaugeFill");
    const readout = document.getElementById("densityGaugeReadout");
    const track = gauge?.querySelector(".density-gauge-track");
    if (!gauge || !fill || !readout) {
      return;
    }

    gauge.classList.toggle("is-overflow", overflow);

    if (mode === "manual") {
      fill.style.width = "0";
      readout.textContent = "manual";
      if (track) {
        track.title = "";
      }
      return;
    }

    if (mode === "empty") {
      fill.style.width = "0";
      readout.textContent = "—";
      if (track) {
        track.title = "";
      }
      return;
    }

    if (overflow) {
      fill.style.width = "100%";
      readout.textContent = "overflows";
      if (track) {
        track.title = "Content exceeds one page — remove items or reduce sizes.";
      }
      return;
    }

    const safeRatio = Math.max(0, Math.min(1, ratio ?? 0));
    fill.style.width = `${safeRatio * 100}%`;
    readout.textContent = bodyFontPt != null ? `${bodyFontPt}pt` : "—";
    if (track) {
      track.title = "";
    }
  }

  const LAYOUT = {
    minBodyPt: 9,
    maxBodyPt: 12,
    minHeaderPt: 9.5,
    maxHeaderPt: 12,
    minLineHeight: 1.1,
    maxLineHeight: 1.5,
    minSpacingPx: 0,
    maxSpacingPx: 24,
    pageHeightMm: 297,
  };

  const PAGE_MARGIN_MAP = {
    compact: "0.5in",
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
    const bodyFontPt = Math.max(9, Math.min(12, baseFontSize));
    return {
      bodyFontPt,
      headerFontPt: Math.min(bodyFontPt + 0.5, 12),
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

    if (params.singlePage) {
      cvPreview.classList.add("cv-preview-single-page");
    } else {
      cvPreview.classList.remove("cv-preview-single-page");
    }
  }

  function measurePageOverflow() {
    if (!cvPreview.classList.contains("cv-preview-single-page")) {
      return false;
    }

    return cvPreview.scrollHeight > cvPreview.clientHeight + 2;
  }

  function applySmartLayout(options = {}) {
    applyLayoutStyles();

    const finishLayout = () => {
      if (options.syncFit) {
        applyPreviewZoom();
      } else {
        scheduleFitPreview();
      }
    };

    if (state.cvLayout.length === 0) {
      cvPreview.classList.remove("cv-preview-single-page");
      cvPreview.dataset.layoutDensity = "";
      cvPreview.dataset.contentChars = "";
      cvPreview.dataset.contentItems = "";
      updateDensityGauge({ mode: "empty" });
      finishLayout();
      return;
    }

    if (getLayoutStyles().autoFit !== true) {
      cvPreview.classList.add("cv-preview-single-page");
      cvPreview.dataset.layoutDensity = "manual";
      updateDensityGauge({ mode: "manual" });
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

    applyLayoutParams(layoutParamsFromRatio(low));

    let overflow = false;
    if (measurePageOverflow()) {
      overflow = true;
      applyLayoutParams({
        ...layoutParamsFromRatio(0),
        singlePage: false,
        density: "compact",
      });
    }

    const finalParams = layoutParamsFromRatio(low);
    updateDensityGauge({
      ratio: low,
      bodyFontPt: finalParams.bodyFontPt,
      mode: "auto",
      overflow,
    });

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
    });
  }

  function waitForLayout() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });
  }

  function createExportNode() {
    applyLayoutStyles();

    const exportNode = cvPreview.cloneNode(true);
    exportNode.removeAttribute("id");
    exportNode.classList.add("is-exporting");
    exportNode.style.transform = "none";

    const styles = getLayoutStyles();
    const pagePadding = PAGE_MARGIN_MAP[styles.pageMargin] || PAGE_MARGIN_MAP.normal;
    exportNode.style.padding = pagePadding;
    exportNode.style.setProperty("--cv-page-padding", pagePadding);

    exportNode.querySelectorAll("[contenteditable]").forEach((node) => {
      node.removeAttribute("contenteditable");
    });

    const wrapper = document.createElement("div");
    wrapper.className = "cv-export-wrapper";
    wrapper.appendChild(exportNode);
    document.body.appendChild(wrapper);

    return { exportNode, wrapper };
  }

  function removeExportNode(wrapper) {
    wrapper.remove();
  }

  function getAchievement(achievementId) {
    return state.achievements.find((item) => item.id === achievementId);
  }

  function isAchievementDescriptionVisible(achievement) {
    return app.isAchievementDescriptionVisible(achievement);
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
        const next = [...state.cvLayout];
        next.splice(result.index, 0, result.removed);
        state.cvLayout = next;
        saveState();
        builder.render();
        renderPreview({ flashItemId: result.removed.id });
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
      event.dataTransfer.dropEffect = "move";
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

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
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

      removeBtn?.addEventListener("click", (event) => {
        event.stopPropagation();
        removeSectionFromCv(layoutItemId);
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

    cvPreview.querySelectorAll("[data-edit-key]").forEach((node) => {
      setEdit(node.dataset.editKey, getNodeEditContent(node), { skipSave: true });
    });

    flushEditSave();
  }

  function descriptionToEditableHtml(description) {
    const lines = String(description || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^[•\-*]\s*/, ""))
      .filter((line) => line !== "Add description points");

    if (lines.length === 0) {
      return "";
    }

    return lines.map((line) => richTextToHtml(`• ${line}`)).join("<br>");
  }

  function bindDescriptionEnterHandler(node, onEdit) {
    node.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey) {
        return;
      }

      event.preventDefault();
      document.execCommand("insertHTML", false, "<br>• ");
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
        setEdit(node.dataset.editKey, getNodeEditContent(node), options);
      };

      node.addEventListener("focus", () => {
        isEditingPreview = true;
        node.classList.add("is-editing");
      });

      node.addEventListener("blur", () => {
        node.classList.remove("is-editing");
        node.setAttribute("contenteditable", "false");
        persistEdit({ flushSave: true });
        isEditingPreview = false;
        scheduleSmartLayoutDebounced();
      });

      node.addEventListener("input", () => persistEdit());
      bindRichTextShortcuts(node, () => persistEdit());
      bindCvPasteHandler(node, () => persistEdit());

      if (node.classList.contains("cv-preview-description")) {
        bindDescriptionEnterHandler(node, () => persistEdit());
      }
    });
  }

  function renderPersonalSection() {
    const name = getEdit("personal.name", state.personalInfo.name || "Your Name");
    const phone = getEdit("personal.phone", state.personalInfo.phone || "");
    const email = getEdit("personal.email", state.personalInfo.email || "");

    const contactParts = [phone, email].filter(Boolean);
    const contactLine = contactParts.join("  |  ");

    return `
      <header class="cv-preview-header">
        <h1 class="cv-preview-name" contenteditable="false" data-edit-key="personal.name">${richTextToHtml(name)}</h1>
        ${
          contactLine
            ? `<p class="cv-preview-contact" contenteditable="false" data-edit-key="personal.contact">${richTextToHtml(
                getEdit("personal.contact", contactLine)
              )}</p>`
            : `<p class="cv-preview-contact cv-preview-placeholder" contenteditable="false" data-edit-key="personal.contact">Phone | Email</p>`
        }
      </header>
    `;
  }

  function renderLayoutItem(item) {
    let inner = "";

    if (item.type === "heading") {
      const title = getEdit(`items.${item.id}.title`, item.title || "Section Title");
      inner = `
        <h2 class="cv-preview-section-heading" contenteditable="false" data-edit-key="items.${item.id}.title" data-item-id="${item.id}">
          ${richTextToHtml(title)}
        </h2>
      `;
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
            <h3 class="cv-preview-entry-title" contenteditable="false" data-edit-key="items.${item.id}.title">${richTextToHtml(title)}</h3>
            <span class="cv-preview-entry-date" contenteditable="false" data-edit-key="items.${item.id}.date">${richTextToHtml(date || "Date")}</span>
          </div>
          ${descriptionMarkup}
        </section>
      `;
    }

    return `
      <div class="cv-section-wrap" data-layout-item-id="${item.id}">
        <div class="cv-section-handles">
          <button type="button" class="btn-icon cv-section-handle" draggable="true" aria-label="Drag to reorder section">⠿</button>
          <button type="button" class="btn-icon cv-section-remove" aria-label="Remove section from CV">×</button>
        </div>
        ${inner}
      </div>
    `;
  }

  function renderDocumentEmptyState() {
    return `
      <div class="cv-doc-empty">
        <div class="cv-doc-empty-glyph" aria-hidden="true">¶</div>
        <p class="cv-doc-empty-headline">Drag achievements here</p>
        <p class="cv-doc-empty-body">Pull from the rail on the left to compose your CV.</p>
      </div>
    `;
  }

  function renderPreview(options = {}) {
    if (isEditingPreview) {
      return;
    }

    const bodyContent =
      state.cvLayout.length === 0
        ? renderDocumentEmptyState()
        : state.cvLayout.map((item) => renderLayoutItem(item)).join("");

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
    scheduleSmartLayout();

    if (options.flashItemId) {
      window.requestAnimationFrame(() => flashSection(options.flashItemId));
    }
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

  function getDefaultExportBaseName() {
    if (state.personalInfo.name) {
      return `${state.personalInfo.name.replace(/\s+/g, "_")}_CV`;
    }
    return "My_CV";
  }

  function getExportDensityLabel() {
    const readout = document.getElementById("densityGaugeReadout")?.textContent?.trim();
    if (readout && readout !== "manual" && readout !== "—" && readout !== "overflows") {
      return readout;
    }

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
    const activeView = window.AchieveMateViews?.getActiveView?.() || "logbook";

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
      if (typeof html2pdf === "undefined") {
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

      const authed = await window.AchieveMateAuth?.requireAuth({ reason: "export" });
      if (authed) {
        openExportModal();
      }
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

    window.AchieveMateSync?.insertExportHistory(fileName, snapshot)?.then((serverId) => {
      if (serverId && entry.id !== serverId) {
        entry.id = serverId;
        saveState({ skipSync: true });
      }
    });
  }

  function deleteExportHistoryEntry(entryId) {
    state.exportHistory = state.exportHistory.filter((item) => item.id !== entryId);
    saveState();
    renderExportHistory();
    window.AchieveMateSync?.deleteExportHistory(entryId);
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

    captureEditsFromDom();
    if (getLayoutStyles().autoFit === true) {
      applySmartLayout();
    } else {
      applyLayoutStyles();
    }
    await waitForLayout();

    const { exportNode, wrapper } = createExportNode();
    await waitForLayout();

    const snapshot = buildHistorySnapshot();

    try {
      await html2pdf()
        .set({
          margin: 0,
          filename: fileName,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            backgroundColor: "#ffffff",
            scrollX: 0,
            scrollY: 0,
          },
          jsPDF: {
            unit: "in",
            format: "a4",
            orientation: "portrait",
          },
          pagebreak: { mode: ["css", "legacy"] },
        })
        .from(exportNode)
        .save();

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
      removeExportNode(wrapper);
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
  bindHistoryPopover();
  bindPreviewZoomControls();
  bindDocumentDragDrop();
  bindPreviewPointerInteraction();
  scheduleFitPreview();

  window.AchieveMateCvPreview = {
    render: renderPreview,
    applyLayoutStyles,
    scheduleSmartLayout,
    fitPreviewToScreen,
    scheduleFitPreview,
    setUserZoom,
    hideInsertionLine,
    renderExportHistory,
  };
})();
