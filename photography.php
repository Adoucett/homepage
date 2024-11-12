<php// photography.php>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Name - Photography</title>
    <link rel="stylesheet" href="css/style.css">
    <!-- Google Fonts: DM Sans -->
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
    <!-- Favicon (optional) -->
    <link rel="icon" href="images/favicon.ico" type="image/x-icon">
    <!-- SEO Meta Tags -->
    <meta name="description" content="Your Name's Photography Portfolio showcasing stunning visuals.">
    <meta name="keywords" content="Photography, Portfolio, Unsplash, Instagram, Boston">
    <meta name="author" content="Your Name">
</head>
<body>
    <header>
        <nav>
            <div class="logo">YourLogo</div>
            <ul class="nav-links">
                <li><a href="index.html">Home</a></li>
                <li><a href="about.html">About</a></li>
                <li><a href="photography.php" class="active">Photography</a></li>
                <li><a href="geospatial.html">Geospatial</a></li>
                <li><a href="media.html">Media</a></li>
                <li><a href="resume.html">Resume</a></li>
            </ul>
            <div class="burger">
                <div class="line1"></div>
                <div class="line2"></div>
                <div class="line3"></div>
            </div>
        </nav>
    </header>

    <main>
        <section class="photography-header">
            <h1>Photography Portfolio</h1>
            <p>Explore my collection of captivating photographs.</p>
            <div class="social-links">
                <a href="https://unsplash.com/@yourusername" target="_blank" class="social-btn">Unsplash</a>
                <a href="https://instagram.com/yourusername" target="_blank" class="social-btn">Instagram</a>
            </div>
        </section>

        <section class="gallery">
            <?php
            $directory = 'images/photos/';
            $allowed_types = array('jpg', 'jpeg', 'png', 'gif');
            if (is_dir($directory)) {
                if ($dh = opendir($directory)) {
                    while (($file = readdir($dh)) !== false) {
                        $file_extension = strtolower(pathinfo($file, PATHINFO_EXTENSION));
                        if (in_array($file_extension, $allowed_types)) {
                            $file_path = $directory . $file;
                            $alt_text = pathinfo($file, PATHINFO_FILENAME); // Use filename as alt text
                            echo '<div class="gallery-item">';
                            echo '<img src="' . $file_path . '" alt="' . htmlspecialchars($alt_text) . '" loading="lazy">';
                            echo '</div>';
                        }
                    }
                    closedir($dh);
                }
            } else {
                echo '<p>Gallery not available.</p>';
            }
            ?>
        </section>
    </main>

    <!-- Lightbox Modal -->
    <div id="lightbox" class="lightbox">
        <span class="close">&times;</span>
        <img class="lightbox-content" id="lightbox-img" alt="">
        <div id="caption"></div>
    </div>

    <footer>
        <p>&copy; 2024 Your Name. All rights reserved.</p>
    </footer>

    <script src="js/script.js"></script>
</body>
</html>
