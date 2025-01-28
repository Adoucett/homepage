// URLs of GeoJSON files (specify # of files)
const geojsonUrls = Array.from(
  { length: 35 },
  (_, i) => `https://doucett.net/data/json/strava/smashrun_part${i + 1}.geojson` // Ensure single underscore
);

let allRuns = [];
let mapCounter = 0; // To ensure unique map IDs

// Function to compute the distance of a run in miles using Turf.js
function computeRunDistance(run) {
  // Ensure the geometry is a LineString or MultiLineString
  if (
    !run.geometry ||
    (run.geometry.type !== "LineString" &&
      run.geometry.type !== "MultiLineString")
  ) {
    return 0;
  }

  // Ensure there are enough coordinates to calculate distance
  const coordinates = run.geometry.coordinates;
  if (!coordinates || coordinates.length < 2) {
    return 0;
  }

  try {
    // Calculate the length using Turf.js
    const lengthInKilometers = turf.length(run, { units: "kilometers" });
    const lengthInMiles = lengthInKilometers * 0.621371; // Convert km to miles

    // Round to two decimal places
    return Math.round(lengthInMiles * 100) / 100;
  } catch (error) {
    console.error(`Error computing distance for run: ${error}`);
    return 0;
  }
}

// Define the simplifyCoordinates function
function simplifyCoordinates(coordinates) {
  const tolerance = 0.00005; // Adjust tolerance as needed
  const highQuality = true; // Keep the shape
  const points = coordinates.map((coord) => ({ x: coord[1], y: coord[0] })); // Swap to [lat, lng]
  const simplified = simplify(points, tolerance, highQuality);
  return simplified.map((pt) => [pt.x, pt.y]);
}

// Function to compute the centroid of a set of coordinates
function getCentroid(coordinates) {
  let sumLat = 0,
    sumLng = 0;
  coordinates.forEach((coord) => {
    sumLat += coord[1];
    sumLng += coord[0];
  });
  return [sumLat / coordinates.length, sumLng / coordinates.length];
}

// Initialize the modal elements
const modal = document.getElementById("run-modal");
const closeButton = document.querySelector(".close-button");
const modalMapDiv = document.getElementById("modal-map");
const modalInfoDiv = document.getElementById("modal-info");
let modalMapInstance = null; // To keep track of the modal map instance

// Function to open modal with run details
function openModal(run, bounds) {
  // Display run information
  const runDate = new Date(run.properties.run_start_time);
  const formattedDate = runDate.toLocaleDateString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const runDistance = run.properties.length_miles || "N/A";

  modalInfoDiv.innerHTML = `
        <h2>Run on ${formattedDate}</h2>
        <p>Distance: ${runDistance} miles</p>
    `;

  // Show modal first to ensure it's visible before initializing the map
  modal.style.display = "flex";

  // Remove existing map instance if any
  if (modalMapInstance) {
    modalMapInstance.remove();
    modalMapInstance = null;
  }

  // Initialize Leaflet map in modal after a short delay to ensure the modal is rendered
  setTimeout(() => {
    try {
      modalMapInstance = L.map("modal-map", {
        center: [0, 0],
        zoom: 13, // Adjusted initial zoom for better visibility
        dragging: true,
        scrollWheelZoom: true,
        doubleClickZoom: true,
        zoomControl: true,
        attributionControl: true,
        interactive: true,
      });

      // Changed Tile Layer to your existing basemap
      L.tileLayer(
        "https://api.mapbox.com/styles/v1/adoucett/cm3nv3e4e005e01sb1309g716/tiles/512/{z}/{x}/{y}?access_token=pk.eyJ1IjoiYWRvdWNldHQiLCJhIjoiY2lvZDFsc2lwMDRnd3Zha2pneWpxcHh6biJ9.sbWgw2zPGyScsp-r4CYQnA",
        {
          maxZoom: 18,
          attribution: '&copy; "></a> ',
        }
      ).addTo(modalMapInstance);

      // Simplify coordinates
      const simplifiedCoords = simplifyCoordinates(run.geometry.coordinates);

      if (simplifiedCoords.length < 2) {
        // Not enough points to draw a line
        modalInfoDiv.innerHTML +=
          '<p style="color: #888;">Insufficient data to display route.</p>';
        return;
      }

      // Create a polyline
      const polyline = L.polyline(simplifiedCoords, {
        color: "#FC5200",
        weight: 3,
      }).addTo(modalMapInstance);

      // Fit map to polyline bounds with some padding
      modalMapInstance.fitBounds(polyline.getBounds(), { padding: [25, 25] });

      // Invalidate Size to Ensure Proper Rendering
      modalMapInstance.invalidateSize();
    } catch (error) {
      console.error(`Error initializing modal map: ${error}`);
    }
  }, 100); // 100ms delay
}

