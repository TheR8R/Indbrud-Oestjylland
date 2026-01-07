import re
import json
import argparse
import time
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright
import requests

BASE_URL = "https://politi.dk"
REGION_SLUG = "oestjyllands-politi"
REGION_NAME = "Østjyllands Politi"

GEOCODE_CACHE_FILE = Path("geocode_cache.json")
GEOCODE_FAILURES_FILE = Path("geocode_failures.json")

# Bounding box for Østjylland region (for geocoding)
OSTJYLLAND_BOUNDS = {
    "lon_min": 9.5,
    "lat_min": 55.8,
    "lon_max": 11.0,
    "lat_max": 56.6,
}

# Aarhus suburbs for geocoding fallbacks
AARHUS_SUBURBS = [
    "risskov", "åbyhøj", "brabrand", "viby", "højbjerg", "hasle",
    "tilst", "skejby", "lisbjerg", "tranbjerg", "mårslet", "beder",
    "malling", "egå", "lystrup", "hjortshøj", "sabro", "gellerup"
]


def load_geocode_cache() -> dict:
    """Load geocoding cache from file."""
    if GEOCODE_CACHE_FILE.exists():
        with open(GEOCODE_CACHE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_geocode_cache(cache: dict):
    """Save geocoding cache to file."""
    with open(GEOCODE_CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


def load_geocode_failures() -> dict:
    """Load geocoding failures from file."""
    if GEOCODE_FAILURES_FILE.exists():
        with open(GEOCODE_FAILURES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_geocode_failures(failures: dict):
    """Save geocoding failures to file."""
    with open(GEOCODE_FAILURES_FILE, "w", encoding="utf-8") as f:
        json.dump(failures, f, ensure_ascii=False, indent=2)


def normalize_city(city: str) -> list[str]:
    """Generate city name variations for geocoding."""
    variations = [city]
    
    # Remove directional suffixes (Aarhus C -> Aarhus, Randers SØ -> Randers)
    base = re.sub(r"\s+[NCSVØ]+$", "", city, flags=re.IGNORECASE)
    if base != city:
        variations.append(base)
    
    # Handle postal code format (8270 Højbjerg -> Højbjerg)
    no_postal = re.sub(r"^\d{4}\s+", "", city)
    if no_postal != city:
        variations.append(no_postal)
    
    # Aarhus suburbs - try with "Aarhus" appended
    if city.lower() in AARHUS_SUBURBS:
        variations.append(f"{city}, Aarhus")
        variations.append("Aarhus")
    
    # Last resort: just try without city (street + Denmark)
    variations.append("")
    
    return variations


def sanitize_address(address: str) -> str:
    """Clean up common address formatting issues."""
    original = address
    
    # Remove postal codes embedded in address (e.g., "Espedalen 066 8240" -> "Espedalen 66")
    address = re.sub(r"\s+\d{4}$", "", address)  # trailing postal code
    
    # Fix leading zeros in house numbers (066 -> 66)
    address = re.sub(r"\s+0+(\d+)", r" \1", address)
    
    # Remove extra whitespace
    address = re.sub(r"\s+", " ", address).strip()
    
    if address != original:
        print(f"    Sanitized: '{original}' -> '{address}'")
    
    return address


def geocode(address: str, city: str, cache: dict, failures: dict) -> tuple[float, float] | None:
    """Geocode an address using Nominatim. Returns (lat, lon) or None."""
    
    address = sanitize_address(address)
    original_key = f"{address}, {city}"
    
    if city.lower() == "ukendt":
        print(f"    ✗ Skipped (unknown city): {address}")
        failures[original_key] = {"reason": "unknown city", "address": address, "city": city}
        return None
    
    viewbox = f"{OSTJYLLAND_BOUNDS['lon_min']},{OSTJYLLAND_BOUNDS['lat_min']},{OSTJYLLAND_BOUNDS['lon_max']},{OSTJYLLAND_BOUNDS['lat_max']}"
    
    for city_variant in normalize_city(city):
        query = f"{address}, {city_variant}, Denmark" if city_variant else f"{address}, Denmark"
        
        if query in cache and cache[query] is not None:
            cached = cache[query]
            if isinstance(cached, list) and len(cached) == 2:
                lat, lon = cached
                if (OSTJYLLAND_BOUNDS['lat_min'] <= lat <= OSTJYLLAND_BOUNDS['lat_max'] and
                    OSTJYLLAND_BOUNDS['lon_min'] <= lon <= OSTJYLLAND_BOUNDS['lon_max']):
                    return tuple(cached)
        
        try:
            time.sleep(1)
            
            resp = requests.get(
                "https://nominatim.openstreetmap.org/search",
                params={
                    "format": "json",
                    "q": query,
                    "limit": 5,
                    "viewbox": viewbox,
                    "bounded": 0,
                },
                headers={"User-Agent": "IndbrudScraper/1.0"},
                timeout=10
            )
            resp.raise_for_status()
            data = resp.json()
            
            if data:
                for result in data:
                    lat, lon = float(result["lat"]), float(result["lon"])
                    if (OSTJYLLAND_BOUNDS['lat_min'] <= lat <= OSTJYLLAND_BOUNDS['lat_max'] and
                        OSTJYLLAND_BOUNDS['lon_min'] <= lon <= OSTJYLLAND_BOUNDS['lon_max']):
                        coords = (lat, lon)
                        cache[query] = coords
                        print(f"    ✓ Geocoded: {query}")
                        return coords
                
                lat, lon = float(data[0]["lat"]), float(data[0]["lon"])
                coords = (lat, lon)
                cache[query] = coords
                print(f"    ⚠ Geocoded (outside region): {query} -> ({lat:.2f}, {lon:.2f})")
                return coords
                
        except Exception as e:
            print(f"    ✗ Geocode error: {query} - {e}")
    
    print(f"    ✗ Geocode failed: {address}, {city}")
    failures[original_key] = {
        "reason": "not found",
        "address": address,
        "city": city,
        "tried": [f"{address}, {v}, Denmark" if v else f"{address}, Denmark" for v in normalize_city(city)]
    }
    return None


def get_report_links(page, region_filter: str | None = None, limit: int = 5, pages: int = 1) -> list[str]:
    """Fetch report links from the døgnrapporter listing pages."""
    links = []
    
    for page_num in range(1, pages + 1):
        url = f"{BASE_URL}/doegnrapporter?page={page_num}"
        print(f"Fetching page {page_num}: {url}")
        
        page.goto(url, wait_until="networkidle")
        page.wait_for_selector("a[href*='/doegnrapporter/']", timeout=10000)
        
        for link_el in page.query_selector_all("a[href*='/doegnrapporter/']"):
            href = link_el.get_attribute("href")
            if not href or href.rstrip("/").endswith("/doegnrapporter"):
                continue
            if not re.search(r"/\d{4}/\d{2}/\d{2}", href):
                continue
            if region_filter and region_filter not in href:
                continue
            
            full_url = href if href.startswith("http") else BASE_URL + href
            if full_url not in links:
                links.append(full_url)
                print(f"  Found: {full_url}")
                if len(links) >= limit:
                    break
        
        if len(links) >= limit:
            break
        page.wait_for_timeout(500)
    
    print(f"Found {len(links)} report links")
    return links


def extract_date_from_url(url: str) -> tuple[str | None, int, int]:
    """Extract date string, year and month from URL pattern /YYYY/MM/DD."""
    match = re.search(r"/(\d{4})/(\d{2})/(\d{2})/?$", url)
    if match:
        return f"{match.group(1)}-{match.group(2)}-{match.group(3)}", int(match.group(1)), int(match.group(2))
    now = datetime.now()
    return None, now.year, now.month


def normalize_time_section(text: str) -> str:
    """Normalize the messy time/date formats into something parseable."""
    # klokken -> kl.
    text = re.sub(r"klokken\s*", "kl. ", text, flags=re.IGNORECASE)
    
    # Time with colon -> dot (09:00 -> 09.00)
    text = re.sub(r"kl\.\s*(\d{1,2}):(\d{2})", r"kl. \1.\2", text)
    
    # Standalone times after "og" (og 22:30 -> og kl. 22.30)
    text = re.sub(r"(\sog\s+)(\d{1,2})[:.](\d{2})", r"\1kl. \2.\3", text)
    
    # Times without separator (kl. 1200 -> kl. 12.00)
    text = re.sub(r"kl\.\s*(\d{2})(\d{2})(?!\d)", r"kl. \1.\2", text)
    
    # Time after d. DD.MM.YY without kl. (d. 25.12.25 11:12 -> d. 25.12.25 kl. 11.12)
    text = re.sub(r"(d\.\s*\d{1,2}\.\d{1,2}\.\d{2,4})\s+(\d{1,2})[:.](\d{2})", r"\1 kl. \2.\3", text)
    
    # Date with dots -> slashes (23.12.25 -> 23/12/25)
    text = re.sub(r"(\d{1,2})\.(\d{1,2})\.(\d{2,4})", r"\1/\2/\3", text)
    
    # Double slashes (typo)
    text = re.sub(r"/{2,}", "/", text)
    
    # Normalize spacing around kl.
    text = re.sub(r"kl\.\s*", "kl. ", text)
    
    return text


def parse_date_time(time_section: str, report_year: int, report_month: int) -> tuple[str, str] | None:
    """
    Parse normalized time section and return (date_str, time_str) or None.
    Handles many Danish police report date/time formats.
    """
    time_section = normalize_time_section(time_section)
    
    # Helper to format dates with year boundary handling
    def fmt_date(day, month, year=None):
        return format_date(day, month, year, report_year, report_month)
    
    # Patterns ordered from most specific to least specific
    patterns = [
        # Date range with year: "mellem d./den DD/MM/YY kl. HH.MM og/til [d./den] DD/MM/YY kl. HH.MM"
        (r"mellem\s+(?:d\.|den)\s*(\d{1,2})/(\d{1,2})/(\d{2,4})\s+kl\.\s*(\d{1,2}\.\d{2})\s+(?:og|til)\s+(?:d\.\s*|den\s+)?(\d{1,2})/(\d{1,2})/(\d{2,4})\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt_date(m.group(5), m.group(6), m.group(7)),
                    f"{m.group(1)}/{m.group(2)} {m.group(4)} - {m.group(5)}/{m.group(6)} {m.group(8)}")),
        
        # Date range without year: "mellem [weekday] d. DD/MM kl. HH.MM og [weekday] d. DD/MM kl. HH.MM"
        (r"mellem\s+(?:\w+\s+)?d\.\s*(\d{1,2})/(\d{1,2})\s+kl\.\s*(\d{1,2}\.\d{2})\s+og\s+(?:\w+\s+)?d\.\s*(\d{1,2})/(\d{1,2})\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt_date(m.group(4), m.group(5)),
                    f"{m.group(1)}/{m.group(2)} {m.group(3)} - {m.group(4)}/{m.group(5)} {m.group(6)}")),
        
        # Date range: "mellem den DD/MM kl. HH.MM og den DD/MM kl. HH.MM"
        (r"mellem\s+den\s+(\d{1,2})/(\d{1,2})\s+kl\.\s*(\d{1,2}\.\d{2})\s+og\s+den\s+(\d{1,2})/(\d{1,2})\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt_date(m.group(4), m.group(5)),
                    f"{m.group(1)}/{m.group(2)} {m.group(3)} - {m.group(4)}/{m.group(5)} {m.group(6)}")),
        
        # Same day time range with year: "d./den DD/MM/YY mellem kl. HH.MM og kl. HH.MM"
        (r"(?:d\.|den)\s*(\d{1,2})/(\d{1,2})/(\d{2,4})\s+mellem\s+kl\.\s*(\d{1,2}\.\d{2})\s+og\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt_date(m.group(1), m.group(2), m.group(3)),
                    f"{m.group(4)} - {m.group(5)}")),
        
        # Same day time range: "mellem d. DD/MM/YY kl. HH.MM og kl. HH.MM"
        (r"mellem\s+d\.\s*(\d{1,2})/(\d{1,2})/(\d{2,4})\s+kl\.\s*(\d{1,2}\.\d{2})\s+og\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt_date(m.group(1), m.group(2), m.group(3)),
                    f"{m.group(4)} - {m.group(5)}")),
        
        # Same day time range without year: "[weekday] d. DD/MM mellem kl. HH.MM og kl. HH.MM"
        (r"(?:\w+\s+)?d\.\s*(\d{1,2})/(\d{1,2})\s+mellem\s+kl\.\s*(\d{1,2}\.\d{2})\s+og\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt_date(m.group(1), m.group(2)),
                    f"{m.group(3)} - {m.group(4)}")),
        
        # Same day time range: "den DD/MM mellem kl. HH.MM og kl. HH.MM"
        (r"den\s+(\d{1,2})/(\d{1,2})\s+mellem\s+kl\.\s*(\d{1,2}\.\d{2})\s+og\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt_date(m.group(1), m.group(2)),
                    f"{m.group(3)} - {m.group(4)}")),
        
        # Single datetime with year: "d./den DD/MM/YY kl. HH.MM"
        (r"(?:d\.|den)\s*(\d{1,2})/(\d{1,2})/(\d{2,4})\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt_date(m.group(1), m.group(2), m.group(3)), m.group(4))),
        
        # Single datetime: "[weekday] d. DD/MM kl. HH.MM"
        (r"(?:\w+\s+)?d\.\s*(\d{1,2})/(\d{1,2})\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt_date(m.group(1), m.group(2)), m.group(3))),
        
        # Single datetime: "den DD/MM kl. HH.MM"
        (r"den\s+(\d{1,2})/(\d{1,2})\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt_date(m.group(1), m.group(2)), m.group(3))),
    ]
    
    for pattern, extractor in patterns:
        match = re.search(pattern, time_section, re.IGNORECASE)
        if match:
            return extractor(match)
    
    return None


def format_date(day: str, month: str, year: str | None, report_year: int, report_month: int) -> str:
    """Format date components into YYYY-MM-DD, handling 2-digit years and year boundaries."""
    if year:
        if len(year) == 2:
            year = "20" + year
        return f"{year}-{month.zfill(2)}-{day.zfill(2)}"
    
    # No year provided - infer from report date
    incident_month = int(month)
    
    # If incident month > report month, it must be from previous year
    # e.g., incident in December (12), report in January (1)
    if incident_month > report_month:
        inferred_year = report_year - 1
    else:
        inferred_year = report_year
    
    return f"{inferred_year}-{month.zfill(2)}-{day.zfill(2)}"


def parse_location(location_text: str) -> tuple[str, str]:
    """Parse location into (address, city)."""
    # Format 1: "street i city"
    match = re.match(r"(.+?)\s+i\s+(.+)$", location_text)
    if match:
        return match.group(1).strip(), match.group(2).strip()
    
    # Format 2: "street number postal_code city"
    match = re.search(r"^(.+?)\s+(\d{4})\s+(.+)$", location_text)
    if match:
        return match.group(1).strip(), f"{match.group(2)} {match.group(3).strip()}"
    
    return location_text, "Ukendt"


def parse_indbrud_entry(text: str, report_year: int, report_month: int) -> dict | None:
    """Parse a single break-in entry."""
    if not text.strip().startswith("På"):
        return None
    
    # Split on "begået"
    match = re.search(r"\s+begået\s+", text, re.IGNORECASE)
    if not match:
        return None
    
    location_text = text[3:match.start()].strip()
    time_section = text[match.end():].strip()
    
    address, city = parse_location(location_text)
    result = parse_date_time(time_section, report_year, report_month)
    
    if not result:
        print(f"    Could not parse time from: {time_section[:80]}")
        return None
    
    date_str, time_str = result
    return {"address": address, "city": city, "date": date_str, "time": time_str}


def scrape_report(page, url: str) -> list[dict]:
    """Scrape a single report page for break-in entries."""
    print(f"  Scraping: {url}")
    
    _, report_year, report_month = extract_date_from_url(url)
    
    page.goto(url, wait_until="networkidle")
    page.wait_for_timeout(1000)
    
    content = page.inner_text("body")
    
    match = re.search(r"(?:^|\n)\s*Indbrud(?:\s+i\s+[^\n]+)?\s*\n(.*?)(?=\n[A-ZÆØÅ][a-zæøå]+(?:\s+[a-zæøå]+)?\s*\n|\Z)", content, re.DOTALL)
    if not match:
        print(f"    No 'Indbrud' section found")
        return []
    
    entries = re.split(r"(?:^|\n)\s*\*?\s*(?=På\s+)", match.group(1))
    
    results = []
    for entry in entries:
        parsed = parse_indbrud_entry(entry.strip(), report_year, report_month)
        if parsed:
            parsed["region"] = REGION_NAME
            parsed["source_url"] = url
            results.append(parsed)
    
    print(f"    Found {len(results)} break-in entries")
    return results


def structure_data(entries: list[dict], geocode_cache: dict, geocode_failures: dict) -> dict:
    """Structure entries by date -> region -> city -> addresses, with geocoding."""
    structured = {}
    for e in entries:
        date, region, city = e["date"], e["region"], e["city"]
        
        # Geocode if not already done
        coords = geocode(e["address"], city, geocode_cache, geocode_failures)
        
        entry_data = {
            "address": e["address"],
            "time": e["time"],
            "source_url": e["source_url"],
        }
        if coords:
            entry_data["lat"] = coords[0]
            entry_data["lon"] = coords[1]
        
        structured.setdefault(date, {}).setdefault(region, {}).setdefault(city, []).append(entry_data)
    
    return dict(sorted(structured.items(), reverse=True))


def merge_data(existing: dict, new: dict) -> dict:
    """Merge new data into existing, avoiding duplicates."""
    for date, regions in new.items():
        if date not in existing:
            existing[date] = regions
            continue
        for region, cities in regions.items():
            if region not in existing[date]:
                existing[date][region] = cities
                continue
            for city, addresses in cities.items():
                if city not in existing[date][region]:
                    existing[date][region][city] = addresses
                else:
                    existing_addrs = {a["address"] for a in existing[date][region][city]}
                    for addr in addresses:
                        if addr["address"] not in existing_addrs:
                            existing[date][region][city].append(addr)
    return dict(sorted(existing.items(), reverse=True))


def load_json(path: Path) -> dict:
    """Load JSON file or return empty dict."""
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_json(path: Path, data: dict):
    """Save data to JSON file."""
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def main():
    parser = argparse.ArgumentParser(description="Scrape Danish police break-in reports")
    parser.add_argument("-r", "--region", default="oestjyllands-politi",
                        help="Region filter (e.g. 'oestjyllands-politi'). Use 'all' for all regions.")
    parser.add_argument("-l", "--limit", type=int, default=30,
                        help="Maximum number of reports to scrape (default: 30)")
    parser.add_argument("-p", "--pages", type=int, default=3,
                        help="Number of listing pages to check (default: 3)")
    parser.add_argument("-o", "--output", default="docs/data.json",
                        help="Output file path (default: data.json)")
    parser.add_argument("--headless", action="store_true", default=True,
                        help="Run browser in headless mode (default: True)")
    parser.add_argument("--no-headless", action="store_false", dest="headless",
                        help="Run browser with visible window (for debugging)")
    args = parser.parse_args()
    
    output_file = Path(args.output)
    region_filter = None if args.region == "all" else args.region
    
    print(f"\n{'='*50}")
    print(f"Scraping døgnrapporter")
    print(f"Region: {region_filter or 'all'}")
    print(f"Limit: {args.limit} | Pages: {args.pages}")
    print('='*50)
    
    all_entries = []
    geocode_cache = load_geocode_cache()
    geocode_failures = load_geocode_failures()
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=args.headless)
        page = browser.new_page()
        
        links = get_report_links(page, region_filter=region_filter, limit=args.limit, pages=args.pages)
        for link in links:
            all_entries.extend(scrape_report(page, link))
        
        browser.close()
    
    print(f"\nGeocoding addresses...")
    new_data = structure_data(all_entries, geocode_cache, geocode_failures)
    save_geocode_cache(geocode_cache)
    save_geocode_failures(geocode_failures)
    
    existing_data = load_json(output_file)
    merged_data = merge_data(existing_data, new_data)
    save_json(output_file, merged_data)
    
    print(f"\n{'='*50}")
    print(f"Done! Saved {len(all_entries)} entries to {output_file}")
    print(f"Total dates in file: {len(merged_data)}")
    if geocode_failures:
        print(f"Geocode failures: {len(geocode_failures)} (see geocode_failures.json)")


if __name__ == "__main__":
    main()