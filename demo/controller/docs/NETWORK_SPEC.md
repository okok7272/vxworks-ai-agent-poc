# Network specification — demo-controller v1

Proposed future transport: loopback UDP port 19000 only. No socket is opened in this fixture.
The actual current interface is udp_event(status, data, byteLength, nowMs).

Request: exactly four ASCII bytes PING, no newline/NUL. Response: PONG.
Any other length/content returns ERR and leaves state unchanged. Sender identity/authentication is out of scope.
Input memory must contain byteLength valid bytes; future transport must bound receive buffers.

After 1000 ms without valid traffic, supervisor_tick sets communication_fault.
After 1500 ms without valid traffic, watchdog_healthy becomes 0.
A valid PING immediately resets both timestamps, clears communication_fault, restores watchdog_healthy,
and increments sequence. At equal timestamps process receive events before the supervisor tick.
