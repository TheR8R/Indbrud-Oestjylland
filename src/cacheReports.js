import { parse } from "node-html-parser";
import { loadJson, saveJson } from "./util/saveFile.js";
import { paths, api, scraping } from "./util/config.js";

async function saveCache(cache) {
  cache.lastUpdated = new Date().toISOString();
  await saveJson(paths.reportsCache, cache, { log: false });
}

async function fetchReportContent(link) {
  const url = link.startsWith("http") ? link : `${api.politiBase}${link}`;
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
  const args = process.argv.slice(2);
  const recentMode = args.includes("--recent");
  
  const linksData = await loadJson(paths.reportLinks);
  if (!linksData?.links?.length) {
    console.error("No links found in", paths.reportLinks);
    return;
  }
  console.log(`Loaded ${linksData.links.length} links from ${paths.reportLinks}`);

  const cache = await loadJson(paths.reportsCache, { reports: {} });
  if (!cache.reports) cache.reports = {};
  console.log(`Cache has ${Object.keys(cache.reports).length} reports`);

  const uncached = linksData.links.filter(link => !cache.reports[link]);
  console.log(`\n${uncached.length} reports to fetch\n`);

  if (uncached.length === 0) {
    console.log("All reports already cached!");
    return;
  }

  const totalBatches = Math.ceil(uncached.length / scraping.batchSize);
  let totalFetched = 0;

  for (let i = 0; i < uncached.length; i += scraping.batchSize) {
    const batch = uncached.slice(i, i + scraping.batchSize);
    const batchNum = Math.floor(i / scraping.batchSize) + 1;
    
    console.log(`Batch ${batchNum}/${totalBatches}...`);
    
    const fetched = await fetchBatch(batch, cache);
    totalFetched += fetched;
    
    await saveCache(cache);
    console.log(`  ✓ ${fetched}/${batch.length} fetched (total: ${Object.keys(cache.reports).length})\n`);
    
    if (i + scraping.batchSize < uncached.length) await Bun.sleep(scraping.sleepMs);
  }

  console.log(`Done! Fetched ${totalFetched} new reports.`);
  console.log(`Total cached: ${Object.keys(cache.reports).length}`);
}

main().catch(err => {
  console.error("Error:", err.message);
});