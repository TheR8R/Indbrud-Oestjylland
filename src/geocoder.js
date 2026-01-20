import { loadJson, saveJson } from "./util/saveFile.js";
import { paths, api, geo, isInBounds, getViewbox } from "./util/config.js";

function parseEntry(entry) {
  let text = entry.replace(/^(Forsøg på indbrud på|På)\s+/i, "");
  const begåetIdx = text.search(/\s+begået/i);
  if (begåetIdx > 0) text = text.slice(0, begåetIdx);
  
  const timeMatch = entry.match(/begået\s+(.+)$/i);
  const time = timeMatch ? timeMatch[1].trim() : "";
  
  let address, city;
  const locationMatch = text.match(/^(.+?)\s+(?:i|ved)\s+(.+)$/i);
  
  if (locationMatch) {
    address = locationMatch[1].trim();
    city = locationMatch[2].trim();
  } else {
    const postalMatch = text.match(/^(.+?)\s+(\d{4})\s+(.+)$/);
    if (postalMatch) {
      address = postalMatch[1].trim();
      city = `${postalMatch[2]} ${postalMatch[3].trim()}`;
    } else {
      address = text.trim();
      city = "Ukendt";
    }
  }
  
  return { address, city, time };
}

function getCityVariations(city) {
  const variations = [city];
  
  const base = city.replace(/\s+[NSVØ]+$/i, "").trim();
  if (base !== city) variations.push(base);
  
  const noPostal = city.replace(/^\d{4}\s+/, "").trim();
  if (noPostal !== city) variations.push(noPostal);
  
  const cityLower = city.toLowerCase();
  const baseLower = base.toLowerCase();
  if (geo.aarhusSuburbs.some(s => cityLower.includes(s) || baseLower.includes(s))) {
    variations.push(`${base}, Aarhus`);
    variations.push("Aarhus");
  }
  
  variations.push("");
  return [...new Set(variations)];
}

function sanitizeAddress(address) {
  return address
    .replace(/\s+\d{4}$/, "")
    .replace(/\s+0+(\d+)/, " $1")
    .replace(/\s+/g, " ")
    .trim();
}

function getAddressVariations(address) {
  const variations = [address];
  
  const abbreviations = [
    [/\bSkt\.\s*/gi, "Sankt "],
    [/\bSt\.\s*/gi, "Sankt "],
    [/\bDr\.\s*/gi, "Doktor "],
    [/\bVej\b/gi, "Vej"],
    [/\bGade\b/gi, "Gade"],
    [/\bAllé\b/gi, "Alle"],
    [/\bAll[eé]\b/gi, "Allé"],
    [/\bPlads\b/gi, "Plads"],
  ];
  
  for (const [pattern, replacement] of abbreviations) {
    if (pattern.test(address)) {
      const expanded = address.replace(pattern, replacement).trim();
      if (expanded !== address && !variations.includes(expanded)) {
        variations.push(expanded);
      }
    }
  }
  
  return variations;
}

async function geocode(address, city, cache, failures) {
  address = sanitizeAddress(address);
  const cacheKey = `${address}, ${city}`;
  
  if (cache[cacheKey]) return cache[cacheKey];
  
  if (city.toLowerCase() === "ukendt") {
    failures[cacheKey] = { reason: "unknown_city", address, city };
    return null;
  }
  
  const viewbox = getViewbox();
  const addressVariations = getAddressVariations(address);
  const cityVariations = getCityVariations(city);
  
  let bestOutOfBounds = null;
  
  for (const addrVariant of addressVariations) {
    for (const cityVariant of cityVariations) {
      const query = cityVariant ? `${addrVariant}, ${cityVariant}, Denmark` : `${addrVariant}, Denmark`;
      
      if (cache[query]) {
        cache[cacheKey] = cache[query];
        return cache[query];
      }
      
      try {
        await Bun.sleep(geo.rateLimitMs);
        
        const params = new URLSearchParams({
          format: "json",
          q: query,
          limit: "5",
          viewbox,
          bounded: "0"
        });
        
        const res = await fetch(`${api.nominatim}?${params}`, {
          headers: { "User-Agent": geo.userAgent }
        });
        
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const data = await res.json();
        
        if (data.length > 0) {
          for (const result of data) {
            const lat = parseFloat(result.lat);
            const lon = parseFloat(result.lon);
            if (isInBounds(lat, lon)) {
              const coords = { lat, lon };
              cache[cacheKey] = coords;
              cache[query] = coords;
              console.log(`  ✓ ${query}`);
              return coords;
            }
          }
          
          if (!bestOutOfBounds) {
            const lat = parseFloat(data[0].lat);
            const lon = parseFloat(data[0].lon);
            bestOutOfBounds = { lat, lon, query, display_name: data[0].display_name };
          }
        }
      } catch (e) {
        console.log(`  ✗ Error: ${query} - ${e.message}`);
      }
    }
  }
  
  if (bestOutOfBounds) {
    failures[cacheKey] = { 
      reason: "out_of_bounds", 
      address, 
      city,
      found_lat: bestOutOfBounds.lat,
      found_lon: bestOutOfBounds.lon,
      found_name: bestOutOfBounds.display_name
    };
    console.log(`  ✗ Out of bounds: ${cacheKey} -> ${bestOutOfBounds.display_name} (${bestOutOfBounds.lat}, ${bestOutOfBounds.lon})`);
  } else {
    failures[cacheKey] = { reason: "not_found", address, city };
    console.log(`  ✗ Not found: ${cacheKey}`);
  }
  
  return null;
}

