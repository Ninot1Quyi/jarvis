const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { screen } = require("electron");

function createWindowEdgeController({ topOffset = 0 } = {}) {
  const isMac = process.platform === "darwin";
  const helperPackagePath = path.resolve(__dirname, "..", "..", "window-edge-agent");
  const helperBinaryCandidates = [
    path.join(
      helperPackagePath,
      ".build",
      "arm64-apple-macosx",
      "debug",
      "window-edge-agent"
    ),
    path.join(
      helperPackagePath,
      ".build",
      "x86_64-apple-macosx",
      "debug",
      "window-edge-agent"
    ),
    path.join(helperPackagePath, ".build", "debug", "window-edge-agent"),
  ];

  let helperReady = false;

  function resolveHelperBinaryPath() {
    return (
      helperBinaryCandidates.find((candidate) => fs.existsSync(candidate)) || null
    );
  }

  function ensureMacHelperReady() {
    if (!isMac || helperReady) return;
    if (resolveHelperBinaryPath()) {
      helperReady = true;
      return;
    }

    const build = spawnSync(
      "swift",
      ["build", "--package-path", helperPackagePath, "-c", "debug"],
      { encoding: "utf8", timeout: 120_000 }
    );
    if (build.status === 0 && resolveHelperBinaryPath()) {
      helperReady = true;
      return;
    }

    console.warn("[window-edge] swift helper build failed", {
      status: build.status,
      stdout: build.stdout?.slice(-400),
      stderr: build.stderr?.slice(-400),
    });
  }

  function resolveFrame(width, height) {
    const display = screen.getPrimaryDisplay();
    const bounds = display.bounds;
    const x = Math.round(bounds.x + (bounds.width - width) / 2);
    const y = bounds.y + topOffset;
    return {
      display,
      bounds,
      frame: { x, y, width, height },
    };
  }

  function pinWithSwift(reqFrame) {
    ensureMacHelperReady();
    if (!helperReady) return;
    const helperBinaryPath = resolveHelperBinaryPath();
    if (!helperBinaryPath) return;

    const args = [
      "pin",
      "--pid",
      String(process.pid),
      "--x",
      String(reqFrame.x),
      "--y",
      String(reqFrame.y),
      "--width",
      String(reqFrame.width),
      "--height",
      String(reqFrame.height),
    ];

    const run = spawnSync(helperBinaryPath, args, {
      encoding: "utf8",
      timeout: 12_000,
    });

    if (run.status !== 0) {
      console.warn("[window-edge] swift pin failed", {
        status: run.status,
        signal: run.signal,
        error: run.error?.message,
        stdout: run.stdout?.trim(),
        stderr: run.stderr?.trim(),
      });
      return;
    }

    const line = run.stdout?.trim();
    if (line) {
      console.log("[window-edge] swift pin result", line);
    }
  }

  function pinToTopEdge(window, { width, height }) {
    const { bounds, frame } = resolveFrame(width, height);

    // Default cross-platform behavior.
    window.setBounds(frame, false);
    window.setPosition(frame.x, frame.y, false);

    // macOS special path: delegate to Swift helper for stronger top-edge pinning.
    if (isMac) {
      pinWithSwift(frame);
    }

    const actual = window.getBounds();
    console.log("[window-edge] position", {
      requested: frame,
      actual,
      bounds,
    });
    return { requested: frame, actual, bounds };
  }

  return {
    pinToTopEdge,
    resolveFrame,
  };
}

module.exports = { createWindowEdgeController };
