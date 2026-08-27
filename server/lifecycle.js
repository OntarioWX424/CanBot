function getLifecycleStatus(previous, current) {

    // Brand-new alert
    if (!previous) {
        return "NEW";
    }

    // Explicit ECCC cancellation
    if (current.status === "cancelled") {
        return "CANCELLED";
    }

    // Alert disappeared from the active feed
    if (!current) {
        return "ENDED";
    }

    // ECCC continued the alert
    if (current.status === "continued") {
        return "CONTINUED";
    }

    // ECCC amended the alert
    if (current.status === "amended") {
        return "AMENDED";
    }

    // Something changed
    if (
        previous.expires !== current.expires ||
        previous.status !== current.status ||
        previous.effective !== current.effective
    ) {
        return "UPDATED";
    }

    // Nothing changed
    return "UNCHANGED";
}

module.exports = {
    getLifecycleStatus
};