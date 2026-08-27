function normalizeAlert(feature) {
    const data = feature.properties || {};

    return {
        id: data.id || feature.id,

        event: data.alert_name_en || "Unknown Alert",

        type: data.alert_type || "Unknown",

        province: data.province || "Unknown",

        location: data.feature_name_en || "Unknown",

        published: data.publication_datetime || null,

        effective: data.validity_datetime || null,

        expires: data.expiration_datetime || null,

        status: data.status_en || "Unknown",

        geometry: feature.geometry || null
    };
}

module.exports = {
    normalizeAlert
};