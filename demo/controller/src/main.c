/* Original public fixture. Logical tasks/events; no sockets, hardware or VxWorks APIs. */
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#define DEMO_TIMEOUT_MS 1000u
#define DEMO_WATCHDOG_MS 1500u

typedef struct {
    uint32_t last_rx_ms;
    uint32_t watchdog_ms;
    unsigned sequence;
    int communication_fault;
    int watchdog_healthy;
} DemoController;

static void controller_init(DemoController *s, uint32_t now)
{
    *s = (DemoController){now, now, 0u, 0, 1};
}

/* UDP task adapter: exactly one length-delimited PING datagram; no NUL required. */
static const char *udp_event(DemoController *s, const char *data, unsigned length, uint32_t now)
{
    if (length != 4u || memcmp(data, "PING", 4u) != 0)
        return "ERR";
    s->last_rx_ms = now;
    s->communication_fault = 0;
    s->watchdog_ms = now;
    s->watchdog_healthy = 1;
    s->sequence++;
    return "PONG";
}

/* Supervisor logical task. Unsigned subtraction supports one clock rollover. */
static void supervisor_tick(DemoController *s, uint32_t now)
{
    s->communication_fault = (uint32_t)(now - s->last_rx_ms) >= DEMO_TIMEOUT_MS;
    s->watchdog_healthy = (uint32_t)(now - s->watchdog_ms) < DEMO_WATCHDOG_MS;
}

#ifndef DEMO_NO_MAIN
int main(void)
{
    DemoController status;
    controller_init(&status, 0u);
    printf("UDP %s\n", udp_event(&status, "PING", 4u, 100u));
    supervisor_tick(&status, 1600u);
    printf("TIMEOUT fault=%d watchdog=%d\n", status.communication_fault, status.watchdog_healthy);
    printf("UDP %s\n", udp_event(&status, "PING", 4u, 1700u));
    supervisor_tick(&status, 1701u);
    printf("RECOVERED fault=%d watchdog=%d sequence=%u\n",
           status.communication_fault, status.watchdog_healthy, status.sequence);
    return status.communication_fault || !status.watchdog_healthy;
}
#endif
