# AI Reflection — Desmond (Trip Booking & Dynamic Coach Management)

#  Where AI genuinely added value

I used Claude as a high-speed pair-programmer, treating it like an eager junior dev who knows syntax perfectly but lacks architectural foresight. It was fantastic for scaffolding, but I had to hold the steering wheel for all the actual logic and design decisions.

Turning a vague brief into testable phases. The UX brief for the "premium ops dashboard" was incredibly broad. The AI helped me break it down into actionable, sequential chunks: itinerary hierarchy, capacity guards, offline queueing, and backend robustness. Getting that working shape quickly allowed me to focus on edge cases rather than boilerplate.

The robustness I wouldn't have written by hand. Writing the reassignment endpoint was complex. AI helped me implement optimistic locking for concurrent live edits, seat capacity enforcement, and coach-trip validation. More importantly, it helped back this logic up with 36 passing unit tests much faster than I could have typed them.

Verification instead of "it works." Rather than just claiming the code worked, AI actually ran the tests and drove the live app (logging in, reassigning, checking the network tab and the DOM). When its headless browser couldn't render screenshots, it admitted it and fell back to console checks. Proving the work via the DOM built much more trust than an AI hallucinating a success message.

# Where I rejected or significantly changed AI's suggestions

This is where the real work happened. The AI frequently optimized for the easiest path or the "happy path," requiring me to step in and enforce actual engineering standards.

The test-runner hang — separating pure logic from side-effects. The AI originally dumped the reassignment decision logic straight into trip.js. It worked in the browser, but importing that file in my unit tests hung the runner for 60 seconds because it opened a Postgres connection pool at load time. I had to rip the pure logic out into a dedicated reassign-core.js file with zero database imports, bringing test execution down to ~200ms. Lesson: AI doesn't instinctively design for testability. I had to enforce the boundary between business logic and database infrastructure.

Offline sync — deliberately dropping the lock. For live edits, I explicitly wanted optimistic locking so two dispatchers wouldn't overwrite each other. The AI applied this lock universally. But for an offline move that gets replayed on reconnect, enforcing that lock would reject the queued action entirely just because the state shifted slightly. I overrode the AI to deliberately drop the lock for offline moves (reverting to last-write-wins), ensuring the app gracefully merges actions when signal returns instead of throwing a wall of errors at the user.

The capacity check — distrusting client-side guards. The AI built a slick front-end dialog that stopped the user if a "coach is full," and was ready to call it a day. I rejected stopping there. A UI-only check is just a polite suggestion that anyone can bypass with cURL or DevTools. I forced the server to independently enforce the capacity limit (returning a 409 Conflict unless explicitly overridden) to actually protect the database from overbooking. Lesson: AI optimizes for UX; I have to optimize for the actual security and trust boundary.

Navigating ownership — avoiding messy hacks in shared code. I needed to adjust how delegates were handled, but that route belonged to my teammate JQ, and I couldn't safely edit it. The AI tried to hack around it with messy intercepts. I scrapped that approach and built a dedicated, strictly-validated endpoint in my own file, pointing my board there instead. It decoupled my feature and prevented merge conflicts down the line.

Parsing state — rejecting brittle regex. To figure out a coach's capacity dynamically, the AI wrote a complex regex to extract "45" from the UI string "Seats: 45". I threw that out immediately. Scraping UI text is incredibly brittle—if a designer changes the label, the whole feature breaks. Instead, I changed the DOM to pass the raw integer safely in a data-capacity HTML attribute.

Test suite isolation. The AI recommended keeping my unit tests permanently siloed in a tests/desmond/ folder for grading. While I kept it temporarily to make the marker's life easier, I added notes for the team on how to integrate them into the main suite post-assessment. Lesson: Siloed tests by developer name is a terrible practice for a real CI/CD environment.

# What I'd do differently / take forward

Code structure is dictated by testability: The Postgres connection hang proved that if I can't test a pure function in milliseconds, the architecture is fundamentally flawed. I will design with dependency injection in mind from day one next time.

Happy paths are liars: A passing test isn't proof of correctness. We almost got burned by the offline queue failing silently because the happy-path test never simulated a dropped connection mid-sync. Next time, I will force the AI to write the failure-state and edge-case tests before writing the implementation.

AI is an engine, not the driver: AI is incredibly fast at churning out the 'how' (implementation), but I have to firmly own the 'what' and 'why' (architecture and trade-offs). In the future, I’ll spend more time writing a rock-solid architectural plan before letting the AI generate a single line of code.