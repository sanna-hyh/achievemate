(function initAchieveMatePdf(root) {
  const WIN_ANSI_REPLACEMENTS = {
    "\u2018": "'",
    "\u2019": "'",
    "\u201A": "'",
    "\u201C": '"',
    "\u201D": '"',
    "\u201E": '"',
    "\u2013": "-",
    "\u2014": "-",
    "\u2026": "...",
    "\u00A0": " ",
    "\u2022": "\u2022",
    "\u00B7": "\u00B7",
    "\u202F": " ",
    "\u200B": "",
    "\uFEFF": "",
  };

  function pdfFontName(family) {
    const value = String(family || "").toLowerCase();
    if (value.includes("courier") || value.includes("mono")) {
      return "courier";
    }
    if (
      value.includes("arial") ||
      value.includes("calibri") ||
      value.includes("helvetica") ||
      value.includes("segoe") ||
      value.includes("candara")
    ) {
      return "helvetica";
    }
    return "times";
  }

  function fontStyle(run, forceBold, forceItalic) {
    const bold = Boolean(forceBold || run?.bold);
    const italic = Boolean(forceItalic || run?.italic);
    if (bold && italic) {
      return "bolditalic";
    }
    if (bold) {
      return "bold";
    }
    if (italic) {
      return "italic";
    }
    return "normal";
  }

  const UNICODE_FONT_URLS = {
    normal:
      "https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-tc@5.2.8/chinese-traditional-400-normal.ttf",
    bold:
      "https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-tc@5.2.8/chinese-traditional-700-normal.ttf",
  };
  let unicodeFontPromise = null;

  function sanitizeText(value) {
    let out = "";
    const text = String(value ?? "");
    for (const ch of text) {
      if (Object.prototype.hasOwnProperty.call(WIN_ANSI_REPLACEMENTS, ch)) {
        out += WIN_ANSI_REPLACEMENTS[ch];
        continue;
      }
      const code = ch.codePointAt(0);
      if (code < 32 || code === 127) {
        continue;
      }
      out += ch;
    }
    return out;
  }

  function isWinAnsiChar(ch) {
    if (ch === "\u2022" || ch === "\u00B7") {
      return true;
    }
    const code = ch.codePointAt(0);
    return (code >= 32 && code <= 126) || (code >= 160 && code <= 255);
  }

  function textSegments(value) {
    const cleaned = sanitizeText(value);
    const segments = [];
    let buffer = "";
    let unicode = false;

    const flush = () => {
      if (!buffer) {
        return;
      }
      segments.push({ text: buffer, unicode });
      buffer = "";
    };

    for (const ch of cleaned) {
      const nextUnicode = !isWinAnsiChar(ch);
      if (buffer && nextUnicode !== unicode) {
        flush();
      }
      unicode = nextUnicode;
      buffer += ch;
    }
    flush();
    return segments;
  }

  function modelNeedsUnicode(model) {
    const chunks = [];
    const pushLines = (lines) => {
      (lines || []).forEach((line) => {
        (line || []).forEach((run) => chunks.push(run?.text || ""));
      });
    };
    pushLines(model?.name);
    pushLines(model?.contact);
    (model?.blocks || []).forEach((block) => {
      pushLines(block.title);
      pushLines(block.subtitle);
      pushLines(block.date);
      pushLines(block.location);
      pushLines(block.bullets);
    });
    if (model?.documentTitle) {
      chunks.push(model.documentTitle);
    }
    return chunks.some((text) => textSegments(text).some((segment) => segment.unicode));
  }

  function arrayBufferToBinary(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return binary;
  }

  function loadUnicodeFonts() {
    if (!unicodeFontPromise) {
      unicodeFontPromise = Promise.all(
        ["normal", "bold"].map(async (style) => {
          const response = await fetch(UNICODE_FONT_URLS[style]);
          if (!response.ok) {
            throw new Error("Unicode font failed to load");
          }
          return arrayBufferToBinary(await response.arrayBuffer());
        })
      )
        .then(([normal, bold]) => ({ normal, bold }))
        .catch((error) => {
          unicodeFontPromise = null;
          throw error;
        });
    }
    return unicodeFontPromise;
  }

  function lineHasText(line) {
    return Array.isArray(line) && line.some((run) => String(run?.text || "").trim());
  }

  function finitePt(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function positivePt(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function createPdfDocument() {
    const JsPDF = root.jspdf?.jsPDF;
    if (!JsPDF) {
      throw new Error("jsPDF failed to load");
    }

    return new JsPDF({
      unit: "pt",
      format: "a4",
      orientation: "portrait",
      compress: true,
      putOnlyUsedFonts: true,
    });
  }

  function renderCvPdf(doc, model, unicodeFont) {
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = Math.max(36, Number(model.marginPt) || 54);
    const contentWidth = Math.max(72, pageWidth - margin * 2);
    const bottom = pageHeight - margin;

    const font = pdfFontName(model.fontFamily);
    if (unicodeFont) {
      doc.addFileToVFS("NotoSansTC-Regular.ttf", unicodeFont.normal);
      doc.addFont("NotoSansTC-Regular.ttf", "NotoSansTC", "normal");
      doc.addFileToVFS("NotoSansTC-Bold.ttf", unicodeFont.bold);
      doc.addFont("NotoSansTC-Bold.ttf", "NotoSansTC", "bold");
    }
    const textColor = model.textColor || [0, 0, 0];
    const accentColor = model.accentColor || [0, 0, 0];
    const bodySize = positivePt(model.bodyPt, 11);
    const titleSize = positivePt(model.titlePt, bodySize);
    const nameSize = positivePt(model.namePt, 20);
    const headingSize = positivePt(model.headingPt, 13);
    const lineHeight = positivePt(model.lineHeight, 1.3);
    const sectionGap = finitePt(model.sectionGapPt, 9);
    const sectionMargin = finitePt(model.sectionMarginPt, sectionGap);
    const itemGap = finitePt(model.itemGapPt, 3);
    const divider = ["solid", "dotted", "none"].includes(model.headingDivider)
      ? model.headingDivider
      : "solid";

    let y = margin;
    let headerDrawn = false;
    let blockDrawn = false;

    function setFill(color) {
      doc.setTextColor(color[0], color[1], color[2]);
    }

    function faceFor(style, unicode) {
      if (unicode) {
        if (!unicodeFont) {
          return null;
        }
        const bold = style === "bold" || style === "bolditalic";
        return { family: "NotoSansTC", style: bold ? "bold" : "normal" };
      }
      return { family: font, style: style || "normal" };
    }

    function measure(text, size, style) {
      let width = 0;
      textSegments(text).forEach((segment) => {
        const face = faceFor(style, segment.unicode);
        if (!face) {
          width += Array.from(segment.text).length * size;
          return;
        }
        doc.setFont(face.family, face.style);
        doc.setFontSize(size);
        width += doc.getTextWidth(segment.text);
      });
      return width;
    }

    function ensureSpace(height) {
      if (y + height <= bottom + 0.25) {
        return;
      }
      if (y <= margin + 0.25) {
        return;
      }
      doc.addPage();
      y = margin;
      blockDrawn = false;
    }

    function drawRuns(runs, x, baseline, size, color, forceBold, forceItalic) {
      setFill(color);
      let cursor = x;
      runs.forEach((run) => {
        const style = fontStyle(run, forceBold, forceItalic);
        const segments = textSegments(run.text);
        if (segments.length === 0) {
          return;
        }
        const start = cursor;
        segments.forEach((segment) => {
          const face = faceFor(style, segment.unicode);
          if (!face) {
            return;
          }
          doc.setFont(face.family, face.style);
          doc.setFontSize(size);
          doc.text(segment.text, cursor, baseline);
          cursor += doc.getTextWidth(segment.text);
        });
        const width = cursor - start;
        if (run.underline && width > 0) {
          doc.setDrawColor(color[0], color[1], color[2]);
          doc.setLineWidth(0.4);
          doc.setLineDashPattern([], 0);
          doc.line(start, baseline + 1.15, start + width, baseline + 1.15);
        }
      });
      return cursor - x;
    }

    function runWidth(run, size, forceBold, forceItalic) {
      const text = sanitizeText(run.text);
      if (!text) {
        return 0;
      }
      return measure(text, size, fontStyle(run, forceBold, forceItalic));
    }

    function tokenize(line) {
      const tokens = [];
      (line || []).forEach((run) => {
        const text = sanitizeText(run.text);
        if (!text) {
          return;
        }
        text.split(/(\s+)/).forEach((part) => {
          if (part) {
            tokens.push({ ...run, text: part });
          }
        });
      });
      return tokens;
    }

    function wrapLine(line, maxWidth, size, forceBold, forceItalic) {
      const widthLimit = Math.max(24, maxWidth);
      const tokens = tokenize(line);
      const lines = [];
      let current = [];
      let width = 0;

      const pushCurrent = () => {
        if (current.length === 0) {
          return;
        }
        lines.push(current);
        current = [];
        width = 0;
      };

      const appendPiece = (run) => {
        const pieceWidth = runWidth(run, size, forceBold, forceItalic);
        const isSpace = !run.text.trim();
        if (isSpace && current.length === 0) {
          return;
        }
        if (width + pieceWidth > widthLimit && current.length > 0 && !isSpace) {
          pushCurrent();
        }
        if (!isSpace && pieceWidth > widthLimit) {
          let buffer = "";
          for (const ch of run.text) {
            const next = buffer + ch;
            const nextWidth = runWidth({ ...run, text: next }, size, forceBold, forceItalic);
            if (nextWidth > widthLimit && buffer) {
              appendPiece({ ...run, text: buffer });
              buffer = ch;
            } else {
              buffer = next;
            }
          }
          if (buffer) {
            const bufferWidth = runWidth({ ...run, text: buffer }, size, forceBold, forceItalic);
            if (width + bufferWidth > widthLimit && current.length > 0) {
              pushCurrent();
            }
            current.push({ ...run, text: buffer });
            width += bufferWidth;
          }
          return;
        }
        current.push(run);
        width += pieceWidth;
      };

      tokens.forEach(appendPiece);
      pushCurrent();
      return lines.length > 0 ? lines : [];
    }

    function lineBox(size, leading) {
      return size * (leading || lineHeight);
    }

    function drawWrapped(lines, x, maxWidth, size, color, options = {}) {
      const leading = options.leading || lineHeight;
      const box = lineBox(size, leading);
      let drawn = 0;
      lines.forEach((sourceLine) => {
        const wrapped = wrapLine(sourceLine, maxWidth, size, options.bold, options.italic);
        wrapped.forEach((line) => {
          ensureSpace(box);
          const baseline = y + size;
          const lineWidth = line.reduce(
            (sum, run) => sum + runWidth(run, size, options.bold, options.italic),
            0
          );
          let startX = x;
          if (options.align === "center") {
            startX = margin + (contentWidth - lineWidth) / 2;
          } else if (options.align === "right") {
            startX = margin + contentWidth - lineWidth;
          }
          drawRuns(line, startX, baseline, size, color, options.bold, options.italic);
          y += box;
          drawn += 1;
        });
      });
      return drawn;
    }

    function pairWidth(lines, maxWidth, size, forceBold, forceItalic) {
      let widest = 0;
      lines.forEach((line) => {
        wrapLine(line, maxWidth, size, forceBold, forceItalic).forEach((wrapped) => {
          const width = wrapped.reduce(
            (sum, run) => sum + runWidth(run, size, forceBold, forceItalic),
            0
          );
          widest = Math.max(widest, width);
        });
      });
      return Math.min(maxWidth, widest);
    }

    function drawSplitRow(leftLines, rightLines, leftSize, rightSize, leftColor, rightColor) {
      const usableRight = rightLines.filter(lineHasText);
      const usableLeft = leftLines.filter(lineHasText);
      if (usableLeft.length === 0 && usableRight.length === 0) {
        return;
      }

      const columnGap = 10;
      const rightMax = contentWidth * 0.42;
      const rightWidth = usableRight.length
        ? pairWidth(usableRight, rightMax, rightSize, false, true)
        : 0;
      const leftMax = usableRight.length
        ? Math.max(48, contentWidth - rightWidth - columnGap)
        : contentWidth;
      const rowSize = Math.max(leftSize, rightSize);
      const box = lineBox(rowSize, lineHeight);
      const leftWrapped = [];
      usableLeft.forEach((line) => {
        wrapLine(line, leftMax, leftSize, true, false).forEach((wrapped) => leftWrapped.push(wrapped));
      });
      const rightWrapped = [];
      usableRight.forEach((line) => {
        wrapLine(line, Math.max(rightWidth, 24), rightSize, false, true).forEach((wrapped) =>
          rightWrapped.push(wrapped)
        );
      });

      const rowCount = Math.max(leftWrapped.length, rightWrapped.length, 1);
      for (let index = 0; index < rowCount; index += 1) {
        ensureSpace(box);
        const baseline = y + rowSize;
        if (leftWrapped[index]) {
          drawRuns(leftWrapped[index], margin, baseline, leftSize, leftColor, true, false);
        }
        if (rightWrapped[index]) {
          const width = rightWrapped[index].reduce(
            (sum, run) => sum + runWidth(run, rightSize, false, true),
            0
          );
          drawRuns(
            rightWrapped[index],
            margin + contentWidth - width,
            baseline,
            rightSize,
            rightColor,
            false,
            true
          );
        }
        y += box;
      }
    }

    function drawBullets(bullets) {
      const bullet = "\u2022 ";
      const bulletWidth = measure(bullet, bodySize, "normal");
      const textWidth = Math.max(48, contentWidth - bulletWidth);
      const box = lineBox(bodySize, lineHeight);
      bullets.filter(lineHasText).forEach((line, bulletIndex) => {
        if (bulletIndex > 0 && itemGap > 0) {
          y += Math.min(itemGap, 4);
        }
        const wrapped = wrapLine(line, textWidth, bodySize, false, false);
        wrapped.forEach((wrappedLine, lineIndex) => {
          ensureSpace(box);
          const baseline = y + bodySize;
          if (lineIndex === 0) {
            drawRuns(
              [{ text: bullet, bold: false, italic: false, underline: false }],
              margin,
              baseline,
              bodySize,
              textColor,
              false,
              false
            );
          }
          drawRuns(wrappedLine, margin + bulletWidth, baseline, bodySize, textColor, false, false);
          y += box;
        });
      });
    }

    function uppercaseLine(line) {
      return line.map((run) => ({ ...run, text: String(run.text || "").toUpperCase() }));
    }

    function gapBefore(block) {
      let gap = 0;
      if (headerDrawn || blockDrawn) {
        gap += sectionGap;
      }
      if (block.kind === "heading" && (headerDrawn || blockDrawn)) {
        gap += sectionMargin * 0.35;
      }
      return gap;
    }

    function drawHeading(block) {
      const lines = (block.title || []).filter(lineHasText).map(uppercaseLine);
      if (lines.length === 0) {
        return;
      }
      const box = headingSize * 1.25;
      const padBottom = Math.max(2, sectionMargin * 0.2);
      drawWrapped(lines, margin, contentWidth, headingSize, accentColor, {
        bold: true,
        leading: 1.25,
      });
      y += Math.max(0, padBottom - (box - headingSize));
      if (divider !== "none") {
        ensureSpace(6);
        doc.setDrawColor(accentColor[0], accentColor[1], accentColor[2]);
        doc.setLineWidth(0.8);
        if (divider === "dotted") {
          doc.setLineDashPattern([1, 1.6], 0);
        } else {
          doc.setLineDashPattern([], 0);
        }
        doc.line(margin, y, margin + contentWidth, y);
        doc.setLineDashPattern([], 0);
        y += 4;
      }
      y += Math.max(2, sectionMargin * 0.15);
    }

    function drawEntry(block) {
      const title = (block.title || []).filter(lineHasText);
      const date = (block.date || []).filter(lineHasText);
      const subtitle = (block.subtitle || []).filter(lineHasText);

      if (block.kind === "cv-item") {
        if (title.length) {
          drawWrapped(title, margin, contentWidth, titleSize, accentColor, { bold: true });
        }
        if (subtitle.length || date.length) {
          if (title.length) {
            y += Math.max(1, sectionMargin * 0.08);
          }
          drawSplitRow(subtitle, date, titleSize, bodySize, accentColor, textColor);
        }
      } else if (title.length || date.length) {
        drawSplitRow(title, date, titleSize, bodySize, accentColor, textColor);
      }

      const location = (block.location || []).filter(lineHasText);
      if (location.length) {
        y += Math.max(1, sectionMargin * 0.12);
        drawWrapped(location, margin, contentWidth, bodySize, textColor);
      }

      const bullets = (block.bullets || []).filter(lineHasText);
      if (bullets.length) {
        y += Math.max(2, sectionMargin * 0.2);
        drawBullets(bullets);
      }
    }

    function drawHeader(lines, size, color, options) {
      const usable = (lines || []).filter(lineHasText);
      if (usable.length === 0) {
        return false;
      }
      drawWrapped(usable, margin, contentWidth, size, color, options);
      return true;
    }

    const drewName = drawHeader(model.name, nameSize, accentColor, {
      bold: true,
      align: "center",
      leading: 1.15,
    });
    if (drewName) {
      y += Math.max(1, sectionMargin * 0.15);
      headerDrawn = true;
    }
    const drewContact = drawHeader(model.contact, bodySize, textColor, {
      align: "center",
      leading: lineHeight,
    });
    if (drewContact) {
      headerDrawn = true;
    }

    function blockHasContent(block) {
      const groups =
        block?.kind === "heading"
          ? [block.title]
          : [block?.title, block?.subtitle, block?.date, block?.location, block?.bullets];
      return groups.some((group) => (group || []).some(lineHasText));
    }

    (model.blocks || []).filter(blockHasContent).forEach((block) => {
      const gap = gapBefore(block);
      const probe =
        block.kind === "heading" ? headingSize * 1.25 + bodySize * lineHeight : bodySize * lineHeight;
      if (gap > 0 && y + gap + probe > bottom && y > margin + 0.25) {
        doc.addPage();
        y = margin;
      } else {
        y += gap;
      }

      if (block.kind === "heading") {
        drawHeading(block);
      } else {
        drawEntry(block);
      }
      blockDrawn = true;
    });

    if (model.documentTitle) {
      const latinTitle = textSegments(model.documentTitle)
        .filter((segment) => !segment.unicode)
        .map((segment) => segment.text)
        .join("")
        .trim();
      doc.setProperties({
        title: latinTitle.slice(0, 120) || "CV",
        creator: "AchieveMate",
      });
    }
  }

  const fitByDoc = new WeakMap();

  function countCvPdfPages(model, unicodeFont) {
    const doc = createPdfDocument();
    renderCvPdf(doc, model, unicodeFont || null);
    return doc.getNumberOfPages();
  }

  function roundPt(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function scaleFittedModel(model, scale, mode) {
    const factor = Math.round(scale * 10000) / 10000;
    const next = {
      ...model,
      bodyPt: roundPt(model.bodyPt * factor),
      titlePt: roundPt(model.titlePt * factor),
      sectionGapPt: roundPt(model.sectionGapPt * factor),
      sectionMarginPt: roundPt(model.sectionMarginPt * factor),
      itemGapPt: roundPt(model.itemGapPt * factor),
      fitScale: factor,
      fitChanged: factor < 0.999,
      fitOverflow: false,
    };

    if (mode === "all") {
      next.namePt = roundPt(model.namePt * factor);
      next.headingPt = roundPt(model.headingPt * factor);
      next.marginPt = roundPt(Math.max(28, (Number(model.marginPt) || 54) * (0.7 + 0.3 * factor)));
    }

    return next;
  }

  function shrinkPdfModelToOnePage(model, options = {}) {
    const unicodeFont = options.unicodeFont || null;
    const alsoFits = typeof options.alsoFits === "function" ? options.alsoFits : null;
    const minScale = 0.08;

    const fits = (candidate) => {
      if (countCvPdfPages(candidate, unicodeFont) > 1) {
        return false;
      }
      if (alsoFits && !alsoFits(candidate)) {
        return false;
      }
      return true;
    };

    const search = (base, mode) => {
      if (fits(base)) {
        return { ...base, fitScale: 1, fitChanged: false, fitOverflow: false };
      }

      const smallest = scaleFittedModel(base, minScale, mode);
      if (!fits(smallest)) {
        return { ...smallest, fitChanged: true, fitOverflow: true };
      }

      let low = minScale;
      let high = 1;
      let best = minScale;
      for (let step = 0; step < 12; step += 1) {
        const mid = (low + high) / 2;
        if (fits(scaleFittedModel(base, mid, mode))) {
          best = mid;
          low = mid;
        } else {
          high = mid;
        }
      }

      return scaleFittedModel(base, best, mode);
    };

    const bodyFit = search(model, "body");
    if (!bodyFit.fitOverflow) {
      return bodyFit;
    }
    return search(model, "all");
  }

  async function createCvPdf(model) {
    let unicodeFont = null;
    if (modelNeedsUnicode(model)) {
      try {
        unicodeFont = await loadUnicodeFonts();
      } catch (error) {
        console.warn("Unicode font failed to load; non-Latin characters were omitted.", error);
      }
    }

    const paintModel = model?.autoFit
      ? shrinkPdfModelToOnePage(model, { unicodeFont })
      : model;
    const doc = createPdfDocument();
    renderCvPdf(doc, paintModel, unicodeFont);
    fitByDoc.set(doc, paintModel);
    return doc;
  }

  function getCvPdfFit(doc) {
    return fitByDoc.get(doc) || null;
  }

  root.AchieveMatePdf = {
    createCvPdf,
    countCvPdfPages,
    shrinkPdfModelToOnePage,
    getCvPdfFit,
    pdfFontName,
    sanitizeText,
  };
})(typeof window !== "undefined" ? window : globalThis);
