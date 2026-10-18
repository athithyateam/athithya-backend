const { BetaAnalyticsDataClient } = require('@google-analytics/data');

// Initialize client - supports both file path (local) and JSON string (Vercel/production)
let analyticsDataClient;
if (process.env.GOOGLE_CREDENTIALS_JSON) {
    // Production (Vercel): credentials stored as JSON string in env var
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    analyticsDataClient = new BetaAnalyticsDataClient({ credentials });
} else {
    // Local dev: uses GOOGLE_APPLICATION_CREDENTIALS file path
    analyticsDataClient = new BetaAnalyticsDataClient();
}
const propertyId = process.env.GOOGLE_ANALYTICS_PROPERTY_ID;

const getTrafficAnalytics = async (req, res) => {
    try {
        if (!propertyId) {
            return res.status(500).json({ success: false, message: "Google Analytics Property ID not configured." });
        }

        // We fetch multiple reports in one batch if needed, or just do a single report.
        // Let's get Daily Pageviews and Active Users for the last 30 days.
        const [response] = await analyticsDataClient.runReport({
            property: `properties/${propertyId}`,
            dateRanges: [
                {
                    startDate: '30daysAgo',
                    endDate: 'today',
                },
            ],
            dimensions: [
                { name: 'date' },
            ],
            metrics: [
                { name: 'activeUsers' },
                { name: 'screenPageViews' },
                { name: 'sessions' }
            ],
            orderBys: [
                {
                    dimension: { dimensionName: 'date' },
                    desc: false,
                }
            ]
        });

        const formattedData = (response.rows || []).map(row => {
            const dateStr = row.dimensionValues[0].value;
            // Format YYYYMMDD to a readable date (e.g., MMM DD)
            const year = dateStr.substring(0, 4);
            const month = dateStr.substring(4, 6);
            const day = dateStr.substring(6, 8);
            const dateObj = new Date(`${year}-${month}-${day}`);
            
            return {
                date: dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                rawDate: dateStr,
                activeUsers: parseInt(row.metricValues[0].value, 10),
                pageViews: parseInt(row.metricValues[1].value, 10),
                sessions: parseInt(row.metricValues[2].value, 10)
            };
        });

        // Also fetch total stats for a quick overview card
        const [totalsResponse] = await analyticsDataClient.runReport({
            property: `properties/${propertyId}`,
            dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
            metrics: [
                { name: 'activeUsers' },
                { name: 'screenPageViews' },
                { name: 'sessions' },
                { name: 'averageSessionDuration' }
            ]
        });

        const totals = {
            activeUsers: totalsResponse.rows?.[0] ? parseInt(totalsResponse.rows[0].metricValues[0].value, 10) : 0,
            pageViews: totalsResponse.rows?.[0] ? parseInt(totalsResponse.rows[0].metricValues[1].value, 10) : 0,
            sessions: totalsResponse.rows?.[0] ? parseInt(totalsResponse.rows[0].metricValues[2].value, 10) : 0,
            avgSessionDuration: totalsResponse.rows?.[0] ? parseFloat(totalsResponse.rows[0].metricValues[3].value).toFixed(2) : "0.00"
        };

        // Fetch top cities
        const [citiesResponse] = await analyticsDataClient.runReport({
            property: `properties/${propertyId}`,
            dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
            dimensions: [{ name: 'city' }, { name: 'country' }],
            metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
            orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
            limit: 10
        });

        const cities = (citiesResponse.rows || [])
            .filter(row => {
                const city = row.dimensionValues[0].value;
                return city && city !== '(not set)' && city !== 'not set' && city.trim() !== '';
            })
            .map(row => ({
                city: row.dimensionValues[0].value,
                country: row.dimensionValues[1].value,
                activeUsers: parseInt(row.metricValues[0].value, 10),
                sessions: parseInt(row.metricValues[2].value, 10)
            }));

        res.status(200).json({
            success: true,
            data: {
                timeline: formattedData,
                totals,
                cities
            }
        });

    } catch (error) {
        console.error("Error fetching Google Analytics data:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch analytics data. " + (error.message || "Unknown error")
        });
    }
};

module.exports = {
    getTrafficAnalytics
};
