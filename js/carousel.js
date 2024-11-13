
// JavaScript for Enhanced Carousel
const carousel = document.getElementById('carousel');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');

let currentIndex = 0;

function showSlide(index) {
    const totalSlides = document.querySelectorAll('.carousel-item').length;
    if (index >= totalSlides) currentIndex = 0;
    if (index < 0) currentIndex = totalSlides - 1;
    carousel.style.transform = `translateX(${-currentIndex * 100}%)`;
}

prevBtn.addEventListener('click', () => {
    currentIndex--;
    showSlide(currentIndex);
});

nextBtn.addEventListener('click', () => {
    currentIndex++;
    showSlide(currentIndex);
});

// Auto-play functionality (optional)
setInterval(() => {
    currentIndex++;
    showSlide(currentIndex);
}, 10000);
