/*
 * link.c — the Model 2 communication board, and two boards in step over it.
 *
 * The comm board (837-11615 on Model 2B, MAME m2comm.cpp) is a Z80 with 16 KB
 * of RAM the i960 shares, and two registers:
 *
 *   0x01A10000  shared RAM (also at 0x01A00000; Virtual-On and Motor Raid use
 *               this mirror)
 *     +0x00     the ring: 1 up (0 not yet, 0xFF failed)
 *     +0x01     the cabinet's role, which the program writes once the board
 *               runs: 1 master, 2 slave (the board's reset value)
 *     +0x02     this node's id, +0x03 the nodes on the ring, once it is up
 *     +0x12     the frame size, +0x14 the frame offset (0x1C0), little-endian
 *     +0x2000   this node's frame: the Z80 sends the frame offset's bytes
 *               from here, once a vblank
 *     +0x2000 + offset
 *               the frame the Z80 took from the node one hop up the ring, the
 *               other board's on a ring of two
 *   0x01A14000  CN: 1 starts the board (the RAM cleared, the ring brought
 *               up), 0 stops it. A board reads bit 0 back as written; with no
 *               board the bus reads all ones (Motor Raid's checkBoard:
 *               "Nothing Communication Board!")
 *   0x01A14002  FG: bit 0 written 1 also makes a master (EPR-16726); bit 7
 *               toggles as frames come in
 *
 * The ring: once both boards run, the master waits about four seconds, then
 * sends its id token round the ring, and each node writes +0 = 1, its id and
 * the count. From then on, every vblank the master sends its frame and the
 * slave answers each frame it takes with its own. The frame the other board
 * sent stays in the RAM until the next replaces it.
 *
 * That transport is what Virtual-On and Motor Raid build on (m2-hle2
 * src/board/m2comm.h, YAMP's von-comm-packet.md and mr-comm-packet.md): each
 * keeps a packet in its frame, stamped so a torn or stale one is told apart
 * (Virtual-On's seq ^ 0xAE5E, Motor Raid's alive counter), with the master's
 * settings in it for the slave to take. A fighting game needs both boards to
 * see the same pads on the same frame, so this one sends pads, not state: a
 * packet holds this cabinet's last LINK_HIST frames of pad (a frame lost or
 * read twice loses nothing), and each board steps a frame only once it holds
 * the other's pad for it (lockstep). Pads go out LINK_DELAY frames ahead of
 * their frame, so in the steady state neither waits. A check of each
 * stepped frame's state rides along: boards whose fights part (a desync) start
 * over from the master's setup.
 *
 * Packet, at 0x2000 (32-bit words):
 *   magic, state | role << 8 | hold << 16, session, known (the frames < known have pads),
 *   check_at (frames stepped), check (their state), in[LINK_HIST] (u16,
 *   in[t % LINK_HIST] the pad for frame t), set[LINK_SETS] (u16, the master's
 *   setup), sum (of everything before it)
 */
#include "link.h"

#define COMM_RAM   0x01A10000u
#define COMM_CN    (*(volatile unsigned char *)0x01A14000u)
#define COMM_FG    (*(volatile unsigned char *)0x01A14002u)
#define COMM_B(o)  (*(volatile unsigned char *)(COMM_RAM + (o)))
#define COMM_FRAME 0x2000u

#define LINK_MAGIC   0x4D4D5831u     /* "MMX1" */
#define LINK_TIMEOUT 300u            /* vblanks without the other's pads: the link is gone */
#define BACKUP_LINK  ((volatile lk_u32 *)0x01D03FF0u)   /* past StF's settings in the backup RAM */

typedef struct {
    lk_u32 magic, head, session, known, check_at, check;
    lk_u16 in[LINK_HIST];
    lk_u16 set[LINK_SETS];
    lk_u32 sum;
} pkt_t;

#define PKT_WORDS (sizeof(pkt_t) / 4u)

link_t link;
static pkt_t out, peer;                      /* this board's packet, the other's last good one */
static lk_u32 checks[LINK_HIST];             /* this board's checks, by frame */

static lk_u32 pkt_sum(const pkt_t *p) {
    const lk_u32 *w = (const lk_u32 *)p;
    lk_u32 s = LINK_MAGIC, i;
    for (i = 0; i < PKT_WORDS - 1u; i++) s = (s ^ w[i]) * 0x01000193u + (s >> 15);
    return s;
}

static lk_u32 frame_offset(void) {
    lk_u32 o = COMM_B(0x14) | (lk_u32)COMM_B(0x15) << 8;
    return o >= sizeof(pkt_t) && o <= 0x1000u ? o : 0x1C0u;
}

static void pkt_send(void) {
    volatile lk_u32 *d = (volatile lk_u32 *)(COMM_RAM + COMM_FRAME);
    const lk_u32 *s = (const lk_u32 *)&out;
    lk_u32 i;
    out.magic = LINK_MAGIC;
    out.sum = pkt_sum(&out);
    for (i = 0; i < PKT_WORDS; i++) d[i] = s[i];
}

/* The other board's packet, if one is there whole and is the other role's:
 * the Z80 may write a frame while it is read, so a read that does not add
 * up is tried again. */
static lk_u32 pkt_take(void) {
    volatile lk_u32 *s = (volatile lk_u32 *)(COMM_RAM + COMM_FRAME + frame_offset());
    pkt_t p;
    lk_u32 *d = (lk_u32 *)&p, i, k;
    for (k = 0; k < 3u; k++) {
        for (i = 0; i < PKT_WORDS; i++) d[i] = s[i];
        if (p.magic != LINK_MAGIC || p.sum != pkt_sum(&p)) continue;
        /* a ring of one hands a node its own frame back */
        if ((p.head >> 8 & 0xFFu) == link.role) break;
        peer = p;
        return 1u;
    }
    link.bad++;
    return 0u;
}

