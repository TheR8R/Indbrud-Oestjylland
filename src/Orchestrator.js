import { $ } from "bun";

const DATA_DIR = "../data";
const DOCS_DIR = "../docs";
const OUTPUT_FILE = `${DOCS_DIR}/data.json`;
const GEOCODED_FILE = `${DATA_DIR}/data.json`;

async function loadJson(filename) {
  const file = Bun.file(filename);
  try {
    if (await file.exists()) return await file.json();
  } catch (e) {}
  return null;
}

async function saveJson(filename, data) {
  await Bun.write(filename, JSON.stringify(data, null, 2));
}

// Clean and format data for frontend consumption
function cleanForFrontend(data) {
  const cleaned = {};
  
  for (const [date, regions] of Object.entries(data)) {
    cleaned[date] = {};
    
    for (const [region, cities] of Object.entries(regions)) {
      cleaned[date][region] = {};
      
      for (const [city, entries] of Object.entries(cities)) {
        cleaned[date][region][city] = entries
          .filter(e => e.lat && e.lon) // Only include geocoded entries
          .map(e => ({
            address: e.address,
            time: e.time,
            lat: e.lat,
            lon: e.lon
          }));
        
        // Remove empty cities
        if (cleaned[date][region][city].length === 0) {
          delete cleaned[date][region][city];
        }
      }
      
      // Remove empty regions
      if (Object.keys(cleaned[date][region]).length === 0) {
        delete cleaned[date][region];
      }
    }
    
    // Remove empty dates
    if (Object.keys(cleaned[date]).length === 0) {
      delete cleaned[date];
    }
  }
  
  // Sort by date descending
  return Object.fromEntries(
    Object.entries(cleaned).sort((a, b) => b[0].localeCompare(a[0]))
  );
}

async function run(cmd, name) {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Running: ${name}`);
  console.log("=".repeat(50));
  
  const proc = Bun.spawn(["bun", "run", ...cmd.split(" ")], {
    cwd: import.meta.dir,
    stdout: "inherit",
    stderr: "inherit"
  });
  
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error(`${name} failed with exit code ${exitCode}`);
    return false;
  }
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || "daily";
  
  console.log(`\n${"#".repeat(50)}`);
  console.log(`# Indbrud Scraper - ${mode.toUpperCase()} mode`);
  console.log("#".repeat(50));
  
  let success = true;
  
  switch (mode) {
    case "daily":
      // Daily update: fetch recent reports, scrape, geocode
      success = await run("getReports.js --recent", "Fetch recent reports");
      if (success) success = await run("scraper.js --all", "Scrape all reports");
      if (success) success = await run("geocoder.js", "Geocode addresses");
      break;
      
    case "full":
      // Full rebuild: fetch all, scrape all, geocode all
      success = await run("getReports.js --all", "Fetch all reports");
      if (success) success = await run("scraper.js --all", "Scrape all reports");
      if (success) success = await run("geocoder.js", "Geocode addresses");
      break;
      
    case "scrape":
      // Just scrape and geocode (reports already fetched)
      success = await run("scraper.js --all", "Scrape all reports");
      if (success) success = await run("geocoder.js", "Geocode addresses");
      break;
      
    case "geocode":
      // Just geocode (scraping already done)
      success = await run("geocoder.js", "Geocode addresses");
      break;
      
    case "retry":
      // Retry failures
      success = await run("scraper.js --retry", "Retry failed scrapes");
      if (success) success = await run("geocoder.js --retry", "Retry failed geocodes");
      break;
      
    case "clean":
      // Just clean/format the data
      break;
      
    default:
      console.log(`
Usage: bun run orchestrator.js [mode]

Modes:
  daily   - Fetch recent reports, scrape, and geocode (default)
  full    - Full rebuild: fetch all, scrape all, geocode all
  scrape  - Scrape all reports and geocode (skip fetching)
  geocode - Just geocode addresses (skip fetching and scraping)
  retry   - Retry all failures (scraping and geocoding)
  clean   - Just clean/format data for frontend
`);
      process.exit(1);
  }
  
  if (!success) {
    console.error("\n❌ Pipeline failed!");
    process.exit(1);
  }
  
  // Clean data for frontend
  console.log(`\n${"=".repeat(50)}`);
  console.log("Cleaning data for frontend...");
  console.log("=".repeat(50));
  
  const geocodedData = await loadJson(GEOCODED_FILE);
  if (geocodedData) {
    const cleaned = cleanForFrontend(geocodedData);
    
    // Count stats
    let totalEntries = 0;
    let totalDates = Object.keys(cleaned).length;
    for (const regions of Object.values(cleaned)) {
      for (const cities of Object.values(regions)) {
        for (const entries of Object.values(cities)) {
          totalEntries += entries.length;
        }
      }
    }
    
    await saveJson(OUTPUT_FILE, cleaned);
    console.log(`✓ Saved ${totalEntries} entries across ${totalDates} dates`);
    console.log(`  Output: ${OUTPUT_FILE}`);
  }
  
  console.log(`\n${"#".repeat(50)}`);
  console.log("# ✓ Pipeline complete!");
  console.log("#".repeat(50));
}

main().catch(e => {
  console.error("Error:", e.message);
  process.exit(1);
});