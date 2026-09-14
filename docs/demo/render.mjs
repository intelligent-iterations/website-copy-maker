// Compose annotated documentation figures around unmodified evaluation PNGs.
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { PNG } from "pngjs";

const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const image = async (file) =>
  `data:image/png;base64,${(await fs.readFile(file)).toString("base64")}`;
const styles = `
*{box-sizing:border-box}body{margin:0;background:#f2efe7;color:#262a24;font-family:Arial,sans-serif}
.board{width:1440px;padding:48px}.kicker{font-size:15px;letter-spacing:2px;font-weight:700;color:#b34c31}
h1{font-size:52px;letter-spacing:-2px;margin:17px 0 14px;line-height:1.05}.subtitle{font-size:21px;color:#687063;margin:0;line-height:1.5}
.top{display:flex;justify-content:space-between;align-items:center}.mark{font-size:13px;border:1px solid #c9cdbe;padding:10px 13px;border-radius:100px;letter-spacing:.5px}
.columns{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:38px}.label{display:flex;align-items:center;justify-content:space-between;font-size:22px;font-weight:700;margin-bottom:13px}
.label span{font-size:12px;letter-spacing:1px;padding:7px 9px;border-radius:4px;background:#e1e4d9;color:#515c48}.label .red{background:#f2ded5;color:#a24128}
.phone{border-radius:12px;overflow:hidden;border:1px solid #d1d4c7;background:white;box-shadow:0 8px 16px #26302108}.chrome{height:28px;background:#e7e9df;display:flex;align-items:center;gap:5px;padding-left:12px}.chrome i{width:5px;height:5px;border-radius:50%;background:#acb5a0}.phone img{display:block;width:100%}
.caption{font-size:17px;color:#687063;line-height:1.45;margin-top:14px}.footer{margin-top:30px;padding-top:24px;border-top:1px solid #ccd1c2;display:flex;justify-content:space-between;align-items:center;font-size:18px}
.pill{background:#dce7d2;color:#37582a;padding:12px 16px;border-radius:100px;font-size:16px;font-weight:700}.footer b{color:#b34c31}
.trace{display:grid;grid-template-columns:500px 1fr;gap:32px;margin-top:34px}.panel{border:1px solid #cfd3c6;border-radius:10px;background:#faf9f4;padding:24px}.step{font-size:13px;letter-spacing:1.5px;color:#b34c31;font-weight:700;margin-bottom:16px}.overlay{position:relative;width:450px;line-height:0;border:1px solid #d5d8ce;background:#f7f5ef}.overlay img{width:100%;display:block;image-rendering:pixelated}.box{position:absolute;border:2px solid #db4932}.legend{font-size:15px;line-height:1.5;color:#687063;margin-top:14px}
.crops{display:flex;gap:15px;margin-top:23px}.crop{flex:1}.crop img{width:100%;image-rendering:pixelated;border:1px solid #d5d8ce}.crop label{display:block;font-size:12px;letter-spacing:1px;font-weight:700;margin-bottom:9px}.numbers{font-size:25px;font-weight:700;letter-spacing:-.5px;margin:8px 0}.mono{font-family:monospace}.facts{display:flex;gap:32px;margin:20px 0 25px}.fact small{display:block;font-size:13px;color:#687063;margin-bottom:7px}.fact strong{font-size:25px}.code{background:#272d26;color:#eaf0df;border-radius:8px;padding:20px;font-family:monospace;font-size:19px;line-height:1.65}.minus{color:#ffb194}.plus{color:#b7e293}.note{font-size:16px;color:#687063;line-height:1.5;margin-top:16px}.rule{height:1px;background:#d5d8ce;margin:24px 0}
`;

