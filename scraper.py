import re
import json
import argparse
import time
import os
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright
import requests

BASE_URL = "https://politi.dk"
REGION_SLUG = "oestjyllands-politi"
REGION_NAME = "Østjyllands Politi"

PAGE_TIMEOUT = int(os.environ.get("PLAYWRIGHT_TIMEOUT", 60000))
LOCATIONIQ_API_KEY = os.environ.get("LOCATIONIQ_API_KEY", "")

GEOCODE_CACHE_FILE = Path("geocode_cache.json")
GEOCODE_FAILURES_FILE = Path("geocode_failures.json")

OSTJYLLAND_BOUNDS = {
    "lon_min": 9.5, "lat_min": 55.8,
    "lon_max": 11.0, "lat_max": 56.6,
}

AARHUS_SUBURBS = [
    "risskov", "åbyhøj", "brabrand", "viby", "højbjerg", "hasle",
    "tilst", "skejby", "lisbjerg", "tranbjerg", "mårslet", "beder",
    "malling", "egå", "lystrup", "hjortshøj", "sabro", "gellerup"
]


FIRST_REPORT_DATE = "2018/12/14"  # First Østjylland døgnrapport


def load_geocode_cache() -> dict:
    if GEOCODE_CACHE_FILE.exists():
        with open(GEOCODE_CACHE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_geocode_cache(cache: dict):
    with open(GEOCODE_CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


def load_geocode_failures() -> dict:
    if GEOCODE_FAILURES_FILE.exists():
        with open(GEOCODE_FAILURES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_geocode_failures(failures: dict):
    with open(GEOCODE_FAILURES_FILE, "w", encoding="utf-8") as f:
        json.dump(failures, f, ensure_ascii=False, indent=2)


def load_json(path: Path) -> dict:
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_json(path: Path, data: dict):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def normalize_city(city: str) -> list[str]:
    variations = [city]
    base = re.sub(r"\s+[NCSVØ]+$", "", city, flags=re.IGNORECASE)
    if base != city:
        variations.append(base)
    no_postal = re.sub(r"^\d{4}\s+", "", city)
    if no_postal != city:
        variations.append(no_postal)
    if city.lower() in AARHUS_SUBURBS:
        variations.append(f"{city}, Aarhus")
        variations.append("Aarhus")
    variations.append("")
    return variations


def sanitize_address(address: str) -> str:
    original = address
    address = re.sub(r"\s+\d{4}$", "", address)
    address = re.sub(r"\s+0+(\d+)", r" \1", address)
    address = re.sub(r"\s+", " ", address).strip()
    if address != original:
        print(f"    Sanitized: '{original}' -> '{address}'")
    return address


def geocode(address: str, city: str, cache: dict, failures: dict) -> tuple[float, float] | None:
    address = sanitize_address(address)
    original_key = f"{address}, {city}"
    
    if city.lower() == "ukendt":
        print(f"    ✗ Skipped (unknown city): {address}")
        failures[original_key] = {"reason": "unknown city", "address": address, "city": city}
        return None
    
    # Check cache first for all city variations
    for city_variant in normalize_city(city):
        query = f"{address}, {city_variant}, Denmark" if city_variant else f"{address}, Denmark"
        if query in cache and cache[query] is not None:
            cached = cache[query]
            if isinstance(cached, list) and len(cached) == 2:
                lat, lon = cached
                if (OSTJYLLAND_BOUNDS['lat_min'] <= lat <= OSTJYLLAND_BOUNDS['lat_max'] and
                    OSTJYLLAND_BOUNDS['lon_min'] <= lon <= OSTJYLLAND_BOUNDS['lon_max']):
                    print(f"    ✓ Cached: {query}")
                    return tuple(cached)
    
    # Not in cache, make API calls
    viewbox = f"{OSTJYLLAND_BOUNDS['lon_min']},{OSTJYLLAND_BOUNDS['lat_min']},{OSTJYLLAND_BOUNDS['lon_max']},{OSTJYLLAND_BOUNDS['lat_max']}"
    
    for city_variant in normalize_city(city):
        query = f"{address}, {city_variant}, Denmark" if city_variant else f"{address}, Denmark"
        
        try:
            time.sleep(1)
            
            if LOCATIONIQ_API_KEY:
                resp = requests.get(
                    "https://us1.locationiq.com/v1/search.php",
                    params={
                        "key": LOCATIONIQ_API_KEY,
                        "q": query,
                        "format": "json",
                        "limit": 5,
                        "viewbox": viewbox,
                        "bounded": 0,
                    },
                    timeout=10
                )
            else:
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


def get_report_links_from_page(page, page_num: int, from_date: str) -> list[str]:
    today = datetime.now().strftime("%Y/%-m/%-d")
    url = f"{BASE_URL}/aktuelt/doegnrapporter?fromDate={from_date}&toDate={today}&newsType=Doegnrapporter&page={page_num}&district=OEstjyllands-Politi"
    print(f"\nFetching page {page_num}: {url}")
    
    for attempt in range(3):
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=PAGE_TIMEOUT)
            page.wait_for_timeout(3000)
            break
        except Exception as e:
            print(f"  Attempt {attempt + 1} failed: {e}")
            if attempt == 2:
                raise
    
    try:
        page.wait_for_selector("a[href*='/doegnrapporter/']", timeout=PAGE_TIMEOUT)
    except Exception:
        print(f"  No reports found on page {page_num}")
        return []
    
    links = []
    for link_el in page.query_selector_all("a[href*='/doegnrapporter/']"):
        href = link_el.get_attribute("href")
        if not href or href.rstrip("/").endswith("/doegnrapporter"):
            continue
        if not re.search(r"/\d{4}/\d{2}/\d{2}", href):
            continue
        full_url = href if href.startswith("http") else BASE_URL + href
        if full_url not in links:
            links.append(full_url)
            print(f"  Found: {full_url}")
    
    return links


def extract_date_from_url(url: str) -> tuple[str | None, int, int]:
    match = re.search(r"/(\d{4})/(\d{2})/(\d{2})/?$", url)
    if match:
        return f"{match.group(1)}-{match.group(2)}-{match.group(3)}", int(match.group(1)), int(match.group(2))
    now = datetime.now()
    return None, now.year, now.month


def normalize_time_section(text: str) -> str:
    text = re.sub(r"klokken\s*", "kl. ", text, flags=re.IGNORECASE)
    text = re.sub(r"kl\.\s*(\d{1,2}):(\d{2})", r"kl. \1.\2", text)
    text = re.sub(r"(\sog\s+)(\d{1,2})[:.](\d{2})", r"\1kl. \2.\3", text)
    text = re.sub(r"kl\.\s*(\d{2})(\d{2})(?!\d)", r"kl. \1.\2", text)
    text = re.sub(r"(d\.\s*\d{1,2}\.\d{1,2}\.\d{2,4})\s+(\d{1,2})[:.](\d{2})", r"\1 kl. \2.\3", text)
    text = re.sub(r"(\d{1,2})\.(\d{1,2})\.(\d{2,4})", r"\1/\2/\3", text)
    text = re.sub(r"/{2,}", "/", text)
    text = re.sub(r"kl\.\s*", "kl. ", text)
    return text


def format_date(day: str, month: str, year: str | None, report_year: int, report_month: int) -> str:
    if year:
        if len(year) == 2:
            year = "20" + year
        return f"{year}-{month.zfill(2)}-{day.zfill(2)}"
    incident_month = int(month)
    if incident_month > report_month:
        inferred_year = report_year - 1
    else:
        inferred_year = report_year
    return f"{inferred_year}-{month.zfill(2)}-{day.zfill(2)}"


def parse_date_time(time_section: str, report_year: int, report_month: int) -> tuple[str, str] | None:
    time_section = normalize_time_section(time_section)
    
    def fmt_date(day, month, year=None):
        return format_date(day, month, year, report_year, report_month)
    
    patterns = [
        (r"mellem\s+(?:d\.|den)\s*(\d{1,2})/(\d{1,2})/(\d{2,4})\s+kl\.\s*(\d{1,2}\.\d{2})\s+(?:og|til)\s+(?:d\.\s*|den\s+)?(\d{1,2})/(\d{1,2})/(\d{2,4})\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt_date(m.group(5), m.group(6), m.group(7)), f"{m.group(1)}/{m.group(2)} {m.group(4)} - {m.group(5)}/{m.group(6)} {m.group(8)}")),
        (r"mellem\s+(?:\w+\s+)?d\.\s*(\d{1,2})/(\d{1,2})\s+kl\.\s*(\d{1,2}\.\d{2})\s+og\s+(?:\w+\s+)?d\.\s*(\d{1,2})/(\d{1,2})\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt_date(m.group(4), m.group(5)), f"{m.group(1)}/{m.group(2)} {m.group(3)} - {m.group(4)}/{m.group(5)} {m.group(6)}")),
        (r"mellem\s+den\s+(\d{1,2})/(\d{1,2})\s+kl\.\s*(\d{1,2}\.\d{2})\s+og\s+den\s+(\d{1,2})/(\d{1,2})\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt_date(m.group(4), m.group(5)), f"{m.group(1)}/{m.group(2)} {m.group(3)} - {m.group(4)}/{m.group(5)} {m.group(6)}")),
        (r"(?:d\.|den)\s*(\d{1,2})/(\d{1,2})/(\d{2,4})\s+mellem\s+kl\.\s*(\d{1,2}\.\d{2})\s+og\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt_date(m.group(1), m.group(2), m.group(3)), f"{m.group(4)} - {m.group(5)}")),
        (r"mellem\s+d\.\s*(\d{1,2})/(\d{1,2})/(\d{2,4})\s+kl\.\s*(\d{1,2}\.\d{2})\s+og\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt_date(m.group(1), m.group(2), m.group(3)), f"{m.group(4)} - {m.group(5)}")),
        (r"(?:\w+\s+)?d\.\s*(\d{1,2})/(\d{1,2})\s+mellem\s+kl\.\s*(\d{1,2}\.\d{2})\s+og\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt_date(m.group(1), m.group(2)), f"{m.group(3)} - {m.group(4)}")),
        (r"den\s+(\d{1,2})/(\d{1,2})\s+mellem\s+kl\.\s*(\d{1,2}\.\d{2})\s+og\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt_date(m.group(1), m.group(2)), f"{m.group(3)} - {m.group(4)}")),
        (r"(?:d\.|den)\s*(\d{1,2})/(\d{1,2})/(\d{2,4})\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt_date(m.group(1), m.group(2), m.group(3)), m.group(4))),
        (r"(?:\w+\s+)?d\.\s*(\d{1,2})/(\d{1,2})\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt_date(m.group(1), m.group(2)), m.group(3))),
        (r"den\s+(\d{1,2})/(\d{1,2})\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt_date(m.group(1), m.group(2)), m.group(3))),
    ]
    
    for pattern, extractor in patterns:
        match = re.search(pattern, time_section, re.IGNORECASE)
        if match:
            return extractor(match)
    return None


def parse_location(location_text: str) -> tuple[str, str]:
    match = re.match(r"(.+?)\s+i\s+(.+)$", location_text)
    if match:
        return match.group(1).strip(), match.group(2).strip()
    match = re.search(r"^(.+?)\s+(\d{4})\s+(.+)$", location_text)
    if match:
        return match.group(1).strip(), f"{match.group(2)} {match.group(3).strip()}"
    return location_text, "Ukendt"


def parse_indbrud_entry(text: str, report_year: int, report_month: int) -> dict | None:
    if not text.strip().startswith("På"):
        return None
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


def process_and_save_entry(entry: dict, geocode_cache: dict, geocode_failures: dict, output_file: Path):
    coords = geocode(entry["address"], entry["city"], geocode_cache, geocode_failures)
    
    entry_data = {
        "address": entry["address"],
        "time": entry["time"],
        "source_url": entry["source_url"],
    }
    if coords:
        entry_data["lat"] = coords[0]
        entry_data["lon"] = coords[1]
    
    existing_data = load_json(output_file)
    date, region, city = entry["date"], entry["region"], entry["city"]
    existing_data.setdefault(date, {}).setdefault(region, {}).setdefault(city, [])
    
    existing_addrs = {a["address"] for a in existing_data[date][region][city]}
    if entry_data["address"] not in existing_addrs:
        existing_data[date][region][city].append(entry_data)
        sorted_data = dict(sorted(existing_data.items(), reverse=True))
        save_json(output_file, sorted_data)
        return True
    return False


def scrape_and_process_report(page, url: str, geocode_cache: dict, geocode_failures: dict, output_file: Path) -> int:
    print(f"  Scraping: {url}")
    
    _, report_year, report_month = extract_date_from_url(url)
    
    for attempt in range(3):
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=PAGE_TIMEOUT)
            page.wait_for_timeout(2000)
            break
        except Exception as e:
            print(f"    Attempt {attempt + 1} failed: {e}")
            if attempt == 2:
                print(f"    Skipping {url} after 3 failed attempts")
                return 0
    
    content = page.inner_text("body")
    
    match = re.search(r"(?:^|\n)\s*Indbrud:?(?:\s+i\s+[^\n]+)?\s*\n(.*?)(?=\n[A-ZÆØÅ][a-zæøå]+(?:\s+[a-zæøå]+)?:?\s*\n|\Z)", content, re.DOTALL)
    if not match:
        print(f"    No 'Indbrud' section found")
        return 0
    
    entries = re.split(r"(?:^|\n|\•)\s*\*?\s*(?=På\s+)", match.group(1))
    
    new_count = 0
    for entry in entries:
        parsed = parse_indbrud_entry(entry.strip(), report_year, report_month)
        if parsed:
            parsed["region"] = REGION_NAME
            parsed["source_url"] = url
            if process_and_save_entry(parsed, geocode_cache, geocode_failures, output_file):
                new_count += 1
    
    save_geocode_cache(geocode_cache)
    save_geocode_failures(geocode_failures)
    
    print(f"    Added {new_count} new entries")
    return new_count


def main():
    parser = argparse.ArgumentParser(description="Scrape Østjyllands Politi break-in reports")
    parser.add_argument("-l", "--limit", type=int, default=30,
                        help="Maximum number of reports to scrape (default: 30)")
    parser.add_argument("-p", "--pages", type=int, default=3,
                        help="Number of listing pages to check (default: 3)")
    parser.add_argument("-f", "--from-date", default=FIRST_REPORT_DATE,
                        help=f"Start date for reports (default: {FIRST_REPORT_DATE})")
    parser.add_argument("-o", "--output", default="docs/data.json",
                        help="Output file path (default: docs/data.json)")
    parser.add_argument("--all", action="store_true",
                        help="Fetch all historical reports (sets high limit and pages)")
    parser.add_argument("--headless", action="store_true", default=True,
                        help="Run browser in headless mode (default: True)")
    parser.add_argument("--no-headless", action="store_false", dest="headless",
                        help="Run browser with visible window (for debugging)")
    args = parser.parse_args()
    
    # Override limit and pages if --all is set
    if args.all:
        args.limit = 10000
        args.pages = 1000
        args.from_date = FIRST_REPORT_DATE
    
    output_file = Path(args.output)
    
    print(f"\n{'='*50}")
    print(f"Scraping {REGION_NAME} døgnrapporter")
    if args.all:
        print("Mode: ALL historical reports")
    else:
        print(f"Limit: {args.limit} | Pages: {args.pages}", end="")
        if args.from_date != FIRST_REPORT_DATE:
            print(f" | From: {args.from_date}", end="")
        print()
    print('='*50)
    
    geocode_cache = load_geocode_cache()
    geocode_failures = load_geocode_failures()
    total_new = 0
    total_reports = 0
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=args.headless)
        page = browser.new_page()
        
        for page_num in range(1, args.pages + 1):
            links = get_report_links_from_page(page, page_num, args.from_date)
            
            if not links:
                print(f"No more reports, stopping.")
                break
            
            for link in links:
                if total_reports >= args.limit:
                    break
                
                total_reports += 1
                print(f"\n[Report {total_reports}] Processing...")
                new_entries = scrape_and_process_report(page, link, geocode_cache, geocode_failures, output_file)
                total_new += new_entries
            
            if total_reports >= args.limit:
                print(f"\nReached limit of {args.limit} reports.")
                break
        
        browser.close()
    
    final_data = load_json(output_file)
    print(f"\n{'='*50}")
    print(f"Done! Processed {total_reports} reports, added {total_new} new entries")
    print(f"Total dates in file: {len(final_data)}")
    if geocode_failures:
        print(f"Geocode failures: {len(geocode_failures)} (see geocode_failures.json)")


if __name__ == "__main__":
    main()