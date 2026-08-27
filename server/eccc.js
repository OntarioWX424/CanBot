const axios = require("axios");

const ECCC_ALERTS_URL =
    "https://api.weather.gc.ca/collections/weather-alerts/items";

async function getAlerts() {
    try {
        const response = await axios.get(ECCC_ALERTS_URL, {
            params: {
                f: "json",
                limit: 1000
            },
            timeout: 15000
        });

        return response.data.features || [];

    } catch (error) {
        console.error("❌ ECCC API request failed.");

        if (error.response) {
            console.error(
                `HTTP ${error.response.status}: ${error.response.statusText}`
            );
        } else {
            console.error(error.message);
        }

        return [];
    }
}

module.exports = {
    getAlerts
};