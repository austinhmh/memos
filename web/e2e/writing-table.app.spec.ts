import { expect, test, type Page } from "@playwright/test";

const editorSelector = ".blog-editor .ProseMirror[contenteditable='true']";
const tableCellSelector = `${editorSelector} table tbody tr:nth-child(2) td:first-child`;
const modifierKey = process.platform === "darwin" ? "Meta" : "Control";

const registerHostUser = async (page: Page) => {
  await page.goto("/");
  await page.waitForURL(/\/auth\/signup/);
  await page.getByPlaceholder(/username/i).fill("austin");
  await page.getByPlaceholder(/password/i).fill("Austin123");
  await page.getByRole("button", { name: /sign up/i }).click();
  await page.waitForURL("/");
  await expect(page.locator("#header-blog")).toBeVisible();
};

const selectNodeContents = async (page: Page, selector: string) => {
  await page.locator(selector).evaluate((node) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(node);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
};

const saveEditor = async (page: Page) => {
  await page.keyboard.press(`${modifierKey}+S`);
  await expect(page.locator(".blog-editor-status")).toContainText("自动保存");
};

test.describe("Writing table real app end-to-end behavior", () => {
  test("keeps bookmark UI text out of edited table content and readonly public blog output", async ({ browser, page }) => {
    await registerHostUser(page);

    await page.goto("/writing");
    await page.getByRole("button", { name: "New Article" }).click();
    await page.waitForURL(/\/writing\//);

    const writingPath = new URL(page.url()).pathname;
    const blogPath = writingPath.replace("/writing/", "/blog/");
    const editor = page.locator(editorSelector);
    await expect(editor).toBeVisible();

    await editor.click();
    await page.keyboard.press(`${modifierKey}+A`);
    await page.evaluate(() => navigator.clipboard.writeText("# 表格端到端测试\n\n#blog\n\n| File | Note |\n|---|---|\n| Seed | Ready |\n\nhttps://docs.nvidia.com/example.pdf"));
    await page.keyboard.press(`${modifierKey}+V`);
    await saveEditor(page);

    await expect(page.locator(tableCellSelector)).toBeVisible();
    await expect(editor).toContainText("编辑链接");

    await page.locator(tableCellSelector).click();
    await selectNodeContents(page, `${tableCellSelector} p`);
    await page.keyboard.type("直输");
    await saveEditor(page);

    await selectNodeContents(page, `${tableCellSelector} p`);
    await page.evaluate(() => navigator.clipboard.writeText("粘贴"));
    await page.keyboard.press(`${modifierKey}+V`);
    await saveEditor(page);

    await page.getByRole("button", { name: /private/i }).click();
    await page.getByRole("menuitem", { name: /public/i }).click();
    await expect(page.getByRole("button", { name: /public/i })).toBeVisible();

    const readonlyContext = await browser.newContext();
    const readonlyPage = await readonlyContext.newPage();
    await readonlyPage.goto(blogPath);

    const readonlyOutput = readonlyPage.locator(".blog-editor-content.ProseMirror");
    await expect(readonlyOutput.locator("table")).toBeVisible();
    await expect(readonlyOutput.locator("td").first()).toHaveText("粘贴");
    await expect(readonlyOutput).not.toContainText("编辑链接");
    await expect(readonlyOutput).not.toContainText("编辑连接");
    await expect(readonlyOutput).not.toContainText("粘贴编辑");

    await readonlyContext.close();
  });
});
