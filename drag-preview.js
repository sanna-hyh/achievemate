(function initDragPreview() {
  const emptyDragImage = new Image();
  emptyDragImage.src =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

  const CV_VARS = [
    "--cv-font-family",
    "--cv-body-font",
    "--cv-header-font",
    "--cv-section-heading-font",
    "--cv-line-height",
    "--cv-section-margin",
    "--cv-item-gap",
    "--cv-section-gap",
    "--cv-accent-color",
    "--cv-text-color",
  ];

  let activePreview = null;
  let dragSource = null;
  let offsetX = 0;
  let offsetY = 0;
  let onSourceDrag = null;
  let onSourceDragEnd = null;

  function getApp() {
    return window.AchieveMateApp;
  }

  function getAchievement(achievementId) {
    const app = getApp();
    return app?.state?.achievements?.find((item) => item.id === achievementId) || null;
  }

  function positionPreview(clientX, clientY) {
    if (!activePreview) {
      return;
    }

    activePreview.style.left = `${clientX - offsetX}px`;
    activePreview.style.top = `${clientY - offsetY}px`;
  }

  function applyCvTypographyVars(shell) {
    const cvPreview = document.getElementById("cvPreview");
    if (!cvPreview) {
      return;
    }

    const computed = getComputedStyle(cvPreview);
    CV_VARS.forEach((name) => {
      const value = computed.getPropertyValue(name);
      if (value) {
        shell.style.setProperty(name, value.trim());
      }
    });

    shell.classList.add("cv-drag-preview-sheet");
    ["cv-heading-divider-dotted", "cv-heading-divider-none"].forEach((className) => {
      if (cvPreview.classList.contains(className)) {
        shell.classList.add(className);
      }
    });

    const wrap = document.getElementById("cvPreviewWrap");
    const scale = Number.parseFloat(wrap?.dataset.previewScale || "1");
    if (Number.isFinite(scale) && scale > 0) {
      shell.style.setProperty("--cv-drag-scale", String(scale));
    }
  }

  function stripEditableAttributes(root) {
    root.querySelectorAll("[contenteditable]").forEach((node) => {
      node.removeAttribute("contenteditable");
    });
    root.querySelectorAll("[data-edit-key]").forEach((node) => {
      node.removeAttribute("data-edit-key");
    });
    root.querySelectorAll("[data-item-id]").forEach((node) => {
      node.removeAttribute("data-item-id");
    });
  }

  function buildHeadingContent(title = "Section Title") {
    const heading = document.createElement("h2");
    heading.className = "cv-preview-section-heading";
    heading.textContent = title;
    return heading;
  }

  function buildCvItemContent() {
    const article = document.createElement("section");
    article.className = "cv-preview-entry cv-preview-cv-item";

    const title = document.createElement("h3");
    title.className = "cv-preview-entry-title cv-preview-cv-item-title";
    title.textContent = "Title";
    article.appendChild(title);

    const subrow = document.createElement("div");
    subrow.className = "cv-preview-cv-item-subrow";

    const subtitle = document.createElement("span");
    subtitle.className = "cv-preview-cv-item-subtitle";
    subtitle.textContent = "Subtitle";

    const date = document.createElement("span");
    date.className = "cv-preview-entry-date cv-preview-cv-item-date";
    date.textContent = "DATE";

    subrow.append(subtitle, date);
    article.appendChild(subrow);

    const location = document.createElement("p");
    location.className = "cv-preview-cv-item-location";
    location.textContent = "Location";
    article.appendChild(location);

    const body = document.createElement("div");
    body.className = "cv-preview-entry-body cv-preview-description cv-preview-cv-item-bullets";
    body.innerHTML = "• Bullet 1<br>• Bullet 2<br>• Bullet 3";
    article.appendChild(body);

    return article;
  }

  function buildAchievementContent(achievement) {
    const app = getApp();
    const article = document.createElement("article");
    article.className = "cv-preview-entry";

    const header = document.createElement("div");
    header.className = "cv-preview-entry-header";

    const title = document.createElement("h3");
    title.className = "cv-preview-entry-title";
    title.textContent = achievement.title?.trim() || "Untitled achievement";

    const date = document.createElement("span");
    date.className = "cv-preview-entry-date";
    date.textContent = achievement.date?.trim() || "Date";

    header.append(title, date);
    article.appendChild(header);

    const showDescription = app?.isAchievementDescriptionVisible?.(achievement);
    const lines = app?.getDescriptionLines?.(achievement.description || "") || [];

    if (showDescription && lines.length > 0) {
      const body = document.createElement("div");
      body.className = "cv-preview-entry-body";
      const list = document.createElement("ul");
      list.className = "cv-preview-bullets";

      lines.forEach((line) => {
        const item = document.createElement("li");
        item.textContent = line;
        list.appendChild(item);
      });

      body.appendChild(list);
      article.appendChild(body);
    }

    return article;
  }

  function createContentShell() {
    const shell = document.createElement("div");
    shell.className = "cv-drag-preview cv-drag-preview-content";
    applyCvTypographyVars(shell);
    return shell;
  }

  function buildRailPreview(sourceEl, payload) {
    const shell = createContentShell();

    if (payload?.type === "achievement" && payload.achievementId) {
      const achievement = getAchievement(payload.achievementId);
      if (achievement) {
        shell.appendChild(buildAchievementContent(achievement));
        return shell;
      }
    }

    if (payload?.type === "heading") {
      shell.appendChild(buildHeadingContent());
      return shell;
    }

    if (payload?.type === "cv-item") {
      shell.appendChild(buildCvItemContent());
      return shell;
    }

    if (sourceEl.dataset.blockType === "cv-item") {
      shell.appendChild(buildCvItemContent());
      return shell;
    }

    if (sourceEl.classList.contains("rail-block-achievement")) {
      const achievementId = sourceEl.dataset.achievementId;
      const achievement = achievementId ? getAchievement(achievementId) : null;
      if (achievement) {
        shell.appendChild(buildAchievementContent(achievement));
        return shell;
      }
    }

    shell.appendChild(buildHeadingContent());
    return shell;
  }

  function buildDocumentPreview(sourceEl) {
    const wrap = sourceEl.closest(".cv-section-wrap");
    const shell = createContentShell();

    const heading = wrap?.querySelector(".cv-preview-section-heading");
    const entry = wrap?.querySelector(".cv-preview-entry");

    if (heading) {
      const clone = heading.cloneNode(true);
      stripEditableAttributes(clone);
      shell.appendChild(clone);
      return shell;
    }

    if (entry) {
      const clone = entry.cloneNode(true);
      stripEditableAttributes(clone);
      shell.appendChild(clone);
      return shell;
    }

    return shell;
  }

  function cleanup() {
    if (dragSource && onSourceDrag) {
      dragSource.removeEventListener("drag", onSourceDrag);
    }
    if (dragSource && onSourceDragEnd) {
      dragSource.removeEventListener("dragend", onSourceDragEnd);
    }

    activePreview?.remove();
    activePreview = null;
    dragSource = null;
    onSourceDrag = null;
    onSourceDragEnd = null;
    document.body.classList.remove("is-cv-dragging");
  }

  function mountPreview(sourceEl, { variant = "rail", payload = null, clientX, clientY, offsetX: offsetOverride, offsetY: offsetOverrideY } = {}) {
    activePreview =
      variant === "document"
        ? buildDocumentPreview(sourceEl)
        : buildRailPreview(sourceEl, payload);
    document.body.appendChild(activePreview);

    if (offsetOverride != null && offsetOverrideY != null) {
      offsetX = offsetOverride;
      offsetY = offsetOverrideY;
    } else if (variant === "document") {
      offsetX = 24;
      offsetY = 14;
    } else {
      const sourceRect = sourceEl.getBoundingClientRect();
      offsetX = clientX - sourceRect.left;
      offsetY = clientY - sourceRect.top;
    }

    positionPreview(clientX, clientY);
    window.requestAnimationFrame(() => activePreview?.classList.add("is-active"));
    document.body.classList.add("is-cv-dragging");
  }

  function begin(event, sourceEl, { variant = "rail", payload = null } = {}) {
    if (!sourceEl || !event.dataTransfer) {
      return;
    }

    cleanup();

    mountPreview(sourceEl, {
      variant,
      payload,
      clientX: event.clientX,
      clientY: event.clientY,
    });

    event.dataTransfer.setDragImage(emptyDragImage, 0, 0);

    dragSource = sourceEl;
    onSourceDrag = (dragEvent) => {
      if (dragEvent.clientX === 0 && dragEvent.clientY === 0) {
        return;
      }
      positionPreview(dragEvent.clientX, dragEvent.clientY);
    };
    onSourceDragEnd = () => {
      cleanup();
    };

    dragSource.addEventListener("drag", onSourceDrag);
    dragSource.addEventListener("dragend", onSourceDragEnd);
  }

  function beginPointer(sourceEl, { variant = "document", clientX, clientY, offsetX: ox = 24, offsetY: oy = 14 } = {}) {
    if (!sourceEl) {
      return;
    }

    cleanup();
    mountPreview(sourceEl, {
      variant,
      clientX,
      clientY,
      offsetX: ox,
      offsetY: oy,
    });
  }

  function movePointer(clientX, clientY) {
    positionPreview(clientX, clientY);
  }

  window.AchieveMateDragPreview = {
    begin,
    beginPointer,
    movePointer,
    end: cleanup,
  };
})();
