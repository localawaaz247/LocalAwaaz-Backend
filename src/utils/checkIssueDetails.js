const validate = require('validator');

/**
 * Validates issue details from the request body.
 * Throws errors if any validation fails.
 */
const checkIssueDetails = (req) => {
    const { title, category, description, location, media } = req.body;

    // Allowed categories for the issue
    const allowedCategories = ['ROAD', 'WATER', 'ELECTRICITY', 'SAFETY', 'GARBAGE', 'OTHER'];

    // ---------------- Title Validation ----------------
    if (!title) {
        throw new Error('Title is required'); // Title must exist
    }

    // Count words in the title (max 10)
    const titleWordCount = title.trim().split(/\s+/).length;
    if (titleWordCount > 10) {
        throw new Error("Title must be within 10 words"); // Enforce short, concise titles
    }

    // ---------------- Category Validation ----------------
    if (!category) {
        throw new Error('Category is required'); // Must have a category
    }

    if (!allowedCategories.includes(category)) {
        throw new Error('Invalid Category'); // Must be one of the allowed values
    }

    // ---------------- Description Validation ----------------
    if (!description) {
        throw new Error('Description is required'); // Description cannot be empty
    }

    // Count words in the description (10-100)
    const descrWordCount = description.trim().split(/\s+/).length;
    if (descrWordCount < 10) throw new Error('At least 10 words required in description');
    if (descrWordCount > 100) throw new Error('Description cannot be more than 100 words');

    // ---------------- Location Validation ----------------
    if (!location) {
        throw new Error('Location is required'); // Must provide location object
    }

    // State, city, and pincode must exist
    if (!location.state || !location.city || !location.pincode) {
        throw new Error('State, City and Pincode are required');
    }

    // geoData and coordinates must exist
    if (!location.geoData || !location.geoData.coordinates) {
        throw new Error('GPS coords are missing');
    }

    // Destructure coordinates: [longitude, latitude]
    const [long, lat] = location.geoData.coordinates;

    // Ensure coordinates are numbers
    if (typeof long !== 'number' || typeof lat !== 'number') {
        throw new Error('Coords must be Numbers');
    }

    // Check valid GPS ranges
    if (lat < -90 || lat > 90 || long < -180 || long > 180) {
        throw new Error('Invalid GPS coordinates');
    }

    // ---------------- Media Validation ----------------
    if (media && Array.isArray(media)) {
        // Maximum 5 media files
        if (media.length > 5) {
            throw new Error("You can upload maximum of 5 media");
        }

        // Each media URL must be valid
        media.forEach((item) => {
            if (item.url && !validate.isURL(item.url)) {
                throw new Error('Upload valid media URL');
            }
        });
    }
    return true;
}

module.exports = checkIssueDetails;
