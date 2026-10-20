# Athithya Backend API Documentation

Welcome to the comprehensive API documentation for the Athithya Backend. This documentation details all HTTP endpoints, route parameters, request payloads, authentication requirements, and response contracts.

---

## Base URLs
* **Local Development**: `http://localhost:5000`
* **Production**: `https://api.athithya.in`

---

## Authentication & Authorization
Most private routes require an authentication token.
* **Header Format**: `Authorization: Bearer <JWT_TOKEN>`
* **Cookie Support**: Tokens can also be transmitted via the `token` or `jwt` HTTP-only cookie.

### Roles & Middlewares
* **Public**: Accessible without credentials.
* `checkAuth`: Requires valid JWT belonging to an active user. Attaches `req.user` (`userId`, `role`, `email`).
* `checkOptionalAuth`: If JWT is supplied, `req.user` is populated; otherwise allowed as guest.
* `checkAdmin`: Requires `req.user.role === 'admin'`.
* `checkApprovedHost`: Requires `req.user.role === 'host'` and approved status.
* `Host Restriction`: Several endpoints prohibit hosts from booking/rating other hosts.

---

## Response Envelope Standard
Most endpoints conform to standard JSON responses:

### Success
```json
{
  "success": true,
  "message": "Optional human-readable confirmation message",
  "data": { ... }
}
```

### Error
```json
{
  "success": false,
  "message": "Detailed description of error",
  "error": "Optional stack or error object (in dev mode)"
}
```

---

## API Module Directory

| Module | Route Prefix | Spec Document |
| :--- | :--- | :--- |
| **Authentication & Users** | `/api/auth`, `/api/users` | [auth-and-users.md](./auth-and-users.md) |
| **Posts (Experiences, Services, Treks)** | `/api/posts` | [posts.md](./posts.md) |
| **Bookings & Payments** | `/api/bookings` | [bookings.md](./bookings.md) |
| **Reviews & Ratings** | `/api/reviews` | [reviews.md](./reviews.md) |
| **Itineraries (Plans)** | `/api/itineraries` | [itineraries.md](./itineraries.md) |
| **Search & Geocoding** | `/api/search` | [search.md](./search.md) |
| **Notifications** | `/api/notifications` | [notifications.md](./notifications.md) |
| **Group Schedules** | `/api/schedules` | [schedules.md](./schedules.md) |
| **Guest Experience Schedules** | `/api/guest-schedules` | [guest-schedules.md](./guest-schedules.md) |
| **Real-time Chat & Group Plans** | `/api/chat` | [chat.md](./chat.md) |
| **Admin Operations** | `/api/admin` | [admin.md](./admin.md) |
| **Google Analytics** | `/api/analytics` | [analytics.md](./analytics.md) |
