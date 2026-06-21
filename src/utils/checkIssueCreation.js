const validate = require('validator');

const checkIssueCreation = (req) => {
    const { title, category, description, location, media } = req.body;

    const allowedCategories = [
        'ROAD_&_POTHOLES', 'WATER_SUPPLY', 'ELECTRICITY', 'SAFETY', 'SANITATION',
        'GARBAGE', 'DRAINAGE', 'STREET_LIGHTS', 'TRAFFIC', 'ENCROACHMENT',
        'CORRUPTION', 'HEALTH', 'EDUCATION', 'OTHER'
    ];

    // 1. Title Validation
    if (!title || !title.trim()) throw new Error('Title is required');
    const trimmedTitle = title.trim();
    if (trimmedTitle.length < 5 || trimmedTitle.length > 80) throw new Error("Title must be between 5 and 80 characters");
    if (trimmedTitle.split(/\s+/).length > 10) throw new Error("Title must be concise (maximum 10 words)");

    // 2. Category Validation
    if (!category) throw new Error('Category is required');
    req.body.category = category.toUpperCase();
    if (!allowedCategories.includes(req.body.category)) throw new Error('Invalid Category');

    // 3. Description Validation
    if (!description || !description.trim()) throw new Error('Description is required');
    const trimmedDesc = description.trim();
    if (trimmedDesc.length > 1000) throw new Error("Description is too long (maximum 1000 characters)");

    const descrWordCount = trimmedDesc.split(/\s+/).length;
    if (descrWordCount < 10) throw new Error('At least 10 words required in description');
    if (descrWordCount > 150) throw new Error('Description must be under 150 words');

    // 4. Location Validation
    if (!location) throw new Error('Location is required');
    if (!location.geoData || !location.geoData.coordinates) throw new Error('GPS coords are missing');

    const [long, lat] = location.geoData.coordinates;
    if (typeof long !== 'number' || typeof lat !== 'number') throw new Error('Coords must be Numbers');
    if (lat < -90 || lat > 90 || long < -180 || long > 180) throw new Error('Invalid GPS coordinates');

    // 5. Media Validation
    if (media) {
        if (!Array.isArray(media)) throw new Error("Media must be an array");
        if (media.length < 1) throw new Error("At least 1 media required");
        if (media.length > 3) throw new Error("You can upload maximum of 3 media files");

        media.forEach((item) => {
            if (item.url && !validate.isURL(item.url)) throw new Error('Upload valid media URL');
        });
    }

    return true;
};

module.exports = checkIssueCreation;