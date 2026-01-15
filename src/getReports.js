import { loadJson, saveJson } from "./util/saveFile.js";
import { paths, api, scraping } from "./util/config.js";

const DEFAULT_DATA = { district: scraping.district, links: [], lastUpdated: null };

async function loadLinks() {
  const data = await loadJson(paths.reportLinks, DEFAULT_DATA);
  return data?.links?.length ? data : DEFAULT_DATA;
}

async function saveLinks(data) {
  data.lastUpdated = new Date().toISOString();
  await saveJson(paths.reportLinks, data, { log: false });
  console.log(`  Saved ${data.links.length} links to ${paths.reportLinks}`);
}

async function fetchPage(page, fromDate, toDate = null) {
  const params = new URLSearchParams({
    districtQuery: scraping.district,
    fromDate: `${fromDate}T00:00:00.000Z`,
    toDate: toDate ? `${toDate}T23:59:59.000Z` : new Date().toISOString(),
    isNewsList: "true",
    itemId: scraping.itemId,
    language: "da",
    newsType: "Døgnrapporter",
    page,
    pageSize: scraping.pageSize
  });

  const res = await fetch(`${api.politi}?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  
  const json = await res.json();
  return (json.NewsList || []).filter(item => item.Link).map(item => item.Link);
}

async function fetchAllLinks(data, fromDate = scraping.startDate, toDate = null) {
  const existingSet = new Set(data.links);
  let page = 1;
  const maxPages = 1000; // Safety limit

  while (page <= maxPages) {
    console.log(`Fetching page ${page}...`);
    const links = await fetchPage(page, fromDate, toDate);
    
    if (links.length === 0) break;
    
    let added = 0;
    for (const link of links) {
      if (!existingSet.has(link)) {
        data.links.push(link);
        existingSet.add(link);
        added++;
      }
    }
    
    console.log(`  Added ${added} new links (total: ${data.links.length})`);
    await saveLinks(data);
    
    if (links.length < scraping.pageSize) break;
    page++;
  }
}

async function fetchNewLinks(data) {
  if (data.links.length === 0) {
    console.log("No existing links found. Use --all for initial fetch.");
    return 0;
  }

  const existingSet = new Set(data.links);
  const newLinks = [];
  let page = 1;
  const maxPages = 100; // Safety limit for recent fetch

  while (page <= maxPages) {
    console.log(`Checking page ${page} for new reports...`);
    const links = await fetchPage(page, scraping.startDate);
    
    if (links.length === 0) break;

    let foundExisting = false;
    
    for (const link of links) {
      if (existingSet.has(link)) {
        foundExisting = true;
        break;
      }
      newLinks.push(link);
    }

    if (foundExisting || links.length < scraping.pageSize) break;
    page++;
  }

  if (newLinks.length > 0) {
    data.links = [...newLinks, ...data.links];
    await saveLinks(data);
    console.log(`\nAdded ${newLinks.length} new report(s)`);
  } else {
    console.log("\nNo new reports found.");
  }
  
  return newLinks.length;
}

async function main() {
  const args = process.argv.slice(2);
  const fetchAll = args.includes("--all");
  const fetchRecent = args.includes("--recent");
  const fromIdx = args.indexOf("--from");
  const toIdx = args.indexOf("--to");
  const fromDate = fromIdx !== -1 ? args[fromIdx + 1] : scraping.startDate;
  const toDate = toIdx !== -1 ? args[toIdx + 1] : null;

  const data = await loadLinks();
  console.log(`Loaded data with ${data.links.length} existing links`);
  if (data.lastUpdated) {
    console.log(`Last updated: ${data.lastUpdated}`);
  }
  console.log();
  
  let newCount = 0;
  
  if (fetchRecent) {
    console.log("Fetching recent reports until last known link...\n");
    newCount = await fetchNewLinks(data);
  } else if (fetchAll || data.links.length === 0 || fromIdx !== -1 || toIdx !== -1) {
    console.log(`Fetching historical reports: ${fromDate} → ${toDate || "now"}\n`);
    await fetchAllLinks(data, fromDate, toDate);
    newCount = data.links.length; // Treat all as "new" for --all mode
  } else {
    console.log("Use --recent to fetch new reports or --all to fetch everything\n");
  }

  console.log(`Done! Total links: ${data.links.length}`);
  
  // Exit with code 2 if no new reports (for pipeline early exit)
  if (fetchRecent && newCount === 0) {
    process.exit(2);
  }
}

main().catch(err => {
  console.error("Error:", err.message);
  console.error(err.stack);
});