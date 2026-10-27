import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = createRequire(new URL("../../video/package.json", import.meta.url))(
  "playwright",
);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "public", "img", "turn");
const base = process.argv[2] ?? "https://ttesite1ff906.z14.web.core.windows.net";
const shots = [
  { file: "yourcall.webp", query: "?play=yourcall", ready: readyYourCall },
  { file: "eyes.webp", query: "?play=eyes", ready: readyEyes },
  { file: "drill.webp", query: "?play=drill", ready: readyDrill, align: "bottom" },
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--hide-scrollbars"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  await page.addInitScript(() => localStorage.setItem("tte.captionStory.v1", "0"));
  for (const shot of shots) {
    const url = new URL(shot.query, base.endsWith("/") ? base : `${base}/`);
    await page.goto(url.href, { waitUntil: "networkidle", timeout: 120000 });
    const region = await shot.ready(page);
    await region.scrollIntoViewIfNeeded();
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const png = await region.screenshot({ type: "png", animations: "disabled", timeout: 120000 });
    const webp = await asWebp(page, png, shot.align);
    if (webp.length >= 120 * 1024)
      throw new Error(`${shot.file}: ${webp.length} bytes is too large`);
    const target = path.join(out, shot.file);
    await writeFile(target, webp);
    console.log(`${path.relative(root, target)} ${webp.length} bytes`);
  }
} finally {
  await browser.close();
}

async function readyYourCall(page) {
  await page.locator(".yc-view:not(.drawing)").waitFor({ timeout: 120000 });
  const above = page.locator('.yc-slot.main[data-view="above"]');
  return (await above.count()) ? above : page.locator(".yc-canvas");
}

/** The board where the viewer picks when and where he looks, his view cone on it: the card shows
 * the choice, the other two cards the view from above and his eyes. */
async function readyEyes(page) {
  await page.getByRole("button", { name: "Look", exact: true }).waitFor({ timeout: 120000 });
  return page.locator(".te-view .te-slot.main");
}

async function readyDrill(page) {
  await page.locator(".dr-view.step-ready .dr-dial").waitFor({ timeout: 120000 });
  return page.locator(".dr-view.step-ready .dr-stage");
}

async function asWebp(page, png, align) {
  const encoded = await page.evaluate(
    async ({ source, align }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${source}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 960;
      canvas.height = 540;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No canvas encoder");
      const scale = Math.max(canvas.width / image.width, canvas.height / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      const y = align === "bottom" ? canvas.height - height : (canvas.height - height) / 2;
      context.drawImage(image, (canvas.width - width) / 2, y, width, height);
      return canvas.toDataURL("image/webp", 0.82).split(",")[1];
    },
    { source: png.toString("base64"), align },
  );
  return Buffer.from(encoded, "base64");
}
