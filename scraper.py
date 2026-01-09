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
API_URL = "https://politi.dk/api/news/getNewsResults"
REGION_NAME = "Østjyllands Politi"
FIRST_REPORT_DATE = "2018/12/14"

PAGE_TIMEOUT = int(os.environ.get("PLAYWRIGHT_TIMEOUT", 60000))

GEOCODE_CACHE_FILE = Path("geocode_cache.json")
GEOCODE_FAILURES_FILE = Path("geocode_failures.json")

OSTJYLLAND_BOUNDS = {"lon_min": 9.5, "lat_min": 55.8, "lon_max": 11.0, "lat_max": 56.6}

AARHUS_SUBURBS = [
    "risskov", "åbyhøj", "brabrand", "viby", "højbjerg", "hasle", "tilst", 
    "skejby", "lisbjerg", "tranbjerg", "mårslet", "beder", "malling", "egå", 
    "lystrup", "hjortshøj", "sabro", "gellerup"
]


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
    address = re.sub(r"\s+\d{4}$", "", address)
    address = re.sub(r"\s+0+(\d+)", r" \1", address)
    return re.sub(r"\s+", " ", address).strip()


def geocode(address: str, city: str, cache: dict, failures: dict) -> tuple[float, float] | None:
    address = sanitize_address(address)
    original_key = f"{address}, {city}"
    
    if city.lower() == "ukendt":
        failures[original_key] = {"reason": "unknown city", "address": address, "city": city}
        return None
    
    # Check cache first
    for city_variant in normalize_city(city):
        query = f"{address}, {city_variant}, Denmark" if city_variant else f"{address}, Denmark"
        if query in cache and cache[query]:
            cached = cache[query]
            if isinstance(cached, list) and len(cached) == 2:
                lat, lon = cached
                if (OSTJYLLAND_BOUNDS['lat_min'] <= lat <= OSTJYLLAND_BOUNDS['lat_max'] and
                    OSTJYLLAND_BOUNDS['lon_min'] <= lon <= OSTJYLLAND_BOUNDS['lon_max']):
                    print(f"    ✓ Cached: {query}")
                    return tuple(cached)
    
    # Make API calls
    viewbox = f"{OSTJYLLAND_BOUNDS['lon_min']},{OSTJYLLAND_BOUNDS['lat_min']},{OSTJYLLAND_BOUNDS['lon_max']},{OSTJYLLAND_BOUNDS['lat_max']}"
    
    for city_variant in normalize_city(city):
        query = f"{address}, {city_variant}, Denmark" if city_variant else f"{address}, Denmark"
        
        try:
            time.sleep(1)
            resp = requests.get("https://nominatim.openstreetmap.org/search",
                params={"format": "json", "q": query, "limit": 5, "viewbox": viewbox, "bounded": 0},
                headers={"User-Agent": "IndbrudScraper/1.0"}, timeout=10)
            
            resp.raise_for_status()
            data = resp.json()
            
            if data:
                for result in data:
                    lat, lon = float(result["lat"]), float(result["lon"])
                    if (OSTJYLLAND_BOUNDS['lat_min'] <= lat <= OSTJYLLAND_BOUNDS['lat_max'] and
                        OSTJYLLAND_BOUNDS['lon_min'] <= lon <= OSTJYLLAND_BOUNDS['lon_max']):
                        cache[query] = (lat, lon)
                        print(f"    ✓ Geocoded: {query}")
                        return (lat, lon)
                
                lat, lon = float(data[0]["lat"]), float(data[0]["lon"])
                cache[query] = (lat, lon)
                print(f"    ⚠ Outside region: {query}")
                return (lat, lon)
        except Exception as e:
            print(f"    ✗ Geocode error: {query} - {e}")
    
    failures[original_key] = {"reason": "not found", "address": address, "city": city}
    return None


def get_report_links(from_date: str, page_num: int) -> list[str]:
    parts = from_date.split("/")
    from_iso = f"{parts[0]}-{parts[1].zfill(2)}-{parts[2].zfill(2)}T00:00:00.000Z"
    to_iso = datetime.now().strftime("%Y-%m-%dT23:59:59.000Z")
    
    print(f"\nFetching page {page_num} from API...")
    
    try:
        resp = requests.get(API_URL,
            params={
                "districtQuery": "OEstjyllands-Politi", "fromDate": from_iso, "toDate": to_iso,
                "isNewsList": "true", "itemId": "90DEB0B1-8DF0-4A2D-823B-CFD7A5ADD85F",
                "language": "da", "newsType": "Døgnrapporter", "page": page_num, "pageSize": 10,
            },
            headers={"User-Agent": "IndbrudScraper/1.0"}, timeout=30)
        resp.raise_for_status()
        
        links = [item["Link"] for item in resp.json().get("NewsList", []) if item.get("Link")]
        for link in links:
            print(f"  Found: {link}")
        return links
    except Exception as e:
        print(f"  API error: {e}")
        return []


