import { parse } from "node-html-parser";

const LINKS_FILE = "../data/report_links.json";
const CACHE_FILE = "../data/reports_cache.json";
const BASE_URL = "https://politi.dk";
const BATCH_SIZE = 10;

async function loadJson(path) {
  const f = Bun.file(path);
  if (await f.exists()) return f.json();
  return null;
}

async function saveCache(cache) {
  cache.lastUpdated = new Date().toISOString();
  await Bun.write(CACHE_FILE, JSON.stringify(cache, null, 2));
}

async function fetchReportContent(link) {
  const url = link.startsWith("http") ? link : `${BASE_URL}${link}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  
  const html = await res.text();
  const root = parse(html);
  const richText = root.querySelector(".rich-text");
  
  return richText ? richText.innerHTML.trim() : null;
}

async function fetchBatch(links, cache) {
  const results = await Promise.all(
    links.map(async (link) => {
      try {
        const content = await fetchReportContent(link);
        return { link, content, success: true };
      } catch (e) {
        console.error(`    ✗ ${link}: ${e.message}`);
        return { link, success: false };
      }
    })
  );
  
  for (const r of results) {
    if (r.success) {
      cache.reports[r.link] = {
        fetchedAt: new Date().toISOString(),
        content: r.content
      };
    }
  }
  
  return results.filter(r => r.success).length;
}

async function main() {
  // Load existing links
  const linksData = await loadJson(LINKS_FILE);
  if (!linksData?.links?.length) {
    console.error("No links found in", LINKS_FILE);
    return;
  }
  console.log(`Loaded ${linksData.links.length} links from ${LINKS_FILE}`);

  // Load or create cache
  const cache = await loadJson(CACHE_FILE) || { reports: {} };
  if (!cache.reports) cache.reports = {};
  console.log(`Cache has ${Object.keys(cache.reports).length} reports`);

  // Find links not yet cached
  const uncached = linksData.links.filter(link => !cache.reports[link]);
  console.log(`\n${uncached.length} reports to fetch\n`);

  if (uncached.length === 0) {
    console.log("All reports already cached!");
    return;
  }

  // Fetch in batches
  const totalBatches = Math.ceil(uncached.length / BATCH_SIZE);
  let totalFetched = 0;

  for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
    const batch = uncached.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    
    console.log(`Batch ${batchNum}/${totalBatches}...`);
    
    const fetched = await fetchBatch(batch, cache);
    totalFetched += fetched;
    
    await saveCache(cache);
    console.log(`  ✓ ${fetched}/${batch.length} fetched (total: ${Object.keys(cache.reports).length})\n`);
    
    if (i + BATCH_SIZE < uncached.length) await Bun.sleep(500);
  }

  console.log(`Done! Fetched ${totalFetched} new reports.`);
  console.log(`Total cached: ${Object.keys(cache.reports).length}`);
}

main().catch(err => {
  console.error("Error:", err.message);
});