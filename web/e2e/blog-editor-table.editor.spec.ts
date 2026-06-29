import { expect, test } from "@playwright/test";

const editorSelector = ".blog-editor .ProseMirror[contenteditable='true']";
const tableCellSelector = `${editorSelector} table tbody tr:nth-child(2) td:first-child`;
const headingSelector = `${editorSelector} h1`;
const modifierKey = process.platform === "darwin" ? "Meta" : "Control";

const saveEditor = async (page: import("@playwright/test").Page) => {
  await page.keyboard.press(`${modifierKey}+S`);
};

const selectNodeContents = async (page: import("@playwright/test").Page, selector: string) => {
  await page.locator(selector).evaluate((node) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(node);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
};

const placeCaretAtStart = async (page: import("@playwright/test").Page, selector: string) => {
  await page.locator(selector).evaluate((node) => {
    const selection = window.getSelection();
    const range = document.createRange();
    const target = node.firstChild ?? node;
    range.setStart(target, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
};

test.describe("BlogEditor table end-to-end behavior", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/__e2e__/blog-editor-table");
    await expect(page.locator(editorSelector)).toBeVisible();
    await expect(page.locator(tableCellSelector)).toBeVisible();
  });

  test("inserts spaces on Tab inside heading text instead of moving focus away", async ({ page }) => {
    const editor = page.locator(editorSelector);
    const heading = page.locator(headingSelector);
    const savedMarkdown = page.getByTestId("saved-markdown");

    await heading.click();
    await placeCaretAtStart(page, headingSelector);
    await page.keyboard.press("Tab");
    await page.keyboard.type("缩进");
    await saveEditor(page);

    await expect(editor).toBeFocused();
    await expect(savedMarkdown).toContainText("#   缩进gcache整体介绍");
  });

  test("keeps non-editable bookmark UI out of table input, saved markdown, and readonly output", async ({ page }) => {
    const firstCell = page.locator(tableCellSelector);

    await firstCell.click();
    await selectNodeContents(page, `${tableCellSelector} p`);
    await page.keyboard.type("直输");
    await saveEditor(page);

    const savedMarkdown = page.getByTestId("saved-markdown");
    await expect(savedMarkdown).toContainText("| 直输 | Ready |");
    await expect(savedMarkdown).not.toContainText("编辑链接");
    await expect(savedMarkdown).not.toContainText("编辑连接");

    const readonlyOutput = page.getByTestId("readonly-output");
    await expect(readonlyOutput.locator("table")).toBeVisible();
    await expect(readonlyOutput.locator("td").first()).toHaveText("直输");
    await expect(readonlyOutput).not.toContainText("编辑链接");
    await expect(readonlyOutput).not.toContainText("编辑连接");

    await selectNodeContents(page, `${tableCellSelector} p`);
    await page.evaluate(() => navigator.clipboard.writeText("粘贴"));
    await page.keyboard.press(`${modifierKey}+V`);
    await saveEditor(page);

    await expect(savedMarkdown).toContainText("| 粘贴 | Ready |");
    await expect(savedMarkdown).not.toContainText("编辑链接");
    await expect(savedMarkdown).not.toContainText("编辑连接");
    await expect(readonlyOutput.locator("table").first()).toBeVisible();
    await expect(readonlyOutput.locator("td").first()).toHaveText("粘贴");
  });

  test("pastes structured clipboard content into a table cell as plain text only", async ({ page }) => {
    const firstCell = page.locator(tableCellSelector);
    const savedMarkdown = page.getByTestId("saved-markdown");
    const readonlyOutput = page.getByTestId("readonly-output");

    await firstCell.click();
    await selectNodeContents(page, `${tableCellSelector} p`);
    await page.evaluate(async () => {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob(["Nested Table A B"], { type: "text/plain" }),
          "text/html": new Blob(["<table><tbody><tr><td>Nested</td><td>Table</td></tr><tr><td>A</td><td>B</td></tr></tbody></table>"], {
            type: "text/html",
          }),
        }),
      ]);
    });
    await page.keyboard.press(`${modifierKey}+V`);
    await saveEditor(page);

    await expect(savedMarkdown).toContainText("Nested Table A B");
    await expect(savedMarkdown).not.toContainText("| Nested | Table |");
    await expect(readonlyOutput.locator("table")).toHaveCount(1);
    await expect(readonlyOutput.locator("td").first()).toHaveText("Nested Table A B");
  });

  test("copies a single table body cell as plain cell content instead of a 1x1 table", async ({ page }) => {
    const firstCell = page.locator(tableCellSelector);

    await firstCell.click();
    await page.keyboard.type("CellOnly");
    await saveEditor(page);

    await selectNodeContents(page, tableCellSelector);
    await page.keyboard.press(`${modifierKey}+C`);

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain("CellOnly");
    expect(clipboardText).not.toContain("| CellOnly |");
    expect(clipboardText).not.toContain("---");
    expect(clipboardText).not.toContain("编辑链接");
    expect(clipboardText).not.toContain("编辑连接");
  });
});
