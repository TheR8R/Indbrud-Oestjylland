const LINKS_FILE = "../data/report_links.json";
const OUTPUT_FILE = "../data/indbrud_data.json";
const FAILURES_FILE = "../data/indbrud_data_failures.json";

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

async function loadFailures() {
  return await loadJson(FAILURES_FILE) || { failures: [], lastUpdated: null };
}

async function saveFailures(data) {
  data.lastUpdated = new Date().toISOString();
  await Bun.write(FAILURES_FILE, JSON.stringify(data, null, 2));
}

async function addFailure(url, reason, failuresData) {
  const existing = failuresData.failures.findIndex(f => f.url === url);
  const entry = { url, reason, date: extractDateFromUrl(url), checkedAt: new Date().toISOString() };
  
  if (existing !== -1) {
    failuresData.failures[existing] = entry;
  } else {
    failuresData.failures.push(entry);
  }
  await saveFailures(failuresData);
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&oslash;/g, "ø")
    .replace(/&Oslash;/g, "Ø")
    .replace(/&aring;/g, "å")
    .replace(/&Aring;/g, "Å")
    .replace(/&aelig;/g, "æ")
    .replace(/&AElig;/g, "Æ")
    .replace(/&eacute;/g, "é")
    .replace(/&Eacute;/g, "É")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code))
    .replace(/&([a-z]+);/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim();
}

function extractEntries(text) {
  if (!text) return [];
  const entries = [];
  
  // Pattern 1: "På [Address]... begået" or "Forsøg på indbrud på [Address]... begået"
  const parts = text.split(/(?=(?:Forsøg på indbrud på|(?:^|[\n\s\*•])På)\s*[A-ZÆØÅ])/gi);
  for (let part of parts) {
    part = part.trim().replace(/^[\*•\s]+/, "");
    if (!/^(Forsøg på indbrud på|På)\s+/i.test(part)) continue;
    const begåetMatch = part.match(/begået/i);
    if (!begåetMatch || begåetMatch.index > 300) continue;
    const endMatch = part.slice(10).match(/(?:Forsøg på indbrud på|(?:\n|^)På)\s+[A-ZÆØÅ]|\n\n/i);
    if (endMatch) part = part.slice(0, endMatch.index + 10).trim();
    entries.push(part);
  }
  
  // Pattern 2: "[Address] i/ved [City] – begået" (no "På")
  const dashPattern = /([A-ZÆØÅ][^\n–\-—]+?(?:\s+i\s+|\s+ved\s+)[A-ZÆØÅ][^\n–\-—]+?)\s*[–\-—]+\s*begået\s+(.+?)(?=\n|$)/gi;
  let match;
  while ((match = dashPattern.exec(text)) !== null) {
    const entry = `På ${match[1].trim()} begået ${match[2].trim()}`;
    if (!entries.some(e => e.includes(match[1].trim()))) {
      entries.push(entry);
    }
  }
  
  return entries;
}

function extractDateFromUrl(url) {
  const match = url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\/?/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function extractIndbudEntries(html) {
  const richTextMatch = html.match(/<div class="rich-text">([\s\S]*?)<\/div>/i);
  if (!richTextMatch) return { entries: [], hasSection: false };
  
  const textContent = stripHtml(richTextMatch[1]);
  const hasSection = /indbrud/i.test(textContent);
  const entries = extractEntries(textContent);
  
  return { entries, hasSection };
}

async function scrapeReport(url, failuresData) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const { entries, hasSection } = extractIndbudEntries(await res.text());
    
    if (entries.length === 0) {
      await addFailure(url, hasSection ? "Indbrud section found but no valid entries" : "No Indbrud entries found", failuresData);
      return { url, date: extractDateFromUrl(url), entries: [], noSection: !hasSection };
    }
    
    return { url, date: extractDateFromUrl(url), entries };
  } catch (e) {
    return { url, error: e.message };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const scrapeAll = args.includes("--all");
  const limit = scrapeAll ? Infinity : (args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1]) : 5);
  const retryFailures = args.includes("--retry");

  const linksData = await loadJson(LINKS_FILE);
  if (!linksData?.links?.length) {
    console.error("No links found. Run getReports.js first.");
    process.exit(1);
  }

  const failuresData = await loadFailures();
  const results = [];
  let successCount = 0, failCount = 0;

  if (retryFailures) {
    if (!failuresData.failures.length) {
      console.log("No failures to retry!");
      return;
    }
    
    console.log(`Retrying ${failuresData.failures.length} failed reports...\n`);
    const stillFailing = [];
    const emptyFailures = { failures: [] };
    
    for (let i = 0; i < failuresData.failures.length; i++) {
      const { url } = failuresData.failures[i];
      console.log(`[${i + 1}/${failuresData.failures.length}] ${url}`);
      
      const result = await scrapeReport(url, emptyFailures);
      
      if (result.entries?.length) {
        console.log(`  ✓ Found ${result.entries.length} entries`);
        successCount++;
        results.push(result);
      } else {
        console.log(`  ✗ Still failing`);
        failuresData.failures[i].checkedAt = new Date().toISOString();
        stillFailing.push(failuresData.failures[i]);
        failCount++;
      }
      await Bun.sleep(500);
    }
    
    failuresData.failures = stillFailing;
    await saveFailures(failuresData);
    
    if (results.length) {
      const existing = await loadJson(OUTPUT_FILE) || [];
      await saveJson(OUTPUT_FILE, [...existing, ...results]);
    }
    
    console.log(`\nDone! Fixed: ${successCount} | Still failing: ${failCount}`);
  } else {
    const total = scrapeAll ? linksData.links.length : Math.min(limit, linksData.links.length);
    console.log(`Scraping ${total} of ${linksData.links.length} reports...\n`);

    for (let i = 0; i < total; i++) {
      const url = linksData.links[i];
      console.log(`[${i + 1}/${total}] ${url}`);
      
      const result = await scrapeReport(url, failuresData);
      
      if (result.entries?.length) {
        console.log(`  ✓ Found ${result.entries.length} entries`);
        successCount++;
      } else if (result.error) {
        console.log(`  ✗ Error: ${result.error}`);
        failCount++;
      } else {
        console.log(`  ✗ No entries found`);
        failCount++;
      }
      
      results.push(result);
      await Bun.sleep(500);
    }

    await saveJson(OUTPUT_FILE, results);
    console.log(`\nDone! Success: ${successCount} | Failures: ${failCount}`);
  }
}

main().catch(e => console.error("Error:", e.message));