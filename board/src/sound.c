/*
 * sound.c — the sound board's queue: StF's sound_request_u and
 * sound_request_special (the lifted code calls these), the pump that feeds
 * the USART, and the codes the fight's flow sends (snd_round).
 */
#include "megamix.h"

/* ---- sound ----------------------------------------------------------------
 * StF's sound board (a 68000 running StF's sound program, epr-19021, on its
 * samples) takes 24-bit codes from the i8251 at 0x9C0000, a byte at a time,
 * the high byte first. StF's sound_request_special puts a code in a ring of
 * 32 (AUDIO_2; the count at 0x504001, dropped when it is full), and its IRQ
 * 10 (the USART ready for a byte) sends them (send_sound_code). The SDK's
 * interrupt table has no handler for IRQ 10, so the board sends from its own
 * loop: snd_pump puts out bytes while the USART takes them, without
 * waiting, and the main loop pumps while it waits for the vsync. The lifted
 * code's sound_request_u and sound_request_special come here (lift-stf.py
 * TO_C), with every register kept. */
static u32 snd_q[32], snd_head, snd_tail, snd_n, snd_code, snd_left;

void snd_request_special(u32 code) {
    if (snd_n >= 32u) return;
    snd_q[snd_head] = code;
    snd_head = (snd_head + 1u) & 31u;
    snd_n++;
}

/* sound_request_u: 0xA00001 (the sound program's reset) as it is; a code of
 * bank 0x9E is sent as 0x9C's. (StF's attract mode with its sound off in the
 * backup RAM sends nothing; the board has no attract mode.) */
void snd_request_u(u32 code) {
    if (code != 0xA00001u && (code & 0xFF0000u) == 0x9E0000u) code -= 0x20000u;
    snd_request_special(code);
}

void snd_pump(void) {
    while (M2_SND_CTL & 1u) {            /* TxRDY */
        if (!snd_left) {
            if (!snd_n) return;
            snd_code = snd_q[snd_tail];
            snd_tail = (snd_tail + 1u) & 31u;
            snd_n--;
            snd_left = 3u;
        }
        snd_left--;
        M2_SND_DATA = (snd_code >> (snd_left * 8u)) & 0xFFu;
    }
}

/* StF's sound codes for the fight's flow: SET_INT's 0xA00003 as a round is
 * set, sd_gong_4 as it starts (ROUND_DSP's gong_ring) and as it is decided
 * (JUDGE_INT), the stage's music from round 1 (stage_bgm_select's
 * STAGE_MUSIC_IN_ORDER by stage_num), and the reset that stops it when the
 * match is over (VIC_INT's 0xA00001). stage_bgm_select's 2-player cases are
 * left out: North Wind is for Sonic against Knuckles, whose slot is Akira's
 * on the board, and South Island's music for stages 4 and 5, which the board
 * does not have. A guest stage plays its own game's song, added to StF's
 * sound program's data by tools/guest-sound.mjs as a song of StF's: FV's
 * Western its western_song, StF's 26th (0xAE1019; the tool checks the
 * numbers), VF2's Tou-rin Lau's (VF2's 0xAD100B), the Colosseum Akira's
 * (0xAD1003) and Test its 0xAD1018, the 27th to 29th. */
#define SND_SET     0xA00003u
#define SND_FV_WESTERN 0xAE1019u
#define SND_VF2_TOURIN 0xAE101Au
#define SND_VF2_COLOSSEUM 0xAE101Bu
#define SND_VF2_TEST 0xAE101Cu
#define STF_STAGE_MUSIC ((const u32 *)0xDBFDCu)   /* STAGE_MUSIC_IN_ORDER, in the copied ROM */

/* by stage (stage_name's order): 0 for StF's own, by its slot */
static const u32 guest_music[STAGES] = { 0u, 0u, SND_VF2_TOURIN, SND_VF2_COLOSSEUM, SND_FV_WESTERN, SND_VF2_TEST };

void snd_round(u32 stage, const stage_t *st, u32 first) {
    snd_request_u(SND_SET);
    if (first) {
        if (st->slot != 0xFFFFu) snd_request_u(STF_STAGE_MUSIC[st->slot & 15u]);
        else if (guest_music[stage]) snd_request_u(guest_music[stage]);
    }
    snd_request_u(SND_GONG);
}
