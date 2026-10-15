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
    if (value.includes("calibri")) {
      return "Carlito";
    }
    if (
      value.includes("arial") ||
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

  const CARLITO_FONT_URLS = {
    normal: "fonts/Carlito-Regular.ttf",
    bold: "fonts/Carlito-Bold.ttf",
    italic: "fonts/Carlito-Italic.ttf",
    bolditalic: "fonts/Carlito-BoldItalic.ttf",
  };
  const CARLITO_FONT_FILES = {
    normal: "Carlito-Regular.ttf",
    bold: "Carlito-Bold.ttf",
    italic: "Carlito-Italic.ttf",
    bolditalic: "Carlito-BoldItalic.ttf",
  };
  let carlitoFontPromise = null;

  function isBuiltinPdfFont(name) {
    const value = String(name || "").toLowerCase();
    return value === "helvetica" || value === "times" || value === "courier";
  }

  function sanitizeText(value, fontName) {
    const applyWinAnsi = fontName == null || isBuiltinPdfFont(fontName);
    let out = "";
    const text = String(value ?? "");
    for (const ch of text) {
      if (Object.prototype.hasOwnProperty.call(WIN_ANSI_REPLACEMENTS, ch)) {
        const replacement = WIN_ANSI_REPLACEMENTS[ch];
        if (applyWinAnsi || replacement === "") {
          out += replacement;
          continue;
        }
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

  function isBaseFontChar(ch, fontName) {
    if (isWinAnsiChar(ch)) {
      return true;
    }
    if (!fontName || isBuiltinPdfFont(fontName)) {
      return false;
    }
    return (
      Object.prototype.hasOwnProperty.call(WIN_ANSI_REPLACEMENTS, ch) &&
      WIN_ANSI_REPLACEMENTS[ch] !== ""
    );
  }

  function textSegments(value, fontName) {
    const cleaned = sanitizeText(value, fontName);
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
      const nextUnicode = !isBaseFontChar(ch, fontName);
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
      (block.skills || []).forEach((skill) => chunks.push(String(skill || "")));
    });
    if (model?.documentTitle) {
      chunks.push(model.documentTitle);
    }
    const fontName = pdfFontName(model?.fontFamily);
    return chunks.some((text) => textSegments(text, fontName).some((segment) => segment.unicode));
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

  function loadCarlitoFonts() {
    if (!carlitoFontPromise) {
      carlitoFontPromise = Promise.all(
        ["normal", "bold", "italic", "bolditalic"].map(async (style) => {
          const response = await fetch(CARLITO_FONT_URLS[style]);
          if (!response.ok) {
            throw new Error("Carlito font failed to load");
          }
          return arrayBufferToBinary(await response.arrayBuffer());
        })
      )
        .then(([normal, bold, italic, bolditalic]) => ({ normal, bold, italic, bolditalic }))
        .catch((error) => {
          carlitoFontPromise = null;
          throw error;
        });
    }
    return carlitoFontPromise;
  }

  function lineHasText(line) {
    return Array.isArray(line) && line.some((run) => String(run?.text || "").trim());
  }

  const LINK_FILE_EXT = new Set(
    "js jsx mjs cjs ts tsx css scss less json md py rb go rs java c cpp h hpp cs php html htm xml yml yaml svg png jpg jpeg gif webp pdf zip gz tar mp3 mp4 wav txt csv ttf woff woff2 map sh vue svelte lock".split(
      " "
    )
  );
  const LINK_WEB_TLD = new Set(
    "com net org io dev app me co ai xyz page site design studio work tech info edu gov uk tw hk jp de fr ca au nz sg kr cn us eu nl se ch in tv cc pro jobs cv link live cloud online store blog portfolio".split(
      " "
    )
  );
  const LINK_MULTI_SUFFIX = new Set(
    "co.uk org.uk ac.uk com.tw com.hk com.sg com.au co.jp com.cn co.nz com.br co.kr com.my co.in".split(" ")
  );

  function trimLinkEnd(text, start, end) {
    const trailing = /[),.;:!?\]>'"，。、；：！？）】》」』]/;
    while (end > start && trailing.test(text.charAt(end - 1))) {
      if (text.charAt(end - 1) === ")") {
        const slice = text.slice(start, end);
        const open = (slice.match(/\(/g) || []).length;
        const close = (slice.match(/\)/g) || []).length;
        if (close <= open) {
          break;
        }
      }
      end -= 1;
    }
    return end;
  }

  function bareUrlOk(raw) {
    const slash = raw.indexOf("/");
    const host = slash === -1 ? raw : raw.slice(0, slash);
    if (!host || /[^A-Za-z0-9.-]/.test(host)) {
      return false;
    }
    const labels = host.split(".");
    if (
      labels.length < 2 ||
      labels.some((label) => !label || label.length > 63 || !/^[A-Za-z0-9-]+$/.test(label))
    ) {
      return false;
    }
    const lower = labels.map((label) => label.toLowerCase());
    const tld = lower[lower.length - 1];
    if (!/^[a-z]{2,24}$/.test(tld)) {
      return false;
    }
    if (LINK_FILE_EXT.has(tld) && !LINK_WEB_TLD.has(tld)) {
      return false;
    }
    const lastTwo = lower.slice(-2).join(".");
    const suffixCount = LINK_MULTI_SUFFIX.has(lastTwo) ? 2 : 1;
    if (lower.length <= suffixCount) {
      return false;
    }
    const name = lower[lower.length - suffixCount - 1];
    if (name.length < 3) {
      return false;
    }
    if (suffixCount === 2) {
      return true;
    }
    return LINK_WEB_TLD.has(tld) || slash !== -1;
  }

  function linkSpans(text) {
    const spans = [];
    const occupied = (start, end) => spans.some((span) => start < span.end && end > span.start);
    const push = (start, end, url) => {
      if (!(end > start) || !url || occupied(start, end)) {
        return;
      }
      spans.push({ start, end, url });
    };
    const source = String(text || "");
    const body = "[^\\s<>\"'`|，。、；：！？）】》」』]+";

    for (const match of source.matchAll(new RegExp("(?:https?:\\/\\/|www\\.)" + body, "gi"))) {
      const end = trimLinkEnd(source, match.index, match.index + match[0].length);
      const raw = source.slice(match.index, end);
      if (!raw || /^www\.?$/i.test(raw) || /^https?:\/\/$/i.test(raw)) {
        continue;
      }
      const url = /^https?:\/\//i.test(raw) ? raw.replace(/^https?:\/\//i, (scheme) => scheme.toLowerCase()) : "https://" + raw;
      push(match.index, end, url);
    }

    for (const match of source.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
      const end = trimLinkEnd(source, match.index, match.index + match[0].length);
      const raw = source.slice(match.index, end);
      const tld = raw.split(".").pop().toLowerCase();
      if (!raw.includes("@") || !tld || LINK_FILE_EXT.has(tld)) {
        continue;
      }
      push(match.index, end, "mailto:" + raw);
    }

    for (const match of source.matchAll(
      new RegExp(
        "\\b(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z]{2,24}(?:\\/" + body + ")?",
        "g"
      )
    )) {
      const end = trimLinkEnd(source, match.index, match.index + match[0].length);
      const raw = source.slice(match.index, end);
      if (!bareUrlOk(raw)) {
        continue;
      }
      push(match.index, end, "https://" + raw);
    }

    spans.sort((a, b) => a.start - b.start);
    return spans;
  }

  function sliceLinkedRun(run, start, end) {
    const text = run.text.slice(start, end);
    if (!Array.isArray(run.links) || run.links.length === 0) {
      return { ...run, text };
    }
    const links = [];
    run.links.forEach((link) => {
      const from = Math.max(link.start, start);
      const to = Math.min(link.end, end);
      if (to > from) {
        links.push({ start: from - start, end: to - start, url: link.url });
      }
    });
    return { ...run, text, links };
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

  function renderCvPdf(doc, model, unicodeFont, carlitoFont) {
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = Math.max(36, Number(model.marginPt) || 54);
    const contentWidth = Math.max(72, pageWidth - margin * 2);
    const bottom = pageHeight - margin;
    const breakSlack = 2;

    let font = pdfFontName(model.fontFamily);
    if (unicodeFont) {
      doc.addFileToVFS("NotoSansTC-Regular.ttf", unicodeFont.normal);
      doc.addFont("NotoSansTC-Regular.ttf", "NotoSansTC", "normal");
      doc.addFileToVFS("NotoSansTC-Bold.ttf", unicodeFont.bold);
      doc.addFont("NotoSansTC-Bold.ttf", "NotoSansTC", "bold");
    }
    if (font === "Carlito") {
      if (carlitoFont) {
        ["normal", "bold", "italic", "bolditalic"].forEach((style) => {
          const filename = CARLITO_FONT_FILES[style];
          doc.addFileToVFS(filename, carlitoFont[style]);
          doc.addFont(filename, "Carlito", style);
        });
      } else {
        font = "helvetica";
      }
    }
    const textColor = model.textColor || [0, 0, 0];
    const accentColor = model.accentColor || [0, 0, 0];
    const bodySize = positivePt(model.bodyPt, 11);
    const titleSize = positivePt(model.titlePt, bodySize);
    const nameSize = positivePt(model.namePt, 20);
    const headingSize = positivePt(model.headingPt, 13);
    const template = ["classic", "modern", "compact"].includes(model.template)
      ? model.template
      : "classic";
    const modernCobalt = [30, 77, 140];
    const modernGold = [196, 161, 90];
    const accentIsInk = accentColor[0] <= 8 && accentColor[1] <= 8 && accentColor[2] <= 8;
    const lineHeight = positivePt(model.lineHeight, 1.3);
    const sectionGap = finitePt(model.sectionGapPt, 9);
    const sectionMargin = finitePt(model.sectionMarginPt, sectionGap);
    const itemGap = finitePt(model.itemGapPt, 3);
    const nameDrawSize = nameSize;
    let nameInk = accentColor;
    let headingInk = accentColor;
    if (template === "modern") {
      headingInk = accentIsInk ? modernCobalt : accentColor;
    }
    const divider = ["solid", "dotted", "none"].includes(model.headingDivider)
      ? model.headingDivider
      : "solid";
    const underlineLinks = model.underlineLinks !== false;

    let y = margin;
    let headerDrawn = false;
    let blockDrawn = false;
    let previousKind = "";
    let geometryPin = false;
    const linePin = { tops: null, index: 0, blockTop: 0 };

    function takePinnedTop() {
      if (!geometryPin || !Array.isArray(linePin.tops) || linePin.index >= linePin.tops.length) {
        return null;
      }
      const top = linePin.blockTop + linePin.tops[linePin.index];
      linePin.index += 1;
      return top;
    }

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
      textSegments(text, font).forEach((segment) => {
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
      if (geometryPin) {
        return;
      }
      if (y + height <= bottom + breakSlack) {
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
        const segments = textSegments(run.text, font);
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
        const text = sanitizeText(run.text, font);
        const links = run.href
          ? [{ start: 0, end: text.length, url: run.href }]
          : Array.isArray(run.links)
            ? run.links
            : linkSpans(text);
        annotateLinks(text, links, start, baseline, size, style);
      });
      return cursor - x;
    }

    function drawnWidth(text, size, style) {
      let width = 0;
      textSegments(text, font).forEach((segment) => {
        const face = faceFor(style, segment.unicode);
        if (!face) {
          return;
        }
        doc.setFont(face.family, face.style);
        doc.setFontSize(size);
        width += doc.getTextWidth(segment.text);
      });
      return width;
    }

    function annotateLinks(text, links, originX, baseline, size, style) {
      if (!links || links.length === 0) {
        return;
      }
      const factor = typeof doc.getLineHeightFactor === "function" ? doc.getLineHeightFactor() : 1.15;
      const descent = size * (factor - 1);
      const top = baseline - (size - descent);
      links.forEach((link) => {
        const start = Math.max(0, Number(link.start) || 0);
        const end = Math.min(text.length, Number(link.end) || 0);
        if (end <= start || !link.url) {
          return;
        }
        const x = originX + drawnWidth(text.slice(0, start), size, style);
        const width = drawnWidth(text.slice(start, end), size, style);
        if (width > 0) {
          doc.link(x, top, width, size, { url: link.url });
          if (underlineLinks) {
            // #475569 at 70% on white — same cue as the preview underline.
            doc.setDrawColor(126, 136, 150);
            doc.setLineWidth(0.75);
            doc.setLineDashPattern([], 0);
            const underlineY = baseline + size * 0.15;
            doc.line(x, underlineY, x + width, underlineY);
          }
        }
      });
    }

    function runWidth(run, size, forceBold, forceItalic) {
      const text = sanitizeText(run.text, font);
      if (!text) {
        return 0;
      }
      return measure(text, size, fontStyle(run, forceBold, forceItalic));
    }

    function tokenize(line) {
      const tokens = [];
      (line || []).forEach((run) => {
        const text = sanitizeText(run.text, font);
        if (!text) {
          return;
        }
        text.split(/(\s+)/).forEach((part) => {
          if (!part) {
            return;
          }
          const token = { ...run, text: part };
          const links = linkSpans(part);
          if (links.length) {
            token.links = links;
          }
          tokens.push(token);
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
          let bufferStart = 0;
          for (const ch of run.text) {
            const next = buffer + ch;
            const nextWidth = runWidth({ ...run, text: next }, size, forceBold, forceItalic);
            if (nextWidth > widthLimit && buffer) {
              appendPiece(sliceLinkedRun(run, bufferStart, bufferStart + buffer.length));
              bufferStart += buffer.length;
              buffer = ch;
            } else {
              buffer = next;
            }
          }
          if (buffer) {
            const piece = sliceLinkedRun(run, bufferStart, bufferStart + buffer.length);
            const bufferWidth = runWidth(piece, size, forceBold, forceItalic);
            if (width + bufferWidth > widthLimit && current.length > 0) {
              pushCurrent();
            }
            current.push(piece);
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
          const pinnedTop = takePinnedTop();
          if (pinnedTop == null) {
            ensureSpace(box);
          }
          const lineTop = pinnedTop == null ? y : pinnedTop;
          const baseline = lineTop + size;
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
          y = lineTop + box;
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
        const pinnedTop = takePinnedTop();
        if (pinnedTop == null) {
          ensureSpace(box);
        }
        const lineTop = pinnedTop == null ? y : pinnedTop;
        const baseline = lineTop + rowSize;
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
        y = lineTop + box;
      }
    }

    function drawBullets(bullets) {
      const bullet = "\u2022 ";
      // Preview list margin is 1.1rem. Export px→pt is ×0.75 (1rem = 16px = 12pt).
      const indent = 1.1 * 16 * 0.75;
      const bulletWidth = measure(bullet, bodySize, "normal");
      const textWidth = Math.max(48, contentWidth - indent);
      const box = lineBox(bodySize, lineHeight);
      bullets.filter(lineHasText).forEach((line) => {
        const wrapped = wrapLine(line, textWidth, bodySize, false, false);
        wrapped.forEach((wrappedLine, lineIndex) => {
          const pinnedTop = takePinnedTop();
          if (pinnedTop == null) {
            ensureSpace(box);
          }
          const lineTop = pinnedTop == null ? y : pinnedTop;
          const baseline = lineTop + bodySize;
          if (lineIndex === 0) {
            drawRuns(
              [{ text: bullet, bold: false, italic: false, underline: false }],
              margin + Math.max(0, indent - bulletWidth),
              baseline,
              bodySize,
              textColor,
              false,
              false
            );
          }
          drawRuns(wrappedLine, margin + indent, baseline, bodySize, textColor, false, false);
          y = lineTop + box;
        });
      });
    }

    function uppercaseLine(line) {
      return line.map((run) => ({ ...run, text: String(run.text || "").toUpperCase() }));
    }

    function isEntryKind(kind) {
      return kind === "cv-item" || kind === "achievement" || kind === "skills";
    }

    function gapBefore(block) {
      if (!(headerDrawn || blockDrawn)) {
        return 0;
      }
      // Consecutive entries: flex gap + (itemGap - sectionGap) margin = item gap.
      if (isEntryKind(previousKind) && isEntryKind(block.kind)) {
        return itemGap;
      }
      let gap = sectionGap;
      if (block.kind === "heading") {
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
      const padBottom = sectionMargin * 0.25;
      drawWrapped(lines, margin, contentWidth, headingSize, headingInk, {
        bold: true,
        leading: 1.25,
      });
      if (geometryPin && Number.isFinite(Number(block.dividerFromTopPt))) {
        const dividerY = linePin.blockTop + Number(block.dividerFromTopPt);
        if (divider !== "none") {
          doc.setDrawColor(headingInk[0], headingInk[1], headingInk[2]);
          doc.setLineWidth(0.8);
          if (divider === "dotted") {
            doc.setLineDashPattern([1, 1.6], 0);
          } else {
            doc.setLineDashPattern([], 0);
          }
          doc.line(margin, dividerY, margin + contentWidth, dividerY);
          doc.setLineDashPattern([], 0);
        }
        y = dividerY;
        return;
      }
      y += Math.max(0, padBottom - (box - headingSize));
      if (divider !== "none") {
        ensureSpace(6);
        doc.setDrawColor(headingInk[0], headingInk[1], headingInk[2]);
        doc.setLineWidth(0.8);
        if (divider === "dotted") {
          doc.setLineDashPattern([1, 1.6], 0);
        } else {
          doc.setLineDashPattern([], 0);
        }
        doc.line(margin, y, margin + contentWidth, y);
        doc.setLineDashPattern([], 0);
        y += sectionMargin * 0.4;
      } else {
        y += sectionMargin * 0.15;
      }
    }

    function drawEntry(block) {
      if (block.kind === "skills") {
        const title = (block.title || []).filter(lineHasText);
        if (title.length) {
          drawHeading(
            geometryPin ? { title, dividerFromTopPt: block.dividerFromTopPt } : { title }
          );
        }
        const skills = (block.skills || []).map((skill) => String(skill || "").trim()).filter(Boolean);
        if (!skills.length) {
          return;
        }
        if (geometryPin && Number.isFinite(Number(block.skillsTopPt))) {
          y = linePin.blockTop + Number(block.skillsTopPt);
        } else if (title.length) {
          y += sectionMargin * 0.12;
        }
        const skillLine = [
          {
            text: skills.join(" · "),
            bold: false,
            italic: false,
            underline: false,
          },
        ];
        drawWrapped([skillLine], margin, contentWidth, bodySize, textColor, { leading: lineHeight });
        return;
      }

      const title = (block.title || []).filter(lineHasText);
      const date = (block.date || []).filter(lineHasText);
      const subtitle = (block.subtitle || []).filter(lineHasText);

      if (block.kind === "cv-item") {
        if (title.length || date.length) {
          drawSplitRow(title, date, titleSize, bodySize, textColor, textColor);
        }
        if (subtitle.length) {
          if (title.length || date.length) {
            y += sectionMargin * 0.08;
          }
          drawWrapped(subtitle, margin, contentWidth, titleSize, textColor, { bold: true });
        }
      } else if (title.length || date.length) {
        drawSplitRow(title, date, titleSize, bodySize, textColor, textColor);
      }

      const location = (block.location || []).filter(lineHasText);
      if (location.length) {
        y += sectionMargin * 0.12;
        drawWrapped(location, margin, contentWidth, bodySize, textColor);
      }

      const bullets = (block.bullets || []).filter(lineHasText);
      if (bullets.length) {
        y += sectionMargin * 0.25;
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

    const drewName = drawHeader(model.name, nameDrawSize, nameInk, {
      bold: true,
      align: "center",
      leading: template === "modern" ? 1.05 : 1.15,
    });
    if (drewName) {
      y += sectionMargin * 0.15;
      headerDrawn = true;
    }
    const drewContact = drawHeader(model.contact, bodySize, textColor, {
      align: "center",
      leading: lineHeight,
    });
    if (drewContact) {
      headerDrawn = true;
    }
    if (template === "modern" && (drewName || drewContact)) {
      y += 3.5;
      ensureSpace(5);
      doc.setDrawColor(modernGold[0], modernGold[1], modernGold[2]);
      doc.setLineWidth(1.15);
      doc.setLineDashPattern([], 0);
      doc.line(margin, y, margin + contentWidth, y);
      y += 5;
    }

    function blockHasContent(block) {
      if (block?.kind === "skills") {
        return (
          (block.skills || []).some((skill) => String(skill || "").trim()) ||
          (block.title || []).some(lineHasText)
        );
      }
      const groups =
        block?.kind === "heading"
          ? [block.title]
          : [block?.title, block?.subtitle, block?.date, block?.location, block?.bullets];
      return groups.some((group) => (group || []).some(lineHasText));
    }

    function countWrappedRows(lines, maxWidth, size, bold, italic) {
      let count = 0;
      (lines || [])
        .filter(lineHasText)
        .forEach((line) => {
          count += wrapLine(line, maxWidth, size, bold, italic).length;
        });
      return count;
    }

    function countHeadingPaintRows(titleLines) {
      const lines = (titleLines || []).filter(lineHasText).map(uppercaseLine);
      return countWrappedRows(lines, contentWidth, headingSize, true, false);
    }

    function countSplitPaintRows(leftLines, rightLines, leftSize, rightSize) {
      const usableRight = (rightLines || []).filter(lineHasText);
      const usableLeft = (leftLines || []).filter(lineHasText);
      if (usableLeft.length === 0 && usableRight.length === 0) {
        return 0;
      }
      const columnGap = 10;
      const rightMax = contentWidth * 0.42;
      const rightWidth = usableRight.length
        ? pairWidth(usableRight, rightMax, rightSize, false, true)
        : 0;
      const leftMax = usableRight.length
        ? Math.max(48, contentWidth - rightWidth - columnGap)
        : contentWidth;
      let leftCount = 0;
      usableLeft.forEach((line) => {
        leftCount += wrapLine(line, leftMax, leftSize, true, false).length;
      });
      let rightCount = 0;
      usableRight.forEach((line) => {
        rightCount += wrapLine(line, Math.max(rightWidth, 24), rightSize, false, true).length;
      });
      return Math.max(leftCount, rightCount, 1);
    }

    function countBlockPaintRows(block) {
      if (block.kind === "heading" || block.kind === "skills") {
        return countHeadingPaintRows(block.title);
      }
      const title = (block.title || []).filter(lineHasText);
      const date = (block.date || []).filter(lineHasText);
      const subtitle = (block.subtitle || []).filter(lineHasText);
      const location = (block.location || []).filter(lineHasText);
      const bullets = (block.bullets || []).filter(lineHasText);
      let count = 0;
      if (block.kind === "cv-item") {
        if (title.length || date.length) {
          count += countSplitPaintRows(title, date, titleSize, bodySize);
        }
        if (subtitle.length) {
          count += countWrappedRows(subtitle, contentWidth, titleSize, true, false);
        }
      } else if (title.length || date.length) {
        count += countSplitPaintRows(title, date, titleSize, bodySize);
      }
      if (location.length) {
        count += countWrappedRows(location, contentWidth, bodySize, false, false);
      }
      if (bullets.length) {
        const textWidth = Math.max(48, contentWidth - 1.1 * 16 * 0.75);
        count += countWrappedRows(bullets, textWidth, bodySize, false, false);
      }
      return count;
    }

    function skillsPaintFits(block) {
      const skills = (block.skills || []).map((skill) => String(skill || "").trim()).filter(Boolean);
      if (!skills.length) {
        return true;
      }
      const skillLine = [{ text: skills.join(" · "), bold: false, italic: false, underline: false }];
      const rows = wrapLine(skillLine, contentWidth, bodySize, false, false).length;
      const title = (block.title || []).filter(lineHasText);
      let start = Number(block.skillsTopPt);
      if (!Number.isFinite(start)) {
        start = (Number(block.dividerFromTopPt) || 0) + (title.length ? sectionMargin * 0.12 : 0);
      }
      return start + rows * lineBox(bodySize, lineHeight) <= block.heightPt + breakSlack;
    }

    function pinnedRowsMatch(block) {
      const tops = block.lineTopsPt;
      if (!Array.isArray(tops) || tops.some((value) => !Number.isFinite(value))) {
        return false;
      }
      if (tops.some((value) => value < -8 || value > block.heightPt + 8)) {
        return false;
      }
      const painted = countBlockPaintRows(block);
      if (painted !== tops.length) {
        return false;
      }
      if (block.kind === "skills") {
        return skillsPaintFits(block);
      }
      return true;
    }

    function resolvePreviewGeometry(blocks) {
      if (!blocks.length || model.previewGeometry !== true || model.fitChanged) {
        return null;
      }
      const fitScale = Number(model.fitScale);
      if (Number.isFinite(fitScale) && fitScale < 1) {
        return null;
      }
      const bodyTopPt = Number(model.geometryBodyTopPt);
      if (!Number.isFinite(bodyTopPt)) {
        return null;
      }

      for (let index = 0; index < blocks.length; index += 1) {
        const block = blocks[index];
        if (!Number.isFinite(block.topPt) || !(block.heightPt > 0) || block.heightPt > pageHeight) {
          return null;
        }
        if (index > 0 && block.topPt + 0.75 < blocks[index - 1].topPt) {
          return null;
        }
        if (!pinnedRowsMatch(block)) {
          return null;
        }
      }

      const positions = [];
      let relocated = false;
      for (let index = 0; index < blocks.length; index += 1) {
        const block = blocks[index];
        const absTop = bodyTopPt + block.topPt;
        if (absTop < -1) {
          return null;
        }
        let page = Math.floor(absTop / pageHeight);
        let yOnPage = absTop - page * pageHeight;
        if (absTop + block.heightPt > (page + 1) * pageHeight + breakSlack) {
          page += 1;
          yOnPage = margin;
          relocated = true;
        }
        positions.push({ page, y: yOnPage });
      }

      for (let index = 0; index < blocks.length - 1; index += 1) {
        const block = blocks[index];
        if (block.kind !== "heading" || positions[index].page >= positions[index + 1].page) {
          continue;
        }
        const next = blocks[index + 1];
        const nextPos = positions[index + 1];
        const gap = next.topPt - block.topPt - block.heightPt;
        const safeGap = Number.isFinite(gap) ? Math.max(0, gap) : 0;
        let headingY = nextPos.y - safeGap - block.heightPt;
        if (headingY < margin) {
          const shift = margin - headingY;
          headingY = margin;
          for (let follow = index + 1; follow < positions.length; follow += 1) {
            if (positions[follow].page !== nextPos.page) {
              continue;
            }
            positions[follow].y += shift;
          }
        }
        positions[index].page = nextPos.page;
        positions[index].y = headingY;
        relocated = true;
      }

      if (relocated) {
        for (let index = 0; index < positions.length; index += 1) {
          const top = positions[index].y;
          const blockBottom = top + blocks[index].heightPt;
          if (!(top >= -0.5) || blockBottom > pageHeight + breakSlack) {
            return null;
          }
        }
        for (let index = 0; index < positions.length; index += 1) {
          for (let other = index + 1; other < positions.length; other += 1) {
            if (positions[index].page !== positions[other].page) {
              continue;
            }
            const aTop = positions[index].y;
            const aBottom = aTop + blocks[index].heightPt;
            const bTop = positions[other].y;
            const bBottom = bTop + blocks[other].heightPt;
            if (aTop < bBottom - 0.75 && bTop < aBottom - 0.75) {
              return null;
            }
          }
        }
      }

      return positions;
    }

    const contentBlocks = (model.blocks || []).filter(blockHasContent);
    let geometryPositions = resolvePreviewGeometry(contentBlocks);
    if (geometryPositions?.[0]?.page === 0 && geometryPositions[0].y + 0.75 < y) {
      geometryPositions = null;
    }
    if (geometryPositions) {
      geometryPin = true;
      contentBlocks.forEach((block, index) => {
        const pos = geometryPositions[index];
        while (doc.getNumberOfPages() < pos.page + 1) {
          doc.addPage();
        }
        doc.setPage(pos.page + 1);
        const pageOffset = margin + block.topPt - pos.y;
        y = margin + block.topPt - pageOffset;
        linePin.blockTop = y;
        linePin.tops = block.lineTopsPt;
        linePin.index = 0;
        if (block.kind === "heading") {
          drawHeading(block);
        } else {
          drawEntry(block);
        }
        previousKind = block.kind;
        blockDrawn = true;
      });
      geometryPin = false;
      linePin.tops = null;
    } else {
      contentBlocks.forEach((block, index) => {
        const gap = gapBefore(block);
        let probe = bodySize * lineHeight;
        if (block.kind === "heading") {
          const headingBox = headingSize * 1.25;
          const padBottom = sectionMargin * 0.25;
          const spacingAfterHeading =
            Math.max(0, padBottom - (headingBox - headingSize)) +
            sectionMargin * (divider === "none" ? 0.15 : 0.4);
          const next = contentBlocks[index + 1];
          let nextGap = 0;
          if (next) {
            nextGap = sectionGap;
            if (next.kind === "heading") {
              nextGap += sectionMargin * 0.35;
            }
          }
          probe = headingBox + spacingAfterHeading + nextGap + bodySize * lineHeight;
        }
        if (gap > 0 && y + gap + probe > bottom + breakSlack && y > margin + 0.25) {
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
        previousKind = block.kind;
        blockDrawn = true;
      });
    }

    if (model.documentTitle) {
      const latinTitle = textSegments(model.documentTitle, font)
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

  function countCvPdfPages(model, unicodeFont, carlitoFont) {
    const doc = createPdfDocument();
    renderCvPdf(doc, model, unicodeFont || null, carlitoFont || null);
    return doc.getNumberOfPages();
  }

  function roundPt(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function getMinBodyPt() {
    return Number(window.AchieveMateApp?.CV_TYPOGRAPHY?.minBodyPt) || 10;
  }

  function scaleFittedModel(model, scale, mode) {
    const factor = Math.round(scale * 10000) / 10000;
    const minBodyPt = getMinBodyPt();
    const next = {
      ...model,
      bodyPt: roundPt(Math.max(minBodyPt, model.bodyPt * factor)),
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
    const carlitoFont = options.carlitoFont || null;
    const alsoFits = typeof options.alsoFits === "function" ? options.alsoFits : null;
    const minBodyPt = getMinBodyPt();
    const baseBody = Math.max(Number(model.bodyPt) || minBodyPt, minBodyPt);
    // Never shrink body below the shared 10pt floor.
    const minScale = Math.min(1, minBodyPt / baseBody);

    const fits = (candidate) => {
      if (countCvPdfPages(candidate, unicodeFont, carlitoFont) > 1) {
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
        // At the hard floor and still overflowing — allow multi-page PDF.
        return { ...smallest, fitChanged: minScale < 0.999, fitOverflow: true };
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

    let carlitoFont = null;
    if (pdfFontName(model.fontFamily) === "Carlito") {
      carlitoFont = await loadCarlitoFonts();
    }

    const paintModel = model?.autoFit
      ? shrinkPdfModelToOnePage(model, { unicodeFont, carlitoFont })
      : model;
    const doc = createPdfDocument();
    renderCvPdf(doc, paintModel, unicodeFont, carlitoFont);
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
