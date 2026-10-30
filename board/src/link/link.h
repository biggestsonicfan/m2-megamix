/*
 * link.h — two boards, one fight: the Model 2 communication board (link.c).
 *
 * Two cabinets, each with its own board and one player, joined by their comm
 * boards: the 1P cabinet's is the ring's master, the 2P cabinet's its slave.
 * Both boards run the whole game, menu and fight, from the same inputs a
 * frame (lockstep): each sends its player's pad for the frame LINK_DELAY
 * ahead, and a board steps frame t only once it holds both pads for t. So
 * nothing of the fight goes over but the pads, and both screens show the same
 * fight. See docs/BOARD.md, "Two cabinets: the link".
 */
#ifndef LINK_H
#define LINK_H

typedef unsigned int   lk_u32;
typedef unsigned short lk_u16;

enum { LINK_OFF, LINK_MASTER, LINK_SLAVE };            /* a cabinet's role: 1P's, 2P's */

/* where the link is, for the setup's status line */
enum {
    LS_OFF,                  /* not linked: both players on this board */
    LS_NO_BOARD,             /* no comm board answers */
    LS_WAIT,                 /* the comm board is bringing its ring up */
    LS_NO_PEER,              /* the ring came up with this board alone on it */
    LS_HELLO,                /* the ring is up: agreeing on a session */
    LS_RUN                   /* in step with the other board */
};

/* What link_pass hands back: */
enum {
    LP_LOCAL,                /* not linked (yet): this board's own pads */
    LP_SYNC,                 /* both boards start over, from the master's setup (set) */
    LP_TICK,                 /* a frame in step: both players' pads (in) */
    LP_DROP                  /* the link went: back to the setup, on this board alone */
};

#define LINK_SETS  12u       /* the setup's values the master hands the slave */
#define LINK_DELAY 3u        /* frames between a pad's press and its frame */
#define LINK_HIST  32u       /* frames of pads (and of checks) a packet carries */

/* a frame's pad: StF's pad bits (main.c pad_bits) and start (bit 8) */
#define LINK_START 0x100u

typedef struct {
    lk_u32 role, state;
    lk_u32 session;          /* the master's, which the slave takes */
    lk_u32 tick;             /* the next frame to step, in step */
    lk_u32 done;             /* frames stepped and checked (link_check) */
    lk_u32 stalls;           /* vblanks spent waiting for the other's pads */
    lk_u32 drops, desyncs;   /* links lost, and of them to a state that differed */
    lk_u32 since;            /* the vblank the other board's pads last came on */
    lk_u32 bad;              /* packets read torn or foreign */
    lk_u32 hold;             /* set: this board is busy (a fight alone), and
                              * a link waits until it is not */
} link_t;

extern link_t link;

/* The comm board answers: CN 0 reads back bit 0 clear (MAME, a real board);
 * nothing there reads all ones. */
lk_u32 link_board(void);
/* Start the comm board in a role (LINK_MASTER, LINK_SLAVE), or stop it (LINK_OFF). */
void link_start(lk_u32 role);
/* The boot's watchdog: vblanks a board with a role waits for the other cabinet
 * before it boots alone (linkplay.c link_boot) */
#define LINK_BOOT_WAIT 600u

/* Once a pass, before the pads are used: this cabinet's pad (mine), the
 * setup's values (set: read on the master, written on the slave at LP_SYNC),
 * both pads at LP_TICK (in[0] 1P's, in[1] 2P's). now is frameVBL; wait
 * waits for the next vblank (and sends the sound meanwhile). */
lk_u32 link_pass(lk_u32 mine, lk_u16 set[LINK_SETS], lk_u32 in[2], lk_u32 now, void (*wait)(void));
/* After the frame link_pass gave: a check of the state it left, sent to the
 * other board and compared with its own. */
void link_check(lk_u32 sum);
/* The cabinet's role kept in the backup RAM (the setup's LINK, at boot). */
lk_u32 link_saved(void);
void link_save(lk_u32 role);

#endif /* LINK_H */
