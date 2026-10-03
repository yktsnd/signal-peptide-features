/* Run with a packaged backend installed and Playwright available. */
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const assert = require("node:assert/strict");

(async () => {
  const folder = await mkdtemp(join(tmpdir(), "sp-explorer-e2e-"));
  const server = spawn(
    process.env.PYTHON || "python",
    [
      "-m",
      "uvicorn",
      "signal_peptide_features.server:app",
      "--host",
      "127.0.0.1",
      "--port",
      "18765",
    ],
    {
      env: { ...process.env, SP_FEATURES_CONFIG: join(folder, "absent.json") },
    },
  );
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        ready = (await fetch("http://127.0.0.1:18765/api/status")).ok;
      } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(ready, "backend did not start");
    browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROMIUM_PATH
        ? { executablePath: process.env.CHROMIUM_PATH }
        : {}),
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:18765");
    await page.getByRole("button", { name: "例を使う（人工配列）" }).click();
    await page.getByRole("button", { name: "解析する", exact: true }).click();
    await page
      .getByRole("heading", { name: "2 配列と物性", exact: true })
      .waitFor();
    await page.locator(".sequence button").nth(18).click();
    assert.match(
      await page.locator(".detail strong").textContent(),
      /19.*D.*\+1/,
    );
    for (const name of ["JSON", "CSV", "HTML", "SVG"]) {
      const pending = page.waitForEvent("download");
      await page.getByRole("button", { name, exact: true }).click();
      const dl = await pending;
      await dl.saveAs(join(folder, name === "HTML" ? "report.html" : name));
    }
    const saved = JSON.parse(await readFile(join(folder, "JSON"), "utf8"));
    assert.equal(saved.analysis.annotations.cleavage.value, 18);
    assert.equal(saved.view.selected, 19);
    const csv = await readFile(join(folder, "CSV"), "utf8");
    assert.match(csv, /boundary_basis/);
    const report = await browser.newPage();
    await report.goto("file://" + join(folder, "report.html"));
    assert.equal(
      await report.locator("tbody tr").count(),
      saved.analysis.metrics.length + 1,
    );
    await report.close();
    const svg = await readFile(join(folder, "SVG"), "utf8");
    assert.match(svg, /xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    await page.getByRole("button", { name: "English", exact: true }).click();
    await page
      .getByRole("heading", { name: "2 Sequence & properties" })
      .waitFor();
    await page.locator(".reopen input").setInputFiles(join(folder, "JSON"));
    assert.match(await page.locator(".detail strong").textContent(), /19.*D/);
    await page.locator(".matrix button").first().click();
    assert(
      (await page.locator("table").nth(1).locator("tbody tr").count()) <
        saved.analysis.metrics.length,
    );
    await page
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    await page
      .getByRole("checkbox", { name: "Show estimated regions" })
      .uncheck();
    assert.equal(
      await page.locator("table").nth(1).locator(".rule_estimate").count(),
      0,
    );
    await page
      .getByRole("checkbox", { name: "Show estimated regions" })
      .check();
    await page.getByRole("button", { name: "日本語", exact: true }).click();
    if (process.env.SCREENSHOT_DIR) {
      await page.screenshot({
        path: join(process.env.SCREENSHOT_DIR, "explorer-desktop.png"),
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    if (process.env.SCREENSHOT_DIR) {
      await page.screenshot({
        path: join(process.env.SCREENSHOT_DIR, "explorer-mobile.png"),
      });
    }
    await page.pdf({ path: join(folder, "report.pdf") });
    assert((await readFile(join(folder, "report.pdf"))).length > 1000);
    assert.deepEqual(errors, []);
    console.log(
      "Browser checks passed: junction linkage, exports, HTML offline, JSON reopen, matrix filters, mobile, PDF.",
    );
  } finally {
    if (browser) await browser.close();
    server.kill();
    await rm(folder, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
