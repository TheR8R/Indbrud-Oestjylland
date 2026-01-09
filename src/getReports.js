const API_URL = "https://politi.dk/api/news/getNewsResults";
const LINKS_FILE = "../data/report_links.json";
const DISTRICT = "OEstjyllands-Politi"; // Only Østjylland has "Indbrud" section

const file = Bun.file(LINKS_FILE);

async function loadLinks() {
  try {
    if (await file.exists()) {
      const data = await file.json();
      if (data && Array.isArray(data.links)) {
        return data;
      }
    }
  } catch (e) {
    console.log("Could not read existing file, starting fresh...");
  }
  return { district: DISTRICT, links: [], lastUpdated: null };
}

async function saveLinks(data) {
  data.lastUpdated = new Date().toISOString();
  await Bun.write(LINKS_FILE, JSON.stringify(data, null, 2));
  console.log(`  Saved ${data.links.length} links to ${LINKS_FILE}`);
}

async function fetchPage(page, fromDate, toDate = null) {
  const params = new URLSearchParams({
    districtQuery: DISTRICT,
    fromDate: `${fromDate}T00:00:00.000Z`,
    toDate: toDate ? `${toDate}T23:59:59.000Z` : new Date().toISOString(),
    isNewsList: "true",
    itemId: "90DEB0B1-8DF0-4A2D-823B-CFD7A5ADD85F",
    language: "da",
    newsType: "Døgnrapporter",
    page,
    pageSize: 10
  });

  const res = await fetch(`${API_URL}?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  
  const json = await res.json();
  return (json.NewsList || []).filter(item => item.Link).map(item => item.Link);
}

async function fetchAllLinks(data, fromDate = "2018-12-14", toDate = null) {
  const existingSet = new Set(data.links);
  let page = 1;

  while (true) {
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
    
    if (links.length < 10) break;
    page++;
  }
}

async function fetchNewLinks(data) {
  const existingSet = new Set(data.links);
  const newLinks = [];
  let page = 1;

  while (true) {
    console.log(`Checking page ${page} for new reports...`);
    const links = await fetchPage(page, "2018-12-14");
    
    if (links.length === 0) break;

    let foundExisting = false;
    
    for (const link of links) {
      if (existingSet.has(link)) {
        foundExisting = true;
        break;
      }
      newLinks.push(link);
    }

    if (foundExisting || links.length < 10) break;
    page++;
  }

  // Prepend new links to existing ones
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
  const fromDate = fromIdx !== -1 ? args[fromIdx + 1] : "2018-12-14";
  const toDate = toIdx !== -1 ? args[toIdx + 1] : null;

  const data = await loadLinks();
  console.log(`Loaded data with ${data.links.length} existing links`);
  if (data.lastUpdated) {
    console.log(`Last updated: ${data.lastUpdated}`);
  }
  console.log();
  
  if (fetchRecent) {
    console.log("Fetching recent reports until last known link...\n");
    await fetchNewLinks(data);
  } else if (fetchAll || data.links.length === 0 || fromIdx !== -1 || toIdx !== -1) {
    console.log(`Fetching historical reports: ${fromDate} → ${toDate || "now"}\n`);
    await fetchAllLinks(data, fromDate, toDate);
  } else {
    console.log("Use --recent to fetch new reports or --all to fetch everything\n");
  }

  console.log(`Done! Total links: ${data.links.length}`);
}

main().catch(err => {
  console.error("Error:", err.message);
  console.error(err.stack);
});