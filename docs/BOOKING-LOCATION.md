# Booking addresses, maps and optional GPS

Customers, assigned professionals and administrators open **Address & live location** from a booking or service-tracking/queue card. The shared route is `/locations/catalog/{bookingId}` for catalogue bookings or `/locations/provider/{bookingId}` for professional bookings. The same booking-scoped API supports both.

## Customer and professional flow

The written service address is available without GPS. Before work starts, the customer can correct it, add arrival instructions and optionally save a service pin. Coordinates can be entered manually, selected by clicking the interactive map, or drafted from the current GPS fix. An explicit confirmation is required before publishing the address/pin. Live participant GPS is separate: it never moves the saved service destination automatically.

For a confirmed or ongoing booking, either participant can opt into sharing their own device location after the in-app consent notice and browser permission. Watch callbacks and a periodic fresh-position request send bounded updates approximately every 15–20 seconds. The other participant and administrators receive existing authenticated WebSocket/SSE refresh hints and fetch the authorized location state; visible-page polling provides a fallback. No coordinate is broadcast in Redis update payloads.

**Recent shared update** means the server received a point within 90 seconds during an unexpired sharing session. It is not proof that the browser is still open. **Last known location** includes its actual GPS-observed timestamp, server-save timestamp and reported device accuracy. Device coordinates are not independently verified and must not be used as proof of attendance, identity or service completion.

Stop sharing ends updates while retaining the last saved point. Navigation/closing sends a best-effort final point and stop in one request; the server can save that final point atomically. A disconnected or force-killed browser cannot guarantee delivery. In that case the previously acknowledged point remains, and becomes last-known when it ages. Browser GPS cannot continue after closure and may pause when backgrounded or locked; permanent background tracking is not implemented or claimed. HTTPS is required except for browser-supported localhost development.

When a participant ends a session that has a saved point during an active booking, the other participant receives a stored in-app popup/history notification linking to the last point and written service address. Repeated stop requests do not duplicate it. The notification carries a private booking link rather than copying coordinates/address into long-lived notification text. Administrators receive the normal refresh hint and can open the same authorized booking location. Nothing is sent through email, WhatsApp or an external messaging service.

Each explicit sharing session expires after four hours. A new sharing activation uses a new session ID; a stale tab cannot stop or overwrite the newer session. **Remove my saved GPS point** stops local watching, removes the retained point and invalidates its server session. It keeps the service address. Sharing is never resumed automatically after reload.

## Maps, navigation and configuration

Interactive maps use Leaflet. No map API key is required for the default OpenStreetMap tiles. Tiles load only after **Load interactive map**; until then no map tile request is made. The map has pan/zoom controls, keyboard pan/zoom, visible attribution and separate markers for service destination, customer and professional. Reported accuracy circles are drawn for readings up to 5 km. Written coordinates and external directions remain usable when tiles fail.

`NEXT_PUBLIC_MAP_TILE_URL` optionally selects a compatible HTTPS `{z}/{x}/{y}` endpoint at build time. It is public configuration: never put private API credentials there. Use an appropriate provider for production traffic and satisfy its attribution/usage terms. The default OSM tile service is best-effort and has no SLA. Default attribution links to OpenStreetMap contributors. Review additional provider-specific attribution when changing providers. Tiles use normal browser caching; there is no bulk/offline tile download or tile proxy.

Directions open Google Maps with the selected destination: the saved service pin if present, otherwise the written address. Participants can separately open directions to a retained GPS point. Maps/navigation disclose the visible area or destination and network information to the selected third party; notices explain the choice. No reverse geocoder invents or uploads an address automatically.

## Storage, authorization and retention

- `bookings.address` / `marketplace_bookings.address`: canonical written service address.
- `booking_location_sites`: saved pin, landmark, optimistic version, update actor and consent version. Address edits are customer-only and close when service starts.
- `booking_location_shares`: one latest point per booking/participant, accuracy, observed/save times, current sharing session/sequence and explicit consent version/time. A TTL expires each record seven days after its last accepted point/start; reads also filter expiry before database background cleanup. There is no journey history. Retained backup copies follow separate backup retention.
- `booking_location_access`: administrator view audit, deduplicated within five-minute buckets and retained for 90 days.
- `platform_audit`: start/stop/forget/address action metadata; GPS coordinates are excluded from audit details.

Every API/page lookup checks persisted account activity, customer ownership, current provider assignment or current administrator role. Precise map access is removed for providers on reassignment or booking closure. Administrators can view shared data but cannot activate another participant’s GPS. Writes recheck/fence the actor, booking and token within a MongoDB transaction. Session IDs, increasing sequences and fresh GPS timestamps reject expired, replayed and out-of-order updates. Endpoints enforce same-origin mutations, strict schemas, request-size limits, shared Redis limits and private/no-store responses. The existing global 100/minute IP limit remains enabled.

## Validation

`tests/booking-location.test.ts` exercises actual isolated MongoDB/Redis ownership, consent, address versions, concurrent GPS sequences, closing/final-point retention, stale sessions, expiry, assignment changes, terminal bookings, removal and stored role/account changes. Browser acceptance in `tests/e2e/booking-location.spec.ts` covers the three roles, emulated GPS, map/navigation, closure retention, denied GPS/manual pin, map-load consent, tile failures, mobile layout and automated accessibility. Executed outcomes are recorded in VALIDATION.md; physical-device GPS and actual iOS/Safari behavior remain deployment/device checks.

On 27 October 2026, the focused backend/policy run passed 13 checks, and both Chrome and Windows WebKit passed two browser journeys each. WebKit required a test-only correction for the Windows driver's 1000-times emulated GPS timestamp; no production freshness check was relaxed. See [VALIDATION.md](VALIDATION.md) for exact evidence and scope.
