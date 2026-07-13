# Integration Guide — Vimal QR Check-In Feature

This file is a teammate handoff for the Vimal feature built around:
- Backend: backend/routes/vimal.js
- Frontend: frontend/src/pages/QRCheckInPage.jsx

## 1. Purpose

This feature provides a QR/manual/face-style check-in flow for delegates during a trip.
It connects the frontend scanner UI to the shared backend data layer so check-in updates appear across the app.

## 2. Main Files

### Backend
- backend/routes/vimal.js
  - Handles attendance-related APIs
  - Uses shared helpers from backend/data.js
  - Keeps the feature logic separate from the shared delegate data layer

### Frontend
- frontend/src/pages/QRCheckInPage.jsx
  - UI for the check-in screen
  - Calls the attendance APIs
  - Displays coach/trip data and scan results

## 3. Important Integration Points

### Backend integration
The backend route is already designed to work with the existing shared data layer:
- It imports helpers from backend/data.js
- It does not replace the shared delegate storage
- It updates the real delegate records through the shared helpers

This means:
- the dashboard can reflect live attendance changes
- the coach/trip views remain in sync
- the feature is additive rather than destructive

### Frontend integration
The frontend page expects the backend endpoints to be available at the API base URL used by the app.
It calls the attendance endpoints through the shared API helpers in the frontend library.

## 4. API Endpoints Used

### GET /api/attendance/coaches
Returns:
- trip metadata
- coach list
- live counts
- unassigned count

### POST /api/attendance/scan
Body example:
```json
{
  "tripId": "t-1",
  "scanData": "face:v1:abc123:...",
  "timestamp": "2026-07-13T10:00:00.000Z",
  "coachId": "c2"
}
```

Purpose:
- processes a scan
- matches a missing delegate
- updates their status to present

### GET /api/attendance/:trip_id/coach/:coach_id
Returns the reverse headcount for one coach.

### POST /api/attendance/consent
Used to grant or revoke biometric consent.

### GET /api/attendance/history/:delegate_id
Returns the local check-in history for a delegate.

### POST /api/attendance/assign-unassigned
Assigns unassigned delegates to the selected coach.

### POST /api/attendance/demo-seed
Creates demo delegates for testing when the database is empty.

## 5. Expected Data Flow

1. The frontend loads trip and coach overview data.
2. The user selects a coach or starts a scan.
3. The frontend sends a scan request to the backend.
4. The backend checks the real delegate list and updates the correct delegate.
5. The UI refreshes the coach view and overview data.

## 6. Notes for Teammates

- Do not overwrite the shared data logic in backend/data.js.
- Keep the check-in feature isolated in the Vimal route and page.
- The frontend should rely on the existing API wrapper for requests.
- If the backend is not running, the UI should show a clear error message.
- The scan flow is designed to be compatible with the current app structure and route setup.

## 7. Quick Test Checklist

- Backend route is mounted correctly
- Frontend can load the trip/coach overview
- Scan request returns a valid response
- Delegate status updates correctly
- Coach headcount refreshes after a scan
- Consent and history endpoints work as expected

## 8. Common Issues

### Backend not responding
- Check whether the route is mounted in the server entry file
- Confirm the backend is running
- Verify the API URL in the frontend config

### Frontend cannot load attendance data
- Confirm that the attendance endpoints exist
- Check auth/session handling
- Confirm the backend returns JSON correctly

### Scan fails unexpectedly
- Make sure the delegate pool is not empty
- Confirm the coach selected is valid
- Check whether the delegate is still in the missing state

## 9. Summary

This feature is already structured as a modular integration point:
- the backend handles attendance logic
- the frontend provides the user interaction layer
- the shared data layer remains the source of truth

If your group needs to extend this feature, keep the same pattern and avoid breaking the shared data flow.
