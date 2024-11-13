
// about.js


// Initialize Mapbox
mapboxgl.accessToken = 'pk.eyJ1IjoiYWRvdWNldHQiLCJhIjoiY20zZXZyN20zMGd3MzJycTBxYTFza29iYiJ9.ozrkMII8kTiKtHYTS54P2w';

const map = new mapboxgl.Map({
    container: 'about-map',
    style: 'mapbox://styles/adoucett/cjeg655wt0i482spoj9gsr10l',
    center: [-74.0060, 40.7128], // Example: New York City coordinates
    zoom: 9,
    maxZoom: 12,
    minZoom: 4
});

// Add navigation controls
map.addControl(new mapboxgl.NavigationControl());


// Array of words with corresponding CSS classes for styling
const words = [
    { text: "Cartographer", class: "font-cartographer" },
    { text: "Cyclist", class: "font-cyclist" },
    { text: "Runner", class: "font-runner" },
    { text: "Geospatial Marketer", class: "font-geospatial-marketer" },
    { text: "Coffee Lover", class: "font-coffee-lover" },
    { text: "Strava Aficionado", class: "font-strava-aficionado" },
    { text: "IKEA Fan", class: "font-ikea-fan" },
    { text: "Nordic Skier", class: "font-nordic-skier" },
    { text: "Hot Sauce Lover", class: "font-hot-sauce-lover" },
    { text: "Jazz Pianist", class: "font-jazz-pianist" },
    { text: "Sales Engineer", class: "font-sales-engineer" },
];

let currentIndex = 0;
let charIndex = 0;
let isDeleting = false;
const typingSpeed = 100; // Typing speed in milliseconds
const pauseTime = 2000; // Pause time before deleting and switching words
const dynamicWordElement = document.getElementById("dynamic-word");

// Function to handle typing effect
function typeWord() {
    const currentWord = words[currentIndex];
    const fullText = currentWord.text;

    // Update the text content based on typing or deleting
    if (isDeleting) {
        dynamicWordElement.textContent = fullText.substring(0, charIndex);
        charIndex--;
    } else {
        dynamicWordElement.textContent = fullText.substring(0, charIndex);
        charIndex++;
    }

    // Apply the current word's style
    dynamicWordElement.className = "";
    dynamicWordElement.classList.add(currentWord.class);

    // Determine the typing or deleting state
    if (!isDeleting && charIndex === fullText.length) {
        // Pause after typing the full word
        setTimeout(() => (isDeleting = true), pauseTime);
    } else if (isDeleting && charIndex === 0) {
        // Move to the next word after deleting
        isDeleting = false;
        currentIndex = (currentIndex + 1) % words.length;
    }

    // Call the function recursively with adjusted speed
    const speed = isDeleting ? typingSpeed / 2 : typingSpeed;
    setTimeout(typeWord, speed);
}

// Initial call to start the typing effect
typeWord();