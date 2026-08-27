const turf = require("@turf/turf");

/**
 * Determines whether two GeoJSON geometries
 * intersect each other.
 */
function geometriesIntersect(geometryA, geometryB) {
    if (!geometryA || !geometryB) {
        return false;
    }

    try {
        const featureA = turf.feature(geometryA);
        const featureB = turf.feature(geometryB);

        return turf.booleanIntersects(featureA, featureB);

    } catch (error) {
        console.error("❌ Geometry comparison failed:");
        console.error(error.message);

        return false;
    }
}

module.exports = {
    geometriesIntersect
};