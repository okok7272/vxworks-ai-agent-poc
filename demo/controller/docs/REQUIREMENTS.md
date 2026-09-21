# Requirements — demo-controller v1

- REQ-01: Initialize communication_fault=0, watchdog_healthy=1, sequence=0; allow initial timeout grace period.
- REQ-02: At elapsed >=1000 ms without valid PING set communication_fault=1.
- REQ-03: At elapsed >=1500 ms without valid PING set watchdog_healthy=0.
- REQ-04: Valid PING after timeout must clear fault, restore watchdog and increment sequence once.
- REQ-05: Invalid datagrams return ERR without changing timestamps or status.
- REQ-06: Millisecond subtraction handles uint32 rollover, assuming less than one full rollover between observations.

tests/test_controller.c asserts threshold boundaries, invalid traffic, recovery and rollover.
main.c emits the documented timeout/recovery trace. These requirements describe a synthetic test controller,
not a specification for any company controller or safety-critical system.
