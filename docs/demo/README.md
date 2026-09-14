# Reproduce the README illustrations

Form & Field is a fictional site built for this documentation. The figures use
real Chromium screenshots and this package's actual evaluation output. They are
a controlled demonstration, not evidence of a customer migration or an autonomous
agent run.

In an isolated browser runtime, from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm playwright:install
pnpm build
node docs/demo/capture.mjs /work/readme-demo-01
```

The output directory must be new; its parent must exist. Linux runtimes may need
Playwright's browser system dependencies installed. The script serves only local
fixture files on ephemeral loopback ports and closes its browsers and servers
in `finally`. There are no external assets, model calls, or hosting services.

The script:

1. Captures `/` and `/journal/` at 390×900 and 1200×900, both at DPR 1.
2. Captures two mobile scenarios: opening the studio dialog and navigating to
   the journal, with visible-element, URL, and text assertions.
3. Adds `translateX(24px)` to the replica's `.hero-title` and evaluates it.
4. Selects an actual failed tile mapped to `#hero-title` in both documents and
   verifies the 24px difference between their element rectangles.
5. Restores `translateX(0px)` and requires all six captured comparisons to pass
   with zero failed tiles and identical pixels.
6. Composes the two README figures from those screenshots, crops, and measured
   report fields. The overlay is the arithmetic mean of corresponding pixels;
   images are enlarged only for display, after evaluation.

`site.html` supplies an optional `data-source-file="site.css (.hero-title)"`
hint. The tool reports that hint; it does not discover arbitrary source files.
DOM candidates still need screenshot, ancestor, and code inspection.

The output includes `reference/`, `before/`, `after/`, `demo-evidence.json`,
`pixel-diff.png`, and `pixel-to-code.png`. The JSON records the browser version,
fixture hashes, selected failure, and measured before/after results. Keep raw run
artifacts in your own workspace. Only the two generic documentation figures are
checked into [the asset directory](../assets/).

To refresh the illustrations, inspect both PNGs and the successful evidence,
then copy the two PNGs into `docs/assets/` in a task checkout. Never replace the
fixed reference with a failing replica or relax the evaluation threshold.