// Function to close modal
function closeModal() {
  modal.style.display = "none";
  modalMapDiv.innerHTML = ""; // Clear previous map container content

  // Remove the modal map instance if it exists
  if (modalMapInstance) {
    modalMapInstance.remove();
    modalMapInstance = null;
  }

  modalInfoDiv.innerHTML = ""; // Clear previous info
}

// Event listener for close button
closeButton.addEventListener("click", closeModal);

// Event listener for clicks outside the modal content to close modal
window.addEventListener("click", (event) => {
  if (event.target == modal) {
    closeModal();
  }
});

// Utility function to fetch all GeoJSON data in parallel
async function fetchAllGeoJSON(urls) {
  const fetchPromises = urls.map((url) =>
    fetch(url).then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
      }
      return response.json();
    })
  );
  try {
    const geojsonDataArray = await Promise.all(fetchPromises);
    // Flatten the array and compute distance for each run
    return geojsonDataArray
      .flatMap((data) => data.features || [])
      .map((run) => {
        run.properties.length_miles = computeRunDistance(run);
        return run;
      });
  } catch (error) {
    console.error("Error fetching GeoJSON data:", error);
    return [];
  }
}

// Function to create a run card with hover and click events
function createRunCard(run) {
  const mapId = `map-${mapCounter++}`;
  const mapDiv = document.createElement("div");
  mapDiv.id = mapId;
  mapDiv.className = "run-map";

  const overlayDiv = document.createElement("div");
  overlayDiv.className = "run-overlay";
  const runDistance = run.properties.length_miles || "N/A";
  overlayDiv.innerHTML = `<div>${runDistance} mi</div>`; // Only display mileage

  const card = document.createElement("div");
  card.className = "run-card";
  card.appendChild(mapDiv);
  card.appendChild(overlayDiv);

  // Initialize a Leaflet map inside the card after the div is appended to the DOM
  // Use requestAnimationFrame to ensure the div is rendered
  requestAnimationFrame(() => {
    try {
      const map = L.map(mapId, {
        center: [0, 0],
        zoom: 13,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        zoomControl: false,
        attributionControl: false,
        interactive: false,
      });

      // Ensure basemap styles are unchanged
      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        {
          maxZoom: 18,
          attribution: '&copy; <a href="https://carto.com/">CartoDB</a>',
        }
      ).addTo(map);

      // Simplify and draw the polyline
      const simplifiedCoords = simplifyCoordinates(run.geometry.coordinates);
      if (simplifiedCoords.length > 1) {
        const polyline = L.polyline(simplifiedCoords, {
          color: "#FF5733",
          weight: 2,
        }).addTo(map);
        map.fitBounds(polyline.getBounds());

        // Click event to open modal with zoomed view
        card.addEventListener("click", () => {
          // Compute centroid for centering the modal map
          const centroid = getCentroid(run.geometry.coordinates);
          openModal(run, polyline.getBounds());
        });
      } else {
        const noDataMessage = document.createElement("p");
        noDataMessage.textContent = "No route data available.";
        noDataMessage.style.textAlign = "center";
        noDataMessage.style.color = "#888";
        card.appendChild(noDataMessage);
      }
    } catch (error) {
      console.error(`Error initializing map for run: ${error}`);
    }
  });

  return card;
}

// Function to display runs
function displayRuns(runs) {
  const container = document.getElementById("runs-container");
  container.innerHTML = "";

  if (runs.length === 0) {
    container.innerHTML =
      '<p style="text-align: center; color: red;">No runs available.</p>';
    return;
  }

  runs.forEach((run) => {
    const card = createRunCard(run);
    container.appendChild(card);
  });
}

