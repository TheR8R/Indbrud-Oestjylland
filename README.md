# Indbrudskort Østjylland

An interactive map showing break-ins in Østjylland, Denmark, scraped from Østjyllands Politi's daily reports.

🗺️ **[View the map](https://ther8r.github.io/Indbrud-Oestjylland/)**

## How It Works

### Scraper (`scraper.py`)

Fetches break-in data from Østjyllands Politi's daily reports (døgnrapporter).

**Technology:** Python, Playwright (headless Chromium), LocationIQ/Nominatim

**Flow:**
1. For each listing page:
   - Fetches report links from `politi.dk/doegnrapporter`
   - For each report on that page:
     - Scrapes the "Indbrud" (break-in) section
     - Geocodes addresses using LocationIQ (or Nominatim as fallback)
     - Saves to `data.json` and geocode cache immediately
2. Crash-safe: progress is saved after each report, so no work is lost if interrupted

### Frontend (`docs/`)

Static site hosted on GitHub Pages.

**Technology:** Vanilla JS, Leaflet, OpenStreetMap

**Features:**
- Interactive map with marker clustering
- Date range slider to filter by time period
- Popups with address, city, date, and time

## Usage

### Prerequisites

```bash
pip install playwright requests
playwright install chromium --with-deps
```

### Run the scraper

```bash
# Default: 30 reports, 3 pages
python scraper.py

# Quick update (latest reports only)
python scraper.py -l 5 -p 1

# Fetch ALL historical reports (since Dec 2018)
python scraper.py --all

# From a specific date
python scraper.py -f "2020/1/1" -l 500 -p 50

# With LocationIQ geocoding (recommended)
export LOCATIONIQ_API_KEY=your_key_here
python scraper.py

# Debug mode (visible browser)
python scraper.py --no-headless

# Show all options
python scraper.py --help
```

### Local development

```bash
cd docs
python -m http.server 8000
# Open http://localhost:8000
```

## Project Structure

```
indbrud/
├── scraper.py              # Main scraper script
├── geocode_cache.json      # Cached geocoding results
├── geocode_failures.json   # Failed geocodes for review
├── README.md
└── docs/                   # GitHub Pages
    ├── index.html
    ├── style.css
    ├── app.js
    └── data.json
```

## Limitations

- **Manual updates only** - politi.dk blocks cloud server IPs (GitHub Actions, etc.), so the scraper must be run locally
- **Østjylland only** - other police regions don't include break-in details in their reports
- **Geocoding failures** - some addresses can't be geocoded due to typos or missing OpenStreetMap data

## Data Sources

- [politi.dk/doegnrapporter](https://politi.dk/doegnrapporter) - Police reports
- [LocationIQ](https://locationiq.com/) / [Nominatim](https://nominatim.openstreetmap.org/) - Geocoding
- [OpenStreetMap](https://www.openstreetmap.org/) - Map tiles