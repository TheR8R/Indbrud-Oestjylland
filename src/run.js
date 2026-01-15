import { $ } from "bun";

const STEPS = [
  { name: "Fetch report links", script: "getReports.js", recentArgs: ["--recent"], allArgs: ["--all"], checkNew: true },
  { name: "Cache report HTML", script: "cacheReports.js", recentArgs: ["--recent"], allArgs: [] },
  { name: "Extract break-ins", script: "Scraper.js", recentArgs: ["--recent"], allArgs: [] },
  { name: "Geocode addresses", script: "geocoder.js", recentArgs: ["--recent"], allArgs: [] },
  { name: "Sanitize output", script: "sanitize.js", recentArgs: ["--recent"], allArgs: [] },
];

function printUsage() {
  console.log(`
Usage: bun src/run.js [options]

Options:
  --all         Process all data (full historical fetch + reprocess)
  --recent      Process only recent/new data (default)
  --skip=N      Skip first N steps
  --only=N      Run only step N (1-indexed)
  --dry         Show steps without running
  --help        Show this help

Steps:
${STEPS.map((s, i) => `  ${i + 1}. ${s.name}`).join("\n")}
`);
}

async function runStep(step, mode) {
  const args = mode === "all" ? step.allArgs : step.recentArgs;
  const cmd = ["bun", `src/${step.script}`, ...args];
  
  console.log(`\n${"═".repeat(50)}`);
  console.log(`▶ ${step.name}`);
  console.log(`  ${cmd.join(" ")}`);
  console.log("═".repeat(50) + "\n");
  
  const proc = Bun.spawn(cmd, {
    stdout: "inherit",
    stderr: "inherit",
  });
  
  const exitCode = await proc.exited;
  
  if (exitCode === 0) {
    console.log(`\n✓ ${step.name} complete`);
    return { success: true, hasNew: true };
  } else if (exitCode === 2) {
    // Exit code 2 = success but no new data
    console.log(`\n✓ ${step.name} complete (no new data)`);
    return { success: true, hasNew: false };
  } else {
    console.error(`\n✗ Step failed with exit code ${exitCode}`);
    return { success: false, hasNew: false };
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes("--help")) {
    printUsage();
    return;
  }
  
  const dry = args.includes("--dry");
  const mode = args.includes("--all") ? "all" : "recent";
  const skipArg = args.find(a => a.startsWith("--skip="));
  const onlyArg = args.find(a => a.startsWith("--only="));
  
  const skip = skipArg ? parseInt(skipArg.split("=")[1]) : 0;
  const only = onlyArg ? parseInt(onlyArg.split("=")[1]) : null;
  
  let steps = [...STEPS];
  
  // Filter steps based on --skip or --only
  if (only !== null) {
    if (only < 1 || only > steps.length) {
      console.error(`Invalid step number: ${only}`);
      process.exit(1);
    }
    steps = [steps[only - 1]];
  } else if (skip > 0) {
    steps = steps.slice(skip);
  }
  
  console.log(`\n🔄 Indbrud Pipeline - ${steps.length} step(s) to run [${mode}]\n`);
  
  if (dry) {
    console.log("Dry run - would execute:\n");
    steps.forEach((s, i) => {
      const stepArgs = mode === "all" ? s.allArgs : s.recentArgs;
      console.log(`  ${i + 1}. bun src/${s.script} ${stepArgs.join(" ")}`);
    });
    return;
  }
  
  const startTime = Date.now();
  
  for (const step of steps) {
    const result = await runStep(step, mode);
    if (!result.success) {
      console.error("\n❌ Pipeline aborted due to failure");
      process.exit(1);
    }
    
    // Exit early if no new data in recent mode
    if (mode === "recent" && step.checkNew && !result.hasNew) {
      console.log(`\n${"═".repeat(50)}`);
      console.log(`✅ Pipeline complete - no new reports to process`);
      console.log("═".repeat(50) + "\n");
      return;
    }
  }
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n${"═".repeat(50)}`);
  console.log(`✅ Pipeline complete in ${elapsed}s [${mode}]`);
  console.log("═".repeat(50) + "\n");
}

main().catch(err => {
  console.error("Pipeline error:", err.message);
  process.exit(1);
});