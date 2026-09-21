# Architecture — demo-controller v1

Logical UDP task: udp_event validates a datagram and updates timestamps, sequence and status.
Logical supervisor task: supervisor_tick derives communication fault and watchdog health from elapsed time.
System status: DemoController is the shared state. The finite main sequence serializes all events.
No concurrent access or thread safety is claimed; a future multi-task adapter must serialize access.

Data flow: datagram + time → udp_event → status → supervisor_tick(time) → console/validation.
The watchdog is a software communication-liveness model, not a hardware watchdog or safety function.
Invalid messages neither refresh timers nor clear a fault. Valid traffic restores both health indicators.
Use an unsigned 32-bit monotonic clock; sample intervals must be less than one complete rollover.
