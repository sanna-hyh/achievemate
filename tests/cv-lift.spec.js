import { test, expect } from "@playwright/test";

const TITLES = ["Alpha Role", "Bravo Role", "Charlie Role", "Delta Role"];

// Product thresholds in cv-preview.js: fine hold 200ms, touch hold 300ms.
// Bin lid/color transition is 120ms once the pointer is over #cvLiftBin.
const DESKTOP_HOLD_MS = 260;
const TOUCH_HOLD_MS = 360;
const BIN_ARM_MS = 140;

function seedData() {
  const cvLayout = TITLES.map((title, index) => ({
    id: `cv-item-${index + 1}`,
    type: "cv-item",
    title,
    subtitle: `Org ${index + 1}`,
    date: `202${index}`,
    location: "Remote",
    description: `Shipped ${title}`,
  }));
  const items = {};
  cvLayout.forEach((item) => {
    items[item.id] = {
      title: item.title,
      subtitle: item.subtitle,
      date: item.date,
      location: item.location,
      description: item.description,
    };
  });

  return {
    personalInfo: { name: "Ada Lovelace", phone: "555-0100", email: "ada@example.com" },
    achievements: [],
    cvLibrary: [],
    cvLayout,
    cvPreviewEdits: { personal: {}, items },
    exportHistory: [],
  };
}

function isTouchProject(testInfo) {
  return testInfo.project.name === "iphone-13";
}

function holdMs(testInfo) {
  return isTouchProject(testInfo) ? TOUCH_HOLD_MS : DESKTOP_HOLD_MS;
}

async function sectionTitles(page) {
  return page.locator(".cv-preview-body > .cv-section-wrap .cv-preview-entry-title").allInnerTexts();
}

