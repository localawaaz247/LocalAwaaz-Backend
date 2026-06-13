const express = require('express');
const visitsRouter = express.Router();
const Visitor = require('../models/Visitor');


// GET: Fetch current count
visitsRouter.get('/', async (req, res) => {
    try {
        let visitorData = await Visitor.findOne({ identifier: 'global_count' });
        if (!visitorData) {
            visitorData = await Visitor.create({ identifier: 'global_count', count: 0 });
        }
        res.status(200).json({ count: visitorData.count });
    } catch (error) {
        res.status(500).json({ message: "Error fetching visitor count" });
    }
});

// POST: Increment count and EMIT TO SOCKET
visitsRouter.post('/increment', async (req, res) => {
    try {
        const visitorData = await Visitor.findOneAndUpdate(
            { identifier: 'global_count' },
            { $inc: { count: 1 } },
            { new: true, upsert: true }
        );

        // 🚀 THE REAL-TIME MAGIC: Broadcast the new count to all connected users
        const io = req.app.get('io');
        if (io) {
            io.emit('live_visitor_update', { count: visitorData.count });
        }

        res.status(200).json({ count: visitorData.count });
    } catch (error) {
        res.status(500).json({ message: "Error incrementing visitor count" });
    }
});

module.exports = visitsRouter;