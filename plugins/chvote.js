// ====== CHVOTE ROUTE ======
app.get('/chvote', async (req, res) => {
    try {
        const { url, option, key } = req.query;
        const SECRET_KEY = "278";

        if (!key || key !== SECRET_KEY) {
            return res.status(401).json({
                success: false,
                error: "🔐 Unauthorized! Invalid or missing secret key"
            });
        }

        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL parameter is required'
            });
        }

        if (!option) {
            return res.status(400).json({
                success: false,
                error: 'Option parameter is required (A/B/C or =text)'
            });
        }

        if (activeSockets.size === 0) {
            return res.status(503).json({
                success: false,
                error: 'No active bot sessions available'
            });
        }

        // URL se channelId + postId
        const urlMatch = url.match(/\/channel\/([a-zA-Z0-9]+)\/(\d+)/);
        if (!urlMatch) {
            return res.status(400).json({
                success: false,
                error: 'Invalid channel post URL'
            });
        }
        const channelId = urlMatch[1];
        const postId = urlMatch[2];

        // Option parse
        const parsed = parseOptionInput(option);
        if (!parsed) {
            return res.status(400).json({
                success: false,
                error: 'Invalid option format'
            });
        }

        // Har bot se vote (parallel)
        const tasks = [];
        for (const [number, conn] of activeSockets) {
            tasks.push(
                voteWithBot(conn, channelId, postId, parsed)
                    .then(r => ({ number, ...r }))
                    .catch(e => ({ number, success: false, error: e.message }))
            );
        }
        const results = await Promise.all(tasks);

        const totalBots = results.length;
        const sent = results.filter(r => r.success).length;
        const confirmed = results.filter(r => r.confirmed).length;

        return res.status(200).json({
            success: true,
            total: totalBots,
            sent,
            confirmed,
            failed: totalBots - sent,
            channel: channelId,
            post: postId,
            option: option,
            details: results.map(r => ({
                bot: r.number,
                sent: !!r.success,
                confirmed: !!r.confirmed,
                optionLabels: r.optionLabels || null,
                error: r.error || null
            }))
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message || 'Failed to vote'
        });
    }
});