lk_u32 link_board(void) {
    COMM_CN = 0u;
    return !(COMM_CN & 1u);
}

void link_start(lk_u32 role) {
    lk_u32 i;
    COMM_CN = 0u;
    COMM_FG = 0u;
    link.role = role;
    link.session = link.tick = link.done = 0u;
    for (i = 0; i < PKT_WORDS; i++) ((lk_u32 *)&out)[i] = ((lk_u32 *)&peer)[i] = 0u;
    if (role == LINK_OFF) { link.state = LS_OFF; return; }
    if (!link_board()) { link.state = LS_NO_BOARD; return; }
    COMM_CN = 1u;                            /* the RAM cleared, +1 = 2 (a slave) */
    COMM_B(1) = (unsigned char)role;
    COMM_FG = role == LINK_MASTER ? 1u : 0u;
    link.state = LS_WAIT;
}

/* The link gone: this board alone until a new session starts in step. A
 * ring that went down, or another board gone quiet, brings the comm board
 * up again (as Motor Raid's _ResetCommBoard does), for the ring to come up
 * once the other is back; boards that only parted (a desync) keep the ring. */
static lk_u32 drop(lk_u32 ring) {
    lk_u32 d = link.drops + 1u;
    if (ring) link_start(link.role);
    else {
        link.state = LS_HELLO;
        link.session = link.tick = link.done = 0u;
    }
    link.drops = d;
    return LP_DROP;
}

static void head(lk_u32 state) {
    out.head = state | link.role << 8 | (link.hold ? 1u : 0u) << 16;
    out.session = link.session;
}

lk_u32 link_pass(lk_u32 mine, lk_u16 set[LINK_SETS], lk_u32 in[2], lk_u32 now, void (*wait)(void)) {
    lk_u32 i, t, me = link.role == LINK_SLAVE;
    if (link.state <= LS_NO_BOARD) return LP_LOCAL;
    if (COMM_B(0) != 1u || COMM_B(3) < 2u) {
        lk_u32 was = link.state;
        link.state = COMM_B(0) == 1u ? LS_NO_PEER : LS_WAIT;
        return was == LS_RUN ? drop(1u) : LP_LOCAL;
    }
    if (link.state < LS_HELLO) {
        link.state = LS_HELLO;
        link.session = 0u;
    }
    if (link.state == LS_HELLO) {
        lk_u32 got = pkt_take();
        if (link.role == LINK_MASTER) {
            if (!link.session) link.session = (now * 0x9E3779B9u ^ link.drops << 24) | 1u;
            for (i = 0; i < LINK_SETS; i++) out.set[i] = set[i];
            head(LS_HELLO);
            pkt_send();
            /* both boards free: the slave has the session and is not busy */
            if (!got || peer.session != link.session || link.hold || (peer.head >> 16 & 1u)) return LP_LOCAL;
        } else {
            if (got && peer.session) {
                if ((peer.head & 0xFFu) == LS_RUN && peer.session == link.session) {
                    for (i = 0; i < LINK_SETS; i++) set[i] = peer.set[i];
                } else link.session = peer.session;
            }
            head(LS_HELLO);
            pkt_send();
            if (!got || (peer.head & 0xFFu) != LS_RUN || peer.session != link.session) return LP_LOCAL;
        }
        /* in step from frame 0: the first LINK_DELAY frames have no pads */
        link.state = LS_RUN;
        link.tick = link.done = 0u;
        link.since = now;
        for (i = 0; i < LINK_HIST; i++) out.in[i] = 0u;
        out.known = LINK_DELAY;
        out.check_at = 0u;
        head(LS_RUN);
        pkt_send();
        return LP_SYNC;
    }

    /* in step: this pad for frame t + LINK_DELAY, then the other's for t */
    t = link.tick;
    out.in[(t + LINK_DELAY) % LINK_HIST] = (lk_u16)mine;
    out.known = t + LINK_DELAY + 1u;
    head(LS_RUN);
    pkt_send();
    for (;;) {
        if (pkt_take()) {
            if (peer.session != link.session) return drop(0u);
            if ((peer.head & 0xFFu) == LS_RUN && peer.known > t) break;
        }
        if (COMM_B(0) != 1u || now - link.since > LINK_TIMEOUT) return drop(1u);
        wait();
        now++;
        link.stalls++;
    }
    link.since = now;
    /* the other's check of a frame this board has stepped too */
    if (peer.check_at && peer.check_at <= link.done && link.done - peer.check_at < LINK_HIST &&
        peer.check != checks[(peer.check_at - 1u) % LINK_HIST]) {
        link.desyncs++;
        return drop(0u);
    }
    in[me] = out.in[t % LINK_HIST];
    in[me ^ 1u] = peer.in[t % LINK_HIST];
    link.tick = t + 1u;
    return LP_TICK;
}

void link_check(lk_u32 sum) {
    if (link.state != LS_RUN) return;
    checks[link.done % LINK_HIST] = sum;
    link.done++;
    out.check_at = link.done;
    out.check = sum;
}

lk_u32 link_saved(void) {
    lk_u32 r = BACKUP_LINK[1];
    return BACKUP_LINK[0] == LINK_MAGIC && BACKUP_LINK[2] == ~r && r <= LINK_SLAVE ? r : LINK_OFF;
}

void link_save(lk_u32 role) {
    BACKUP_LINK[0] = LINK_MAGIC;
    BACKUP_LINK[1] = role;
    BACKUP_LINK[2] = ~role;
}
