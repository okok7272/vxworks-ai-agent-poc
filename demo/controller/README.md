# Demo Controller

Newly authored, public-shareable test fixture. No company source, hardware data, vendor code or SDK binary.
One portable C translation unit fits the current single-source application boundary; no new build framework.
It is available through **Run Demo Scenario** in the Agent panel using a restricted model backend.
See [panel usage](../../docs/DEMO_SCENARIO_USAGE.md). It is not wired into the Hello World build scripts.

The fixture models UDP task events and a supervisor/watchdog task using an injected millisecond clock.
It does not open a socket, spawn an RTOS task or access hardware. A future VxWorks adapter would supply
datagrams and monotonic time. The current entry point runs a finite deterministic event sequence.

- [Architecture](docs/ARCHITECTURE.md)
- [Network contract](docs/NETWORK_SPEC.md)
- [Requirements](docs/REQUIREMENTS.md)
- Source: src/main.c; host assertions: tests/test_controller.c.

Optional host-only unit check (ordinary C compiler, never wr-cc):

~~~sh
cc -std=c99 -Wall -Wextra -Werror tests/test_controller.c -o /tmp/demo-controller-test
/tmp/demo-controller-test
~~~

Expected demo trace (not proof of a VxWorks run):

~~~text
UDP PONG
TIMEOUT fault=1 watchdog=0
UDP PONG
RECOVERED fault=0 watchdog=1 sequence=2
~~~

No intentional defect is enabled in this baseline. The panel creates an approved isolated copy with a
seeded watchdog timestamp defect and removes the working copy after validation. Never modify the SDK/Hello World.
