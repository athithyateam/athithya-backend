const fs = require('fs');
const path = require('path');
const { BetaAnalyticsDataClient } = require('@google-analytics/data');

/**
 * Safely resolves and initializes the Google Analytics Data client.
 * Returns null if credentials are not configured or the specified key file does not exist,
 * preventing unhandled ENOENT and GAPIC background promise crashes.
 */
function getAnalyticsClient() {
    // 1. Production (Vercel): credentials stored as JSON string in env var
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        try {
            const credentials = typeof process.env.GOOGLE_CREDENTIALS_JSON === 'string'
                ? JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON)
                : process.env.GOOGLE_CREDENTIALS_JSON;
            return new BetaAnalyticsDataClient({ credentials });
        } catch (err) {
            console.error("Failed to parse GOOGLE_CREDENTIALS_JSON:", err.message);
            return null;
        }
    }

    // 2. Local dev / File path: check if file actually exists before passing to GoogleAuth
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credPath) {
        const candidatePaths = [
            path.isAbsolute(credPath) ? credPath : path.resolve(process.cwd(), credPath),
            path.resolve(__dirname, '..', credPath)
        ];
        const existingPath = candidatePaths.find(p => {
            try {
                return fs.existsSync(p) && fs.statSync(p).isFile();
            } catch (_) {
                return false;
            }
        });

        if (existingPath) {
            return new BetaAnalyticsDataClient({ keyFilename: existingPath });
        }
    }

    return null;
}

const getTrafficAnalytics = async (req, res) => {
    try {
        const propertyId = process.env.GOOGLE_ANALYTICS_PROPERTY_ID;
        if (!propertyId) {
            return res.status(500).json({
                success: false,
                message: "Google Analytics Property ID not configured."
            });
        }

        const client = getAnalyticsClient();
        if (!client) {
            return res.status(500).json({
                success: false,
                message: "Google Analytics credentials are not configured or credentials file was not found.",
                data: {
                    timeline: [],
                    totals: { activeUsers: 0, pageViews: 0, sessions: 0, avgSessionDuration: "0.00" },
                    cities: []
                }
            });
        }

        // Explicitly await client initialization to avoid GAPIC unhandled background promise rejections
        await client.initialize();

        // Concurrently run report queries
        const [timelineResult, totalsResult, citiesResult] = await Promise.all([
            client.runReport({
                property: `properties/${propertyId}`,
                dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
                dimensions: [{ name: 'date' }],
                metrics: [
                    { name: 'activeUsers' },
                    { name: 'screenPageViews' },
                    { name: 'sessions' }
                ],
                orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }]
            }),
            client.runReport({
                property: `properties/${propertyId}`,
                dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
                metrics: [
                    { name: 'activeUsers' },
                    { name: 'screenPageViews' },
                    { name: 'sessions' },
                    { name: 'averageSessionDuration' }
                ]
            }),
            client.runReport({
                property: `properties/${propertyId}`,
                dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
                dimensions: [{ name: 'city' }, { name: 'country' }],
                metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
                orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
                limit: 10
            })
        ]);

        const [response] = timelineResult;
        const formattedData = (response.rows || []).map(row => {
            const dateStr = row.dimensionValues?.[0]?.value || '';
            const year = dateStr.substring(0, 4);
            const month = dateStr.substring(4, 6);
            const day = dateStr.substring(6, 8);
            const dateObj = new Date(`${year}-${month}-${day}`);

            return {
                date: isNaN(dateObj.getTime()) ? dateStr : dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                rawDate: dateStr,
                activeUsers: parseInt(row.metricValues?.[0]?.value || '0', 10),
                pageViews: parseInt(row.metricValues?.[1]?.value || '0', 10),
                sessions: parseInt(row.metricValues?.[2]?.value || '0', 10)
            };
        });

        const [totalsResponse] = totalsResult;
        const totals = {
            activeUsers: totalsResponse.rows?.[0] ? parseInt(totalsResponse.rows[0].metricValues?.[0]?.value || '0', 10) : 0,
            pageViews: totalsResponse.rows?.[0] ? parseInt(totalsResponse.rows[0].metricValues?.[1]?.value || '0', 10) : 0,
            sessions: totalsResponse.rows?.[0] ? parseInt(totalsResponse.rows[0].metricValues?.[2]?.value || '0', 10) : 0,
            avgSessionDuration: totalsResponse.rows?.[0] ? parseFloat(totalsResponse.rows[0].metricValues?.[3]?.value || '0').toFixed(2) : "0.00"
        };

        const [citiesResponse] = citiesResult;
        const cities = (citiesResponse.rows || [])
            .filter(row => {
                const city = row.dimensionValues?.[0]?.value;
                return city && city !== '(not set)' && city !== 'not set' && city.trim() !== '';
            })
            .map(row => ({
                city: row.dimensionValues?.[0]?.value,
                country: row.dimensionValues?.[1]?.value,
                activeUsers: parseInt(row.metricValues?.[0]?.value || '0', 10),
                sessions: parseInt(row.metricValues?.[1]?.value || '0', 10)
            }));

        return res.status(200).json({
            success: true,
            data: {
                timeline: formattedData,
                totals,
                cities
            }
        });
    } catch (error) {
        console.error("Error fetching Google Analytics data:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch analytics data. " + (error.message || "Unknown error"),
            data: {
                timeline: [],
                totals: { activeUsers: 0, pageViews: 0, sessions: 0, avgSessionDuration: "0.00" },
                cities: []
            }
        });
    }
};

module.exports = {
    getTrafficAnalytics,
    getAnalyticsClient
};