def extract_date_from_url(url: str) -> tuple[int, int]:
    match = re.search(r"/(\d{4})/(\d{2})/(\d{2})/?$", url)
    if match:
        return int(match.group(1)), int(match.group(2))
    now = datetime.now()
    return now.year, now.month


def normalize_time_section(text: str) -> str:
    text = re.sub(r"klokken\s*", "kl. ", text, flags=re.IGNORECASE)
    text = re.sub(r"kl\.\s*(\d{1,2}):(\d{2})", r"kl. \1.\2", text)
    text = re.sub(r"(\sog\s+)(\d{1,2})[:.](\d{2})", r"\1kl. \2.\3", text)
    text = re.sub(r"kl\.\s*(\d{2})(\d{2})(?!\d)", r"kl. \1.\2", text)
    text = re.sub(r"(d\.\s*\d{1,2}\.\d{1,2}\.\d{2,4})\s+(\d{1,2})[:.](\d{2})", r"\1 kl. \2.\3", text)
    text = re.sub(r"(\d{1,2})\.(\d{1,2})\.(\d{2,4})", r"\1/\2/\3", text)
    text = re.sub(r"/{2,}", "/", text)
    return re.sub(r"kl\.\s*", "kl. ", text)


def format_date(day: str, month: str, year: str | None, report_year: int, report_month: int) -> str:
    if year:
        return f"{'20' + year if len(year) == 2 else year}-{month.zfill(2)}-{day.zfill(2)}"
    inferred_year = report_year - 1 if int(month) > report_month else report_year
    return f"{inferred_year}-{month.zfill(2)}-{day.zfill(2)}"


