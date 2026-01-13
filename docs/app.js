// Initialize map centered on Aarhus
const map = L.map('map').setView([56.15, 10.2], 10);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

// Marker cluster group
const markers = L.markerClusterGroup();
map.addLayer(markers);

// Data storage
let allEntries = [];
let allDates = [];

// DOM elements
const startSlider = document.getElementById('startSlider');
const endSlider = document.getElementById('endSlider');
const sliderRange = document.getElementById('sliderRange');
const startLabel = document.getElementById('startLabel');
const endLabel = document.getElementById('endLabel');
const minDateLabel = document.getElementById('minDate');
const maxDateLabel = document.getElementById('maxDate');
const countEl = document.getElementById('count');
const totalEl = document.getElementById('total');
const loadingEl = document.getElementById('loading');

// Format date as DD/MM
function formatDate(dateStr) {
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}`;
}

// Format date as DD/MM/YY
function formatDateLong(dateStr) {
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year.slice(2)}`;
}

// Update the visual slider range bar
function updateSliderRange() {
  const minVal = Math.min(parseInt(startSlider.value), parseInt(endSlider.value));
  const maxVal = Math.max(parseInt(startSlider.value), parseInt(endSlider.value));
  sliderRange.style.left = minVal + '%';
  sliderRange.style.width = (maxVal - minVal) + '%';
}

// Filter markers based on slider values
function filterAndDisplayMarkers() {
  if (allDates.length === 0) return;

  const startVal = parseInt(startSlider.value);
  const endVal = parseInt(endSlider.value);
  
  const startIdx = Math.floor((Math.min(startVal, endVal) / 100) * (allDates.length - 1));
  const endIdx = Math.floor((Math.max(startVal, endVal) / 100) * (allDates.length - 1));
  
  const startDate = allDates[startIdx];
  const endDate = allDates[endIdx];
  
  // Update labels
  startLabel.textContent = formatDateLong(startDate);
  endLabel.textContent = formatDateLong(endDate);
  
  // Clear and re-add markers
  markers.clearLayers();
  
  let count = 0;
  for (const entry of allEntries) {
    if (entry.date >= startDate && entry.date <= endDate && entry.lat && entry.lon) {
      const marker = L.marker([entry.lat, entry.lon]);
      marker.bindPopup(`
        <div class="popup-title">${entry.address}</div>
        <div class="popup-city">${entry.city}</div>
        <div class="popup-date">${entry.date}</div>
        <div class="popup-time">Tidspunkt: ${entry.time}</div>
      `);
      markers.addLayer(marker);
      count++;
    }
  }
  
  countEl.textContent = count;
  updateSliderRange();
}

// Event listeners for sliders
startSlider.addEventListener('input', filterAndDisplayMarkers);
endSlider.addEventListener('input', filterAndDisplayMarkers);

// Load and process data
async function loadData() {
  try {
    const res = await fetch('./data.json');
    const data = await res.json();
    
    // Get sorted dates
    allDates = Object.keys(data).sort();
    
    // Flatten the nested structure
    for (const [date, regions] of Object.entries(data)) {
      for (const [region, cities] of Object.entries(regions)) {
        for (const [city, addresses] of Object.entries(cities)) {
          for (const entry of addresses) {
            allEntries.push({ ...entry, city, date, region });
          }
        }
      }
    }

    // Update total count
    totalEl.textContent = allEntries.length;
    
    // Set date range labels
    if (allDates.length > 0) {
      minDateLabel.textContent = formatDateLong(allDates[0]);
      maxDateLabel.textContent = formatDateLong(allDates[allDates.length - 1]);
    }

    // Initial display with all data
    filterAndDisplayMarkers();
    
    // Hide loading
    loadingEl.style.display = 'none';

    console.log(`Loaded ${allEntries.length} entries across ${allDates.length} dates`);

  } catch (e) {
    console.error('Failed to load data:', e);
    loadingEl.textContent = 'Fejl ved indlæsning af data';
  }
}

// Start loading data
loadData();