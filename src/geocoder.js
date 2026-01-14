const INPUT_FILE = "../data/indbrud_data.json";
const OUTPUT_FILE = "../docs/data.json";
const CACHE_FILE = "../data/geocode_cache.json";
const FAILURES_FILE = "../data/geocode_failures.json";

const OSTJYLLAND_BOUNDS = { latMin: 55.8, latMax: 56.6, lonMin: 9.5, lonMax: 11.0 };

const AARHUS_SUBURBS = [
  "risskov", "åbyhøj", "brabrand", "viby", "højbjerg", "hasle", "tilst",
  "skejby", "lisbjerg", "tranbjerg", "mårslet", "beder", "malling", "egå",
  "lystrup", "hjortshøj", "sabro", "gellerup", "hasselager", "skødstrup"
];

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

// Parse "På [Address] i [City] begået..." into address and city
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
  if (AARHUS_SUBURBS.some(s => cityLower.includes(s) || baseLower.includes(s))) {
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

function isInBounds(lat, lon) {
  return lat >= OSTJYLLAND_BOUNDS.latMin && lat <= OSTJYLLAND_BOUNDS.latMax &&
         lon >= OSTJYLLAND_BOUNDS.lonMin && lon <= OSTJYLLAND_BOUNDS.lonMax;
}

async function geocode(address, city, cache, failures) {
  address = sanitizeAddress(address);
  const cacheKey = `${address}, ${city}`;
  
  if (cache[cacheKey]) {
    return cache[cacheKey];
  }
  
  if (city.toLowerCase() === "ukendt") {
    failures[cacheKey] = { reason: "unknown_city", address, city };
    return null;
  }
  
  const viewbox = `${OSTJYLLAND_BOUNDS.lonMin},${OSTJYLLAND_BOUNDS.latMin},${OSTJYLLAND_BOUNDS.lonMax},${OSTJYLLAND_BOUNDS.latMax}`;
  const addressVariations = getAddressVariations(address);
  const cityVariations = getCityVariations(city);
  
  let bestOutOfBounds = null; // Track best out-of-bounds result for failure logging
  
  for (const addrVariant of addressVariations) {
    for (const cityVariant of cityVariations) {
      const query = cityVariant ? `${addrVariant}, ${cityVariant}, Denmark` : `${addrVariant}, Denmark`;
      
      if (cache[query]) {
        cache[cacheKey] = cache[query];
        return cache[query];
      }
      
      try {
        await Bun.sleep(1000);
        
        const params = new URLSearchParams({
          format: "json",
          q: query,
          limit: "5",
          viewbox,
          bounded: "0"
        });
        
        const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
          headers: { "User-Agent": "IndbrudScraper/1.0" }
        });
        
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const data = await res.json();
        
        if (data.length > 0) {
          // Only accept results within bounds
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
          
          // Track out-of-bounds result for failure logging
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
  
  // Log failure with details
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

async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1]) : Infinity;
  const retryFailures = args.includes("--retry");
  
  const cache = await loadJson(CACHE_FILE) || {};
  const failures = await loadJson(FAILURES_FILE) || {};
  const output = await loadJson(OUTPUT_FILE) || {};
  
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
      
      if (processed % 10 === 0) {
        await saveJson(CACHE_FILE, cache);
        await saveJson(FAILURES_FILE, failures);
        await saveJson(OUTPUT_FILE, output);
      }
    }
    
    await saveJson(CACHE_FILE, cache);
    await saveJson(FAILURES_FILE, failures);
    await saveJson(OUTPUT_FILE, output);
    
    console.log(`\n${"=".repeat(40)}`);
    console.log(`Retry complete!`);
    console.log(`  Fixed: ${geocoded}`);
    console.log(`  Still failing: ${failed}`);
    return;
  }
  
  const inputData = await loadJson(INPUT_FILE);
  if (!inputData) {
    console.error("No input data found. Run scraper.js first.");
    process.exit(1);
  }
  
  console.log(`Processing ${inputData.length} reports...`);
  console.log(`Cache has ${Object.keys(cache).length} entries\n`);
  
  for (const report of inputData) {
    if (!report.entries?.length) continue;
    
    for (const entry of report.entries) {
      if (processed >= limit) break;
      processed++;
      
      const { address, city, time } = parseEntry(entry);
      const date = report.date;
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
      
      if (processed % 10 === 0) {
        await saveJson(CACHE_FILE, cache);
        await saveJson(FAILURES_FILE, failures);
        await saveJson(OUTPUT_FILE, output);
      }
    }
    if (processed >= limit) break;
  }
  
  const sortedOutput = Object.fromEntries(
    Object.entries(output).sort((a, b) => b[0].localeCompare(a[0]))
  );
  
  await saveJson(CACHE_FILE, cache);
  await saveJson(FAILURES_FILE, failures);
  await saveJson(OUTPUT_FILE, sortedOutput);
  
  console.log(`\n${"=".repeat(40)}`);
  console.log(`Done! Processed: ${processed}`);
  console.log(`  Cached: ${cached}`);
  console.log(`  Geocoded: ${geocoded}`);
  console.log(`  Failed: ${failed} (${outOfBounds} out of bounds)`);
  console.log(`Output: ${OUTPUT_FILE}`);
  console.log(`Failures: ${FAILURES_FILE}`);
}

main().catch(e => console.error("Error:", e.message));