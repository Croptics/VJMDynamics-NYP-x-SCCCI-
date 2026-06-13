/**
 * Screen 3 — Trip Booking & Dynamic Coach Management (Desmond).
 * Structural placeholder. To build:
 *  - Trip + itinerary editor (CRUD on /trips, /coaches, itinerary)
 *  - Coach assignment board: columns per coach + Unassigned
 *  - Drag-and-drop reassignment (PATCH /api/delegates/:id/coach)
 *  - Capacity-override warning when a target coach is full
 */
export default function TripCoachPage() {
  return (
    <div className="page">
      <div className="page-eyebrow">Trip management</div>
      <h1 className="page-title">Trips &amp; coaches</h1>
      <p className="page-sub">Manage itineraries and reassign delegates between coaches on the fly.</p>
      <div className="scaffold" style={{ marginTop: 20 }}>
        <h2>Trip Booking &amp; Dynamic Coach Management</h2>
        <p>Itinerary editor and drag-and-drop coach reassignment board.</p>
        <span className="owner">Owner · Desmond</span>
      </div>
    </div>
  );
}
