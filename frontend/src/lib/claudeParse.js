import { apiPost } from "./api.js";

/**
 * Document parsing bridge (Vance's enhanced capability).
 *
 * PRODUCTION PATH
 * ---------------
 * The PDF is uploaded to the backend, which calls the Anthropic Claude API
 * **server-side** (the API key never touches the browser). Claude reads each
 * passport page and returns structured rows. The server prompt instructs Claude
 * to return ONLY JSON:
 *
 *   [{ "fullName", "passportNumber", "nationality", "passportExpiry", "confidence" }]
 *
 * Low-confidence rows (< 0.85) are flagged for manual review, satisfying the
 * "blurry document" alternative flow from Use Case 1.
 *
 * DEMO PATH
 * ---------
 * When no backend is reachable (USE_SIMULATION = true), we return realistic
 * dummy rows so the page is immediately runnable with built-in state.
 */

const USE_SIMULATION = true; // flip to false once the backend is live

const SIMULATED_ROWS = [
  { fullName: "Lim Wei Jie",   passportNumber: "S1234567A", nationality: "Singapore", passportExpiry: "2029-08-12", confidence: 0.99 },
  { fullName: "Chen Hao Ming", passportNumber: "E2233445C", nationality: "China",     passportExpiry: null,         confidence: 0.62 },
  { fullName: "Tan Siew Ling", passportNumber: "S9876543B", nationality: "Singapore", passportExpiry: "2031-03-04", confidence: 0.92 },
  { fullName: "Ng Soo Peng",   passportNumber: "S4456781C", nationality: "Singapore", passportExpiry: "2028-11-20", confidence: 0.97 },
  { fullName: "Wong Pei Shan", passportNumber: "S5567892D", nationality: "Singapore", passportExpiry: "2030-06-15", confidence: 0.94 },
  { fullName: "Goh Mei Ling",  passportNumber: "S6678903E", nationality: "Singapore", passportExpiry: "2027-02-28", confidence: 0.88 },
  { fullName: "Koh Siew Wah",  passportNumber: "K9012345F", nationality: "Malaysia",  passportExpiry: null,         confidence: 0.71 },
  { fullName: "Phua Yong Min", passportNumber: "S7789014G", nationality: "Singapore", passportExpiry: "2032-09-09", confidence: 0.96 },
  { fullName: "Sim Tian Kee",  passportNumber: "S8890125H", nationality: "Singapore", passportExpiry: "2029-12-01", confidence: 0.91 },
  { fullName: "Yeo Pei Lin",   passportNumber: "S9901236J", nationality: "Singapore", passportExpiry: "2030-04-17", confidence: 0.95 },
  { fullName: "Wong Hui Bin",  passportNumber: "S1012347K", nationality: "Singapore", passportExpiry: "2028-07-22", confidence: 0.93 },
  { fullName: "Guo Wei Jian",  passportNumber: "G2123458L", nationality: "China",     passportExpiry: "2031-01-30", confidence: 0.69 },
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Parse a single uploaded file into delegate rows.
 * @returns {Promise<{rows: Array, totalCount: number}>}
 */
export async function parseDocument(file, { documentId, tripId } = {}) {
  if (!USE_SIMULATION && documentId) {
    const data = await apiPost(`/documents/${documentId}/parse`, { tripId });
    return { rows: data.rows, totalCount: data.rows.length };
  }

  // --- simulated extraction (immediately runnable) ---
  await wait(1400 + Math.random() * 1200); // mimic network + model latency
  // Vary how many rows each file "contains" so multiple uploads look distinct.
  const count = file?.name?.includes("batch_2") ? 12 : SIMULATED_ROWS.length;
  const rows = SIMULATED_ROWS.slice(0, count).map((r, i) => ({
    id: `${file?.name || "file"}-${i}`,
    needsReview: r.confidence < 0.85,
    ...r,
  }));
  return { rows, totalCount: count };
}
