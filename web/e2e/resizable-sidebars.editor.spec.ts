import { expect, test } from "@playwright/test";

test.describe("Resizable sidebars", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/__e2e__/resizable-sidebars");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByTestId("left-panel")).toBeVisible();
    await expect(page.getByTestId("right-panel")).toBeVisible();
  });

  test("resizes left and right sidebars and keeps the sizes after reload", async ({ page }) => {
    const leftPanel = page.getByTestId("left-panel");
    const rightPanel = page.getByTestId("right-panel");
    const leftHandle = page.getByTestId("left-resize-handle");
    const rightHandle = page.getByTestId("right-resize-handle");

    const initialLeftWidth = await leftPanel.evaluate((element) => element.getBoundingClientRect().width);
    const initialRightWidth = await rightPanel.evaluate((element) => element.getBoundingClientRect().width);

    const leftHandleBox = await leftHandle.boundingBox();
    expect(leftHandleBox).not.toBeNull();
    await page.mouse.move(leftHandleBox!.x + leftHandleBox!.width / 2, leftHandleBox!.y + leftHandleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(leftHandleBox!.x + 160, leftHandleBox!.y + leftHandleBox!.height / 2, { steps: 5 });
    await page.mouse.up();

    await expect.poll(() => leftPanel.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(initialLeftWidth + 80);

    const rightHandleBox = await rightHandle.boundingBox();
    expect(rightHandleBox).not.toBeNull();
    await page.mouse.move(rightHandleBox!.x + rightHandleBox!.width / 2, rightHandleBox!.y + rightHandleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(rightHandleBox!.x - 140, rightHandleBox!.y + rightHandleBox!.height / 2, { steps: 5 });
    await page.mouse.up();

    await expect
      .poll(() => rightPanel.evaluate((element) => element.getBoundingClientRect().width))
      .toBeGreaterThan(initialRightWidth + 80);

    const resizedLeftWidth = await leftPanel.evaluate((element) => element.getBoundingClientRect().width);
    const resizedRightWidth = await rightPanel.evaluate((element) => element.getBoundingClientRect().width);

    await page.reload();
    await expect(page.getByTestId("left-panel")).toBeVisible();

    await expect
      .poll(() => page.getByTestId("left-panel").evaluate((element) => element.getBoundingClientRect().width))
      .toBeCloseTo(resizedLeftWidth, 0);
    await expect
      .poll(() => page.getByTestId("right-panel").evaluate((element) => element.getBoundingClientRect().width))
      .toBeCloseTo(resizedRightWidth, 0);
  });
});
