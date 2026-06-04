const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Allow your frontend website to talk to this backend
app.use(cors());

// 2. Create the /api/cimis route your chill-hours file is looking for
app.get('/api/cimis', async (req, res) => {
    try {
        const { station, start, end } = req.query;
        
        // Your private CIMIS App Key (Get a free one from cimis.water.ca.gov)
        const CIMIS_API_KEY = process.env.CIMIS_API_KEY || "YOUR_DEFAULT_PUBLIC_KEY"; 
        
        // Construct the real state mainframe URL dynamically
        const cimisUrl = `https://et.water.ca.gov/api/data?appKey=${CIMIS_API_KEY}&targets=${station}&startDate=${start}&endDate=${end}&dataItems=hly-air-tmp`;

        // Fetch the live data from the state
        const response = await fetch(cimisUrl);
        const data = await response.json();

        // Send the real-time weather data right back to your chill-hours calculator
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch live CIMIS database data" });
    }
});

const serverless = require('serverless-http')
module.exports.handler = serverless(app)