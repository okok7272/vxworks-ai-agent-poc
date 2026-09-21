#define DEMO_NO_MAIN
#include "../src/main.c"
#include <assert.h>

int main(void)
{
    DemoController s;
    controller_init(&s, 0u);
    supervisor_tick(&s, 999u); assert(!s.communication_fault);
    supervisor_tick(&s, 1000u); assert(s.communication_fault && s.watchdog_healthy);
    supervisor_tick(&s, 1500u); assert(!s.watchdog_healthy);
    assert(strcmp(udp_event(&s, "BAD", 3u, 1600u), "ERR") == 0);
    assert(s.last_rx_ms == 0u && s.communication_fault && !s.watchdog_healthy);
    assert(strcmp(udp_event(&s, "PING", 4u, 1700u), "PONG") == 0);
    supervisor_tick(&s, 1701u);
    assert(!s.communication_fault && s.watchdog_healthy && s.sequence == 1u);
    controller_init(&s, UINT32_MAX - 499u);
    supervisor_tick(&s, 499u); assert(!s.communication_fault);
    supervisor_tick(&s, 500u); assert(s.communication_fault);
    puts("Demo controller host unit PASS");
    return 0;
}