def parse_date_time(text: str, report_year: int, report_month: int) -> tuple[str, str] | None:
    text = normalize_time_section(text)
    fmt = lambda d, m, y=None: format_date(d, m, y, report_year, report_month)
    
    patterns = [
        (r"mellem\s+(?:d\.|den)\s*(\d{1,2})/(\d{1,2})/(\d{2,4})\s+kl\.\s*(\d{1,2}\.\d{2})\s+(?:og|til)\s+(?:d\.\s*|den\s+)?(\d{1,2})/(\d{1,2})/(\d{2,4})\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt(m[5], m[6], m[7]), f"{m[1]}/{m[2]} {m[4]} - {m[5]}/{m[6]} {m[8]}")),
        (r"mellem\s+(?:\w+\s+)?d\.\s*(\d{1,2})/(\d{1,2})\s+kl\.\s*(\d{1,2}\.\d{2})\s+og\s+(?:\w+\s+)?d\.\s*(\d{1,2})/(\d{1,2})\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt(m[4], m[5]), f"{m[1]}/{m[2]} {m[3]} - {m[4]}/{m[5]} {m[6]}")),
        (r"mellem\s+den\s+(\d{1,2})/(\d{1,2})\s+kl\.\s*(\d{1,2}\.\d{2})\s+og\s+den\s+(\d{1,2})/(\d{1,2})\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt(m[4], m[5]), f"{m[1]}/{m[2]} {m[3]} - {m[4]}/{m[5]} {m[6]}")),
        (r"(?:d\.|den)\s*(\d{1,2})/(\d{1,2})/(\d{2,4})\s+mellem\s+kl\.\s*(\d{1,2}\.\d{2})\s+og\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt(m[1], m[2], m[3]), f"{m[4]} - {m[5]}")),
        (r"mellem\s+d\.\s*(\d{1,2})/(\d{1,2})/(\d{2,4})\s+kl\.\s*(\d{1,2}\.\d{2})\s+og\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt(m[1], m[2], m[3]), f"{m[4]} - {m[5]}")),
        (r"(?:\w+\s+)?d\.\s*(\d{1,2})/(\d{1,2})\s+mellem\s+kl\.\s*(\d{1,2}\.\d{2})\s+og\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt(m[1], m[2]), f"{m[3]} - {m[4]}")),
        (r"den\s+(\d{1,2})/(\d{1,2})\s+mellem\s+kl\.\s*(\d{1,2}\.\d{2})\s+og\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt(m[1], m[2]), f"{m[3]} - {m[4]}")),
        (r"(?:d\.|den)\s*(\d{1,2})/(\d{1,2})/(\d{2,4})\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt(m[1], m[2], m[3]), m[4])),
        (r"(?:\w+\s+)?d\.\s*(\d{1,2})/(\d{1,2})\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt(m[1], m[2]), m[3])),
        (r"den\s+(\d{1,2})/(\d{1,2})\s+kl\.\s*(\d{1,2}\.\d{2})",
         lambda m: (fmt(m[1], m[2]), m[3])),
    ]
    
    for pattern, extractor in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            try:
                return extractor(match.groups())
            except (ValueError, IndexError):
                continue  # Pattern matched wrong, try next
    return None


def parse_location(text: str) -> tuple[str, str]:
    if m := re.match(r"(.+?)\s+i\s+(.+)$", text):
        return m[1].strip(), m[2].strip()
    if m := re.search(r"^(.+?)\s+(\d{4})\s+(.+)$", text):
        return m[1].strip(), f"{m[2]} {m[3].strip()}"
    return text, "Ukendt"


def parse_entry(text: str, report_year: int, report_month: int) -> dict | None:
    if not text.strip().startswith("På"):
        return None
    if not (m := re.search(r"\s+begået\s+", text, re.IGNORECASE)):
        return None
    
    address, city = parse_location(text[3:m.start()].strip())
    if not (result := parse_date_time(text[m.end():].strip(), report_year, report_month)):
        return None
    
    return {"address": address, "city": city, "date": result[0], "time": result[1]}


def process_entry(entry: dict, geocode_cache: dict, geocode_failures: dict, output_file: Path) -> bool:
    coords = geocode(entry["address"], entry["city"], geocode_cache, geocode_failures)
    
    entry_data = {"address": entry["address"], "time": entry["time"], "source_url": entry["source_url"]}
    if coords:
        entry_data["lat"], entry_data["lon"] = coords
    
    data = load_json(output_file)
    date, region, city = entry["date"], entry["region"], entry["city"]
    data.setdefault(date, {}).setdefault(region, {}).setdefault(city, [])
    
    if entry_data["address"] not in {a["address"] for a in data[date][region][city]}:
        data[date][region][city].append(entry_data)
        save_json(output_file, dict(sorted(data.items(), reverse=True)))
        return True
    return False


def scrape_report(page, url: str, geocode_cache: dict, geocode_failures: dict, output_file: Path) -> int:
    print(f"  Scraping: {url}")
    report_year, report_month = extract_date_from_url(url)
    
    for attempt in range(3):
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=PAGE_TIMEOUT)
            page.wait_for_timeout(2000)
            break
        except Exception as e:
            print(f"    Attempt {attempt + 1} failed: {e}")
            if attempt == 2:
                return 0
    
    content = page.inner_text("body")
    match = re.search(r"(?:^|\n)\s*Indbrud:?(?:\s+i\s+[^\n]+)?\s*\n(.*?)(?=\n[A-ZÆØÅ][a-zæøå]+(?:\s+[a-zæøå]+)?:?\s*\n|\Z)", content, re.DOTALL)
    if not match:
        print(f"    No 'Indbrud' section found")
        return 0
    
    entries = re.split(r"(?:^|\n|\•)\s*\*?\s*(?=På\s+)", match.group(1))
    new_count = 0
    
    for entry_text in entries:
        if parsed := parse_entry(entry_text.strip(), report_year, report_month):
            parsed["region"] = REGION_NAME
            parsed["source_url"] = url
            if process_entry(parsed, geocode_cache, geocode_failures, output_file):
                new_count += 1
    
    save_json(GEOCODE_CACHE_FILE, geocode_cache)
    save_json(GEOCODE_FAILURES_FILE, geocode_failures)
    
    print(f"    Added {new_count} new entries")
    return new_count


def main():
    parser = argparse.ArgumentParser(description="Scrape Østjyllands Politi break-in reports")
    parser.add_argument("-l", "--limit", type=int, default=30, help="Max reports to scrape (default: 30)")
    parser.add_argument("-p", "--pages", type=int, default=3, help="Listing pages to check (default: 3)")
    parser.add_argument("-f", "--from-date", default=FIRST_REPORT_DATE, help=f"Start date (default: {FIRST_REPORT_DATE})")
    parser.add_argument("-o", "--output", default="docs/data.json", help="Output file (default: docs/data.json)")
    parser.add_argument("--all", action="store_true", help="Fetch all historical reports")
    parser.add_argument("--headless", action="store_true", default=True)
    parser.add_argument("--no-headless", action="store_false", dest="headless")
    args = parser.parse_args()
    
    if args.all:
        args.limit, args.pages = 10000, 1000
    
    print(f"\n{'='*50}")
    print(f"Scraping {REGION_NAME} døgnrapporter")
    print("Mode: ALL historical reports" if args.all else f"Limit: {args.limit} | Pages: {args.pages}")
    print('='*50)
    
    output_file = Path(args.output)
    geocode_cache = load_json(GEOCODE_CACHE_FILE)
    geocode_failures = load_json(GEOCODE_FAILURES_FILE)
    total_new = total_reports = 0
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=args.headless)
        page = browser.new_page()
        
        for page_num in range(1, args.pages + 1):
            links = get_report_links(args.from_date, page_num)
            if not links:
                print("No more reports, stopping.")
                break
            
            for link in links:
                if total_reports >= args.limit:
                    break
                total_reports += 1
                print(f"\n[Report {total_reports}] Processing...")
                total_new += scrape_report(page, link, geocode_cache, geocode_failures, output_file)
            
            if total_reports >= args.limit:
                print(f"\nReached limit of {args.limit} reports.")
                break
        
        browser.close()
    
    print(f"\n{'='*50}")
    print(f"Done! Processed {total_reports} reports, added {total_new} new entries")
    print(f"Total dates in file: {len(load_json(output_file))}")


if __name__ == "__main__":
    main()