async function screenshot(browser, out, name, body) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  try {
    await page.setContent(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${styles}</style></head><body><div class="board">${body}</div></body></html>`,
    );
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, (img) => img.decode()));
    });
    const buffer = await page.locator(".board").screenshot();
    await sharp(buffer).png({ compressionLevel: 9 }).toFile(path.join(out, name));
  } finally {
    await page.close();
  }
}

export async function renderFigures({
  browser,
  out,
  referenceDir,
  failedDir,
  mobile,
  failure,
  evidence,
}) {
  const sourcePath = path.join(referenceDir, mobile.sourceCapture);
  const replicaPath = path.join(failedDir, mobile.replicaPath);
  const diffPath = path.join(failedDir, mobile.diffPath);
  const sources = await Promise.all([sourcePath, replicaPath, diffPath].map(image));
  const titles = ["Reference", "Replica", "Pixel diff"];
  const tags = ["CAPTURED", "+24 PX SHIFT", `${mobile.tilesFailed} FAILED TILES`];
  const captions = [
    "The original full-page browser capture.",
    "One CSS transform moves the headline.",
    "Red marks the pixels that disagree.",
  ];
  await screenshot(
    browser,
    out,
    "pixel-diff.png",
    `
    <div class="top"><div class="kicker">WEBSITE COPY MAKER / VISUAL EVIDENCE</div><div class="mark">FICTIONAL SITE · REAL CAPTURES</div></div>
    <h1>Looks close. The pixels know where.</h1>
    <p class="subtitle">Compare at the same coordinates. Turn a visual mismatch into a focused repair.</p>
    <div class="columns">${sources.map((src, i) => `<div><div class="label">${titles[i]}<span class="${i ? "red" : ""}">${tags[i]}</span></div><div class="phone"><div class="chrome"><i></i><i></i><i></i></div><img src="${src}"></div><div class="caption">${captions[i]}</div></div>`).join("")}</div>
    <div class="footer"><span><b>${(mobile.similarity * 100).toFixed(2)}% similar</b> still fails. Every 100 × 100 tile must pass.</span><span class="pill">After the fix: 0 failed tiles</span></div>
  `,
  );

  // Exact arithmetic mean at matching document coordinates, for a 50/50 overlay.
  const source = PNG.sync.read(await fs.readFile(sourcePath));
  const replica = PNG.sync.read(await fs.readFile(replicaPath));
  if (source.width !== replica.width || source.height !== replica.height)
    throw new Error("Demo overlay requires equal image bounds");
  const overlay = new PNG({ width: source.width, height: source.height });
  for (let i = 0; i < source.data.length; i++)
    overlay.data[i] = Math.round((source.data[i] + replica.data[i]) / 2);
  const top = Math.max(0, Math.floor(failure.sourceOwner.rect.y / 100) * 100);
  const height = Math.min(230, source.height - top);
  const overlayCrop = await sharp(PNG.sync.write(overlay))
    .extract({ left: 0, top, width: 390, height })
    .png()
    .toBuffer();
  const overlayData = `data:image/png;base64,${overlayCrop.toString("base64")}`;
  const tiles = await Promise.all(
    ["source", "replica", "diff"].map((name) => image(path.join(failedDir, failure.crops[name]))),
  );
  const tile = failure.tile;
  const scale = 450 / 390;
  await screenshot(
    browser,
    out,
    "pixel-to-code.png",
    `
    <div class="top"><div class="kicker">PIXELS → COORDINATES → DOM → CODE</div><div class="mark">MEASURED AT DPR 1</div></div>
    <h1>Give the agent somewhere to look.</h1>
    <p class="subtitle">An overlay exposes the shift. The report narrows the search to the headline and its CSS.</p>
    <div class="trace">
      <div class="panel"><div class="step">01 / INSPECT THE FAILED REGION</div>
        <div class="overlay"><img src="${overlayData}"><div class="box" style="left:${tile.x * scale}px;top:${(tile.y - top) * scale}px;width:${tile.width * scale}px;height:${tile.height * scale}px"></div></div>
        <div class="legend">50% source + 50% replica. The red box marks<br>one failed tile in document coordinates.</div>
        <div class="crops">${tiles.map((src, i) => `<div class="crop"><label>${["SOURCE", "REPLICA", "RED DIFF"][i]}</label><img src="${src}"></div>`).join("")}</div>
        <div class="legend">Actual 100 × 100 crops, enlarged for inspection.</div>
      </div>
      <div class="panel"><div class="step">02 / FOLLOW THE EVIDENCE</div>
        <div class="numbers mono">x: ${tile.x} &nbsp; y: ${tile.y} &nbsp; 100 × 100 px</div>
        <div class="note">${tile.mismatched.toLocaleString("en-US")} pixels differ · ${(tile.ratio * 100).toFixed(2)}% of this tile · 4% limit</div>
        <div class="rule"></div><div class="numbers mono">${escape(failure.replicaOwner.selector)}</div>
        <div class="facts"><div class="fact"><small>SOURCE ELEMENT X</small><strong>${failure.sourceOwner.rect.x}px</strong></div><div class="fact"><small>REPLICA ELEMENT X</small><strong>${failure.replicaOwner.rect.x}px</strong></div><div class="fact"><small>DISPLACEMENT</small><strong>+24px</strong></div></div>
        <div class="step">03 / INSPECT CSS, THEN RE-EVALUATE</div>
        <div class="code">.hero-title {<br><span class="minus">− transform: translateX(24px);</span><br><span class="plus">+ transform: translateX(0px);</span><br>}</div>
        <div class="note">DOM ownership is a geometric candidate. Inspect the<br>crop, ancestors, and code before applying a patch.</div>
      </div>
    </div>
    <div class="footer"><span>Same reference. Same thresholds. Targeted CSS repair.</span><span class="pill">${evidence.comparisons}/${evidence.comparisons} captured checks pass after repair</span></div>
  `,
  );
}
