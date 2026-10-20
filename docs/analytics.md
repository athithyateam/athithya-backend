# Analytics API (Google Analytics 4)

Base prefix: `/api/analytics`

Integration with Google Analytics Data API (GA4) to surface platform traffic, daily active users, page views, and geographical breakdowns on the administrator dashboard.

All routes require authentication and admin role:
```javascript
router.use(checkAuth, checkAdmin);
```

---

## Endpoints

### 1. Get 30-Day Traffic Analytics
* **Method**: `GET`
* **Path**: `/api/analytics/traffic`
* **Auth**: Required (`checkAuth`, `checkAdmin`)
* **Environment Configuration**:
  * `GOOGLE_ANALYTICS_PROPERTY_ID`: GA4 property ID.
  * `GOOGLE_CREDENTIALS_JSON`: JSON service account string (Vercel production).
  * `GOOGLE_APPLICATION_CREDENTIALS`: File path to service account key (Local development).
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "data": {
      "timeline": [
        {
          "date": "Oct 18",
          "rawDate": "20261018",
          "activeUsers": 142,
          "pageViews": 680,
          "sessions": 210
        }
      ],
      "totals": {
        "activeUsers": 3840,
        "pageViews": 19420,
        "sessions": 5120,
        "avgSessionDuration": "142.50"
      },
      "cities": [
        {
          "city": "Bengaluru",
          "country": "India",
          "activeUsers": 1250,
          "sessions": 1680
        },
        {
          "city": "Mumbai",
          "country": "India",
          "activeUsers": 840,
          "sessions": 1120
        }
      ]
    }
  }
  ```
* **Error Response (500)**:
  ```json
  {
    "success": false,
    "message": "Google Analytics Property ID not configured."
  }
  ```
