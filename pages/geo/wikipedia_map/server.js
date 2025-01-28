const express = require("express");
const app = express();

// Load environment variables from .env
require("dotenv").config();

// Serve static files (e.g., your client-side JS and HTML)
app.use(express.static("public"));

// Create an endpoint to expose the Mapbox Access Token
app.get("/config", (req, res) => {
  res.json({
    mapboxToken: process.env.MAPBOX_ACCESS_TOKEN,
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
