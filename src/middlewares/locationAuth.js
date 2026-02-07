const mongoose = require("mongoose");
const Issue = require("../models/Issue");

const locationAuth = async (req, res, next) => {
    try {
        const { id } = req.params;
        const lng = parseFloat(req.query.lng);
        const lat = parseFloat(req.query.lat);
        if (isNaN(lng) || isNaN(lat)) {
            return res.status(400).json({ success: false, message: "User coords are not Valid" });
        }
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Issue id Invalid" });
        }
        const radiusInKm = 3;
        const radiusInRadians = radiusInKm / 6371;
        const issue = await Issue.findOne({
            _id: id,
            "location.geoData": {
                $geoWithin: {
                    $centerSphere: [[lng, lat], radiusInRadians]
                }
            },
            "isDeleted": false
        })
        if (!issue) {
            return res.status(403).json({ success: false, message: "You are far away" });
        }
        req.issue = issue;
        next();
    }
    catch (err) {
        console.log(err);
        return res.status(500).json({ success: false, message: "Server error: can't check location" })
    }
}
module.exports = locationAuth