async function saveAll(cache, failures, output) {
  await saveJson(paths.geocodeCache, cache, { log: false });
  await saveJson(paths.geocodeFailures, failures, { log: false });
  await saveJson(paths.output, output, { log: false });
}

async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1]) : Infinity;
  const retryFailures = args.includes("--retry");
  const recentMode = args.includes("--recent");
  
  const cache = await loadJson(paths.geocodeCache, {});
  const failures = await loadJson(paths.geocodeFailures, {});
  const output = await loadJson(paths.output, {});
  
  // Build set of already processed entries (date + address)
  const processedEntries = new Set();
  for (const date of Object.keys(output)) {
    for (const region of Object.keys(output[date])) {
      for (const city of Object.keys(output[date][region])) {
        for (const entry of output[date][region][city]) {
          processedEntries.add(`${date}|${entry.address}`);
        }
      }
    }
  }
  
  let processed = 0, geocoded = 0, cached = 0, failed = 0, outOfBounds = 0;

  if (retryFailures) {
    const failureKeys = Object.keys(failures);
    if (failureKeys.length === 0) {
      console.log("No failures to retry!");
      return;
    }
    
    console.log(`Retrying ${failureKeys.length} failed geocodes...\n`);
    
    for (const key of failureKeys) {
      if (processed >= limit) break;
      processed++;
      
      const { address, city, reason } = failures[key];
      console.log(`[${processed}/${failureKeys.length}] ${address} i ${city} (was: ${reason})`);
      
      delete failures[key];
      
      const coords = await geocode(address, city, cache, failures);
      
      if (coords) {
        geocoded++;
        
        for (const date of Object.keys(output)) {
          for (const region of Object.keys(output[date])) {
            for (const c of Object.keys(output[date][region])) {
              for (const entry of output[date][region][c]) {
                if (entry.address === address && !entry.lat) {
                  entry.lat = coords.lat;
                  entry.lon = coords.lon;
                }
              }
            }
          }
        }
      } else {
        failed++;
      }
      
      if (processed % 10 === 0) await saveAll(cache, failures, output);
    }
    
    await saveAll(cache, failures, output);
    
    console.log(`\n${"=".repeat(40)}`);
    console.log(`Retry complete!`);
    console.log(`  Fixed: ${geocoded}`);
    console.log(`  Still failing: ${failed}`);
    return;
  }
  
  const inputData = await loadJson(paths.indbrudData);
  if (!inputData) {
    console.error("No input data found. Run Scraper.js first.");
    process.exit(1);
  }
  
  // Count entries to process
  let totalEntries = 0;
  let newEntries = 0;
  for (const report of inputData) {
    if (!report.entries?.length) continue;
    for (const entry of report.entries) {
      totalEntries++;
      const { address } = parseEntry(entry);
      const key = `${report.date}|${address}`;
      if (!processedEntries.has(key)) newEntries++;
    }
  }
  
  if (recentMode) {
    console.log(`Processing ${newEntries} new entries (${totalEntries - newEntries} already processed)...`);
    if (newEntries === 0) {
      console.log("No new entries to geocode!");
      return;
    }
  } else {
    console.log(`Processing ${inputData.length} reports...`);
  }
  console.log(`Cache has ${Object.keys(cache).length} entries\n`);
  
  for (const report of inputData) {
    if (!report.entries?.length) continue;
    
    for (const entry of report.entries) {
      if (processed >= limit) break;
      
      const { address, city, time } = parseEntry(entry);
      const date = report.date;
      const entryKey = `${date}|${address}`;
      
      // Skip already processed entries in recent mode
      if (recentMode && processedEntries.has(entryKey)) continue;
      
      processed++;
      const cacheKey = `${sanitizeAddress(address)}, ${city}`;
      
      console.log(`[${processed}] ${address} i ${city}`);
      
      let coords;
      if (cache[cacheKey]) {
        coords = cache[cacheKey];
        console.log(`  ✓ Cached`);
        cached++;
      } else {
        coords = await geocode(address, city, cache, failures);
        if (coords) geocoded++;
        else {
          failed++;
          if (failures[cacheKey]?.reason === "out_of_bounds") outOfBounds++;
        }
      }
      
      const region = "Østjyllands Politi";
      if (!output[date]) output[date] = {};
      if (!output[date][region]) output[date][region] = {};
      if (!output[date][region][city]) output[date][region][city] = [];
      
      const exists = output[date][region][city].some(e => e.address === address);
      if (!exists) {
        const entryData = { address, time, source_url: report.url };
        if (coords) {
          entryData.lat = coords.lat;
          entryData.lon = coords.lon;
        }
        output[date][region][city].push(entryData);
      }
      
      if (processed % 10 === 0) await saveAll(cache, failures, output);
    }
    if (processed >= limit) break;
  }
  
  const sortedOutput = Object.fromEntries(
    Object.entries(output).sort((a, b) => b[0].localeCompare(a[0]))
  );
  
  await saveJson(paths.geocodeCache, cache, { log: false });
  await saveJson(paths.geocodeFailures, failures, { log: false });
  await saveJson(paths.output, sortedOutput, { log: false });
  
  console.log(`\n${"=".repeat(40)}`);
  console.log(`Done! Processed: ${processed}`);
  console.log(`  Cached: ${cached}`);
  console.log(`  Geocoded: ${geocoded}`);
  console.log(`  Failed: ${failed} (${outOfBounds} out of bounds)`);
  console.log(`Output: ${paths.output}`);
  console.log(`Failures: ${paths.geocodeFailures}`);
}

main().catch(e => console.error("Error:", e.message));