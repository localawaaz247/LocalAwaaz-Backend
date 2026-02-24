const validate = require('validator');

/**
 * Validates issue details for PATCH (Partial Update) requests.
 * * LOGIC EXPLAINED:
 * 1. Partial Updates: We use `if (field !== undefined)` to check if a field exists.
 * - If a field is missing (undefined), we SKIP validation (user isn't updating it).
 * - If a field exists, we apply strict validation rules.   
 * * 2. Sanitization: We automatically convert 'category' to UPPERCASE inside req.body
 * so the controller receives clean data.
 * * @param {Object} req - The Express request object
 * @returns {Boolean} - Returns true if valid, throws Error if invalid
 */
const checkIssueUpdates = (req) => {
    // Extract fields from the request body
    const { title, category, description, location, media } = req.body;

    // List of allowed values for the 'category' field
    const allowedCategories = ['SAFETY', 'WATER_SUPPLY', 'ELECTRICITY', 'SANITATION',
        'ROAD_&_POTHOLES', 'GARBAGE', 'STREET_LIGHTS', 'TRAFFIC', 'ENCROACHMENT'];

    // ============================================================
    // 1. TITLE VALIDATION
    // ============================================================
    // Only validate if 'title' is being updated
    if (title !== undefined) {
        if (typeof title !== 'string') throw new Error('Title must be a text string');
        // Prevent users from saving an empty title (e.g., "   ")
        if (!title.trim()) {
            throw new Error('Title cannot be empty');
        }

        // Split by spaces to count words. Max limit: 5 words.
        const titleWordCount = title.trim().split(/\s+/).length;
        if (titleWordCount > 10) {
            throw new Error("Title must be within 10 words");
        }
    }

    // ============================================================
    // 2. CATEGORY VALIDATION
    // ============================================================
    if (category !== undefined) {
        if (typeof category !== 'string') throw new Error('Category must be a text string');
        // Prevent empty strings
        if (category.trim() === "") {
            throw new Error('Category must be selected');
        }

        // SANITIZATION: Convert input to Uppercase directly in req.body
        // This ensures "road" becomes "ROAD" for consistency.
        req.body.category = category.toUpperCase();

        // Check if the SANITIZED value is in our allowed list
        if (!allowedCategories.includes(req.body.category)) {
            throw new Error('Invalid Category');
        }
    }

    // ============================================================
    // 3. DESCRIPTION VALIDATION
    // ============================================================
    if (description !== undefined) {
        if (typeof description !== 'string') throw new Error('Description must be a text string');
        // Prevent empty description
        if (description.trim() === "") {
            throw new Error("Description must be written");
        }

        // Word count rules: Minimum 10, Maximum 100
        const descrWordCount = description.trim().split(/\s+/).length;
        if (descrWordCount < 10) throw new Error('At least 10 words required in description');
        if (descrWordCount > 100) throw new Error('Description cannot be more than 100 words');
    }

    // ============================================================
    // 4. LOCATION VALIDATION
    // ============================================================
    if (location !== undefined) {
        // Prevent null or string inputs crashing the object checks
        if (typeof location !== 'object' || location === null) {
            throw new Error('Location must be a valid object');
        }
        // We only check address and geoData because that's what the Schema has.
        if (location.address && typeof location.address !== 'string') {
            throw new Error('Address must be a string');
        }

        // Ensure nested GeoJSON structure exists
        if (!location.geoData || !location.geoData.coordinates) {
            throw new Error('GPS coords are missing');
        }

        // Extract [longitude, latitude]
        const [long, lat] = location.geoData.coordinates;

        // Type Check: Coordinates must be numbers, not strings
        if (typeof long !== 'number' || typeof lat !== 'number') {
            throw new Error('Coords must be Numbers');
        }

        // Range Check: Latitude (-90 to 90), Longitude (-180 to 180)
        if (lat < -90 || lat > 90 || long < -180 || long > 180) {
            throw new Error('Invalid GPS coordinates');
        }
    }

    // ============================================================
    // 5. MEDIA VALIDATION
    // ============================================================
    if (media !== undefined) {
        // Must be an array
        if (!Array.isArray(media)) {
            throw new Error("Media must be an array of image URLs");
        }
        // At least one media required
        if (media.length < 1) {
            throw new Error("At least one media file is required");
        }
        // Limit the number of uploads to 3
        if (media.length > 3) {
            throw new Error('You can upload a maximum of 3 media files');
        }

        // Check every item - STRICTLY enforce Strings (URLs)
        media.forEach((item) => {
            if (typeof item !== 'string' || !validate.isURL(item)) {
                throw new Error("Invalid media format. Expected an array of valid URLs.");
            }
        });
    }

    // Return true if all checks pass
    return true;
}

module.exports = checkIssueUpdates;