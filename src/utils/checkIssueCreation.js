const validate = require('validator');

/**
 * Validates issue details for CREATION (POST requests).
 * * * PURPOSE:
 * Enforces STRICT validation. All required fields (title, category, description, location)
 * must be present. If any are missing, it throws an error to stop the database save.
 * * * KEY FEATURES:
 * 1. Strict Existence Checks: Uses `if (!field)` to ensure fields exist.
 * 2. Sanitization: Converts 'category' to UPPERCASE automatically.
 * 3. Deep Validation: Checks nested objects like 'location.geoData'.
 * * @param {Object} req - The Express request object containing req.body
 * @returns {Boolean} - Returns true if valid, throws Error if invalid
 */
const checkIssueCreation = (req) => {
    // Destructure the required fields from the request body
    const { title, category, description, location, media } = req.body;

    // Define the list of allowed categories for strict validation
    const allowedCategories = ['ROAD_&_POTHOLES', 'WATER_SUPPLY', 'ELECTRICITY', 'SAFETY', 'SANITATION', 'GARBAGE'
        , 'DRAINAGE', 'STREET_LIGHTS', 'TRAFFIC', 'ENCROACHMENT', 'CORRUPTION', 'HEALTH', 'EDUCATION'
    ];

    // ============================================================
    // 1. TITLE VALIDATION
    // ============================================================
    // Ensure title exists and is not an empty string
    if (!title) {
        throw new Error('Title is required');
    }

    // Word Count Rule: Title should be short and concise (Max 5 words)
    // We split by spaces (/\s+/) to count actual words, not just characters.
    const titleWordCount = title.trim().split(/\s+/).length;
    if (titleWordCount > 5) {
        throw new Error("Title must be within 5 words");
    }

    // ============================================================
    // 2. CATEGORY VALIDATION & SANITIZATION
    // ============================================================
    // Ensure category exists
    if (!category) {
        throw new Error('Category is required');
    }

    // SANITIZATION STEP:
    // We convert the user's input to UPPERCASE directly in req.body.
    // This ensures that "road", "Road", and "ROAD" are all treated as the same valid category
    // and saved consistently in the database.
    req.body.category = category.toUpperCase();

    // Check if the sanitized category is in our allowed list
    if (!allowedCategories.includes(req.body.category)) {
        throw new Error('Invalid Category');
    }

    // ============================================================
    // 3. DESCRIPTION VALIDATION
    // ============================================================
    // Ensure description exists
    if (!description) {
        throw new Error('Description is required');
    }

    // Word Count Rules: 
    // - Minimum 10 words (to ensure enough detail)
    // - Maximum 50 words (to prevent spam/too long essays)
    const descrWordCount = description.trim().split(/\s+/).length;
    if (descrWordCount < 10) throw new Error('At least 10 words required in description');
    if (descrWordCount > 50) throw new Error('Description cannot be more than 50 words');

    // ============================================================
    // 4. LOCATION VALIDATION (Deep Check)
    // ============================================================
    // Ensure the main location object exists
    if (!location) {
        throw new Error('Location is required');
    }

    // Check for GeoJSON structure (Used for map plotting)
    if (!location.geoData || !location.geoData.coordinates) {
        throw new Error('GPS coords are missing');
    }

    // Extract longitude and latitude from the coordinates array
    // Expected format: [longitude, latitude]
    const [long, lat] = location.geoData.coordinates;

    // Type Check: Ensure they are actual numbers
    if (typeof long !== 'number' || typeof lat !== 'number') {
        throw new Error('Coords must be Numbers');
    }

    // Range Check: Validate against real-world GPS limits
    // Latitude: -90 to +90 | Longitude: -180 to +180
    if (lat < -90 || lat > 90 || long < -180 || long > 180) {
        throw new Error('Invalid GPS coordinates');
    }

    // ============================================================
    // 5. MEDIA VALIDATION (Optional but Strict if present)
    // ============================================================
    // Only run checks if 'media' is provided (it's optional for creation)
    if (media) {
        // Must be an array
        if (!Array.isArray(media)) {
            throw new Error("Media must be an array");
        }
        //Atleast 1 media required
        if (media.length < 1) {
            throw new Error("Atleast 1 media required")
        }
        // Limit: Max 3 files allowed per issue
        if (media.length > 3) {
            throw new Error("You can upload maximum of 3 media");
        }

        // Validate each media item
        media.forEach((item) => {
            // If the item has a URL, ensure it is a valid web URL format
            if (item.url && !validate.isURL(item.url)) {
                throw new Error('Upload valid media URL');
            }
        });
    }

    // If all checks pass, return true to allow the controller to proceed
    return true;
}

module.exports = checkIssueCreation;