async function cardPoint(page, index) {
  const title = page
    .locator(".cv-preview-body > .cv-section-wrap")
    .nth(index)
    .locator(".cv-preview-entry-title");
  await title.scrollIntoViewIfNeeded();
  const box = await title.boundingBox();
  if (!box) {
    throw new Error(`CV card ${index} has no box`);
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dispatchPointer(page, type, x, y) {
  await page.evaluate(
    ({ type, x, y }) => {
      const init = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        pointerId: 1,
        pointerType: "touch",
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        isPrimary: true,
        pressure: type === "pointerup" ? 0 : 0.5,
      };
      const event = new PointerEvent(type, init);
      if (type === "pointerdown") {
        const target = document.elementFromPoint(x, y);
        if (!target) {
          throw new Error(`no hit target at ${x},${y}`);
        }
        target.dispatchEvent(event);
        return;
      }
      document.documentElement.dispatchEvent(event);
    },
    { type, x, y }
  );
}

async function pointerDown(page, point, touch) {
  if (!touch) {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    return;
  }
  await dispatchPointer(page, "pointerdown", point.x, point.y);
}

async function pointerMove(page, point, touch) {
  if (!touch) {
    await page.mouse.move(point.x, point.y);
    return;
  }
  await dispatchPointer(page, "pointermove", point.x, point.y);
}

async function pointerUp(page, point, touch) {
  if (!touch) {
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
    return;
  }
  await dispatchPointer(page, "pointerup", point.x, point.y);
}

async function dragPointer(page, from, to, touch) {
  const steps = 8;
  for (let step = 1; step <= steps; step += 1) {
    const point = {
      x: from.x + ((to.x - from.x) * step) / steps,
      y: from.y + ((to.y - from.y) * step) / steps,
    };
    await pointerMove(page, point, touch);
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((data) => {
    localStorage.setItem("achievemate-data", JSON.stringify(data));
  }, seedData());
  await page.route(/fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com/, (route) => route.abort());
  await page.goto("/");
  await expect(page.locator(".cv-preview-body > .cv-section-wrap")).toHaveCount(4);
  await expect.poll(() => sectionTitles(page)).toEqual(TITLES);
});

test("hold lifts a CV card and shows the bin", async ({ page }, testInfo) => {
  const touch = isTouchProject(testInfo);
  const start = await cardPoint(page, 0);

  await pointerDown(page, start, touch);
  await page.waitForTimeout(touch ? 120 : 80);
  await expect(page.locator("#cvLiftFloat")).toHaveCount(0);

  await page.waitForTimeout(holdMs(testInfo) - (touch ? 120 : 80));
  await expect(page.locator("#cvLiftFloat")).toBeVisible();
  await expect(page.locator(".cv-section-wrap.is-lifted")).toHaveCount(1);
  await expect(page.locator("#cvLiftBin.cv-lift-bin")).toBeVisible();
  await expect(page.locator("#cvLiftBin")).toHaveClass(/is-shown/);
  await expect(page.locator("#cvLiftBin")).not.toHaveClass(/is-hot/);

  await pointerUp(page, start, touch);
  await expect(page.locator("#cvLiftFloat")).toHaveCount(0);
  await expect(page.locator(".cv-section-wrap.is-lifted")).toHaveCount(0);
  expect(await sectionTitles(page)).toEqual(TITLES);
});

test("drag reorders a lifted CV card", async ({ page }, testInfo) => {
  const touch = isTouchProject(testInfo);
  const from = await cardPoint(page, 2);
  const lastBox = await page.locator(".cv-preview-body > .cv-section-wrap").nth(3).boundingBox();
  if (!lastBox) {
    throw new Error("missing drop target");
  }
  // Lower half of the last card — short phone rows still resolve past the midpoint.
  const drop = { x: lastBox.x + lastBox.width / 2, y: lastBox.y + lastBox.height - 2 };

  await pointerDown(page, from, touch);
  await page.waitForTimeout(holdMs(testInfo));
  await expect(page.locator("#cvLiftFloat")).toBeVisible();

  await dragPointer(page, from, drop, touch);
  await pointerUp(page, drop, touch);

  await expect(page.locator("#cvLiftFloat")).toHaveCount(0);
  expect(await sectionTitles(page)).toEqual(["Alpha Role", "Bravo Role", "Delta Role", "Charlie Role"]);
});

test("bin arms near the trash, gulps the card, and Undo restores it", async ({ page }, testInfo) => {
  const touch = isTouchProject(testInfo);
  const from = await cardPoint(page, 1);

  await pointerDown(page, from, touch);
  await page.waitForTimeout(holdMs(testInfo));
  await expect(page.locator("#cvLiftBin")).toHaveClass(/is-shown/);

  const bin = await page.locator("#cvLiftBin").boundingBox();
  if (!bin) {
    throw new Error("lift bin has no box");
  }
  const overBin = { x: bin.x + bin.width / 2, y: bin.y + bin.height / 2 };

  await dragPointer(page, from, overBin, touch);
  await page.waitForTimeout(BIN_ARM_MS);
  await expect(page.locator("#cvLiftBin")).toHaveClass(/is-hot/);
  await expect(page.locator("#cvLiftBin")).toHaveClass(/is-open/);

  await pointerUp(page, overBin, touch);

  await expect(page.locator("#cvLiftFloat .cv-lift-float")).toHaveAttribute(
    "style",
    /transform:\s*scale\(0\.12\)/
  );

  const toast = page.locator(".toast", { hasText: "Removed from CV" });
  await expect(toast).toBeVisible();
  await expect(page.locator(".cv-preview-entry-title", { hasText: "Bravo Role" })).toHaveCount(0);
  expect(await sectionTitles(page)).toEqual(["Alpha Role", "Charlie Role", "Delta Role"]);

  await toast.locator(".toast-action", { hasText: "Undo" }).click();
  await expect(page.locator(".cv-preview-entry-title", { hasText: "Bravo Role" })).toBeVisible();
  expect(await sectionTitles(page)).toEqual(TITLES);
});

test("iPhone reorder bar moves the selected card up and down", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "iphone-13", "mobile reorder bar is only on the iPhone 13 project");

  const bravo = page.locator(".cv-preview-body > .cv-section-wrap").nth(1);
  await bravo.locator(".cv-preview-entry-title").click();

  const bar = page.locator("#cvMobileReorder");
  await expect(bar).toBeVisible();
  await expect(page.locator("#cvMobileMoveUp")).toBeEnabled();
  await expect(page.locator("#cvMobileMoveDown")).toBeEnabled();
  await expect(bravo).toHaveClass(/is-mobile-reorder-target/);

  await page.locator("#cvMobileMoveUp").click();
  expect(await sectionTitles(page)).toEqual(["Bravo Role", "Alpha Role", "Charlie Role", "Delta Role"]);
  await expect(page.locator("#cvMobileMoveUp")).toBeDisabled();
  await expect(page.locator("#cvMobileMoveDown")).toBeEnabled();

  await page.locator("#cvMobileMoveDown").click();
  expect(await sectionTitles(page)).toEqual(TITLES);
  await expect(page.locator("#cvMobileMoveUp")).toBeEnabled();
  await expect(page.locator("#cvMobileMoveDown")).toBeEnabled();
});