// Function to count runs per month/year
function countRunsPerMonth(runs) {
  const counts = {};
  runs.forEach((run) => {
    const date = new Date(run.properties.run_start_time);
    const month = date.getMonth(); // 0-11
    const year = date.getFullYear();
    const key = `${month} ${year}`;
    counts[key] = (counts[key] || 0) + 1;
  });

  // Convert counts to array and sort by year and month descending
  const countsArray = Object.keys(counts).map((key) => {
    const [month, year] = key.split(" ");
    return {
      month: parseInt(month),
      year: parseInt(year),
      count: counts[key],
    };
  });

  countsArray.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.month - a.month;
  });

  // Format labels as "Month Year"
  const formatted = countsArray.map((item) => ({
    label: `${getMonthName(item.month)} ${item.year}`,
    count: item.count,
  }));

  return formatted;
}

// Function to get month name from month index
function getMonthName(monthIndex) {
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return monthNames[monthIndex];
}

// Function to initialize the timeline chart
function initializeTimelineChart(runCounts) {
  const canvas = document.getElementById("timeline-chart");
  const ctx = canvas.getContext("2d");
  const labels = runCounts.map((item) => item.label);
  const data = runCounts.map((item) => item.count);

  const monthsPerYear = 12;
  const visibleYears = 3;
  const visibleMonths = monthsPerYear * visibleYears;
  const monthWidth = 50; // pixels per month
  const totalMonths = labels.length;
  const canvasWidth = totalMonths * monthWidth;

  // Set canvas dimensions before initializing Chart.js
  canvas.width = canvasWidth;
  canvas.height = 200; // Set desired height to 200px

  // Initialize Chart.js
  const timelineChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Number of Runs",
          data: data,
          backgroundColor: "#FF5733",
          borderColor: "#FC5200",
          borderWidth: 2,
          barThickness: monthWidth * 0.5, // Set bar width relative to monthWidth
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          callbacks: {
            label: function (context) {
              return `Runs: ${context.parsed.y}`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            maxRotation: 90,
            minRotation: 45,
          },
        },
        y: {
          beginAtZero: true,
          precision: 0,
        },
      },
      onClick: (evt, elements) => {
        if (elements.length > 0) {
          const index = elements[0].index;
          const selectedLabel = labels[index];
          const [monthName, yearStr] = selectedLabel.split(" ");
          const month = getMonthIndex(monthName);
          const year = parseInt(yearStr);
          if (month !== -1 && !isNaN(year)) {
            filterAndDisplayRuns(month, year);
          }
        }
      },
    },
  });
}

// Function to get month index from month name
function getMonthIndex(monthName) {
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return monthNames.indexOf(monthName);
}

// Function to initialize the timeline selector
function initializeTimeline(runCounts) {
  initializeTimelineChart(runCounts);
}

// Function to filter and display runs based on month and year
function filterAndDisplayRuns(month, year) {
  const filteredRuns = allRuns.filter((run) => {
    const date = new Date(run.properties.run_start_time);
    return date.getMonth() === month && date.getFullYear() === year;
  });
  displayRuns(filteredRuns);
}

// Function to initialize the app
async function initializeApp() {
  allRuns = await fetchAllGeoJSON(geojsonUrls);
  if (allRuns.length === 0) {
    document.getElementById("runs-container").innerHTML =
      '<p style="text-align: center; color: red;">Failed to load running data. Please check the GeoJSON URLs.</p>';
    return;
  }

  // Sort runs by date descending
  allRuns.sort(
    (a, b) =>
      new Date(b.properties.run_start_time) -
      new Date(a.properties.run_start_time)
  );

  // Keep only the first 50 runs for initial display
  const displayedRuns = allRuns.slice(0, 50);

  // Count runs per month/year from all runs
  const runCounts = countRunsPerMonth(allRuns);

  // Initialize timeline
  initializeTimeline(runCounts);

  // Initially display the latest 50 runs
  displayRuns(displayedRuns);
}

// Start the app once DOM is fully loaded
document.addEventListener("DOMContentLoaded", () => {
  initializeApp();
});
