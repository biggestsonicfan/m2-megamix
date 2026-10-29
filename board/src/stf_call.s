# stf_call.s: call one of StF's lifted routines (stf_motion.s) from C.
#
#   void stf_call(void (*fn)(void), void *rob, void *enemy, u32 arg);
#   void stf_task(void (*fn)(void), void *task, void *rob, void *enemy);
#   void stf_call_g01(void (*fn)(void), u32 g0, u32 g1);
#   void stf_call_g3(void (*fn)(void), void *rob, void *g3);
#
# stf_call_g01 calls a routine that takes two arguments (g0, g1), as
# send_tex_col_skin's player and character.
# stf_call_g3 calls a routine that works on a record at g3, as the spin
# smoke's steps (spin_smoke_cnt's callx) a puff.
# stf_task runs one of StF's tasks (event_loop's call): g13 its block (a
# fighter's task block is its rob), g7 and g8 the fighters.
#
# vf2_coli_push goes the other way: StF's coli_cont_cop (lift-stf.py's
# coli_cont_cop_g4) calls it for two VF2 guests, and it puts push.c's
# vf2_push(g7, g8, g13) in g4, every other g register kept.
#
# StF's code keeps its fixed registers: g7 the fighter (rob), g8 the other
# fighter, g10 0x800000, g11 0x880000 and g12 0x4000 (the coprocessor FIFO is
# (g11)[g12*1], 0x884000); its argument is g0. gcc's own g8..g13 are kept in
# this frame's locals, which call and ret save and restore.

                .text
                .align  4
                .globl  _stf_call
                .globl  _stf_task
                .globl  _stf_call_g01
                .globl  _stf_call_g3
                .globl  vf2_coli_push
vf2_coli_push:
                movq    g0, r4
                mov     g5, r8
                mov     g6, r9
                mov     g7, r10
                mov     g13, r11
                mov     g14, r12
                mov     g7, g0
                mov     g8, g1
                mov     g13, g2
                mov     0, g14
                call    _vf2_push
                mov     g0, g4
                movq    r4, g0
                mov     r8, g5
                mov     r9, g6
                mov     r10, g7
                mov     r11, g13
                mov     r12, g14
                ret
# vf2_coli_contacts, from lift-stf.py's contact_lag: VF2's contact table
# (push.c, vf2_contacts) over the copro's at 0x90F600, for the robs in g0
# and g1; every global but g8..g12 kept.
                .globl  vf2_coli_contacts
vf2_coli_contacts:
                movq    g0, r4
                movq    g4, r8
                mov     g13, r12
                mov     g14, r13
                lda     0x90F600, g2
                mov     0, g14
                call    _vf2_contacts
                movq    r4, g0
                movq    r8, g4
                mov     r12, g13
                mov     r13, g14
                ret
_stf_call_g3:
                mov     g8, r4
                mov     g9, r5
                mov     g10, r6
                mov     g11, r7
                mov     g12, r8
                mov     g13, r9
                mov     g0, r10
                mov     g1, g7
                mov     g2, g3
                mov     0, g0
                b       stf_go
_stf_call_g01:
                mov     g8, r4
                mov     g9, r5
                mov     g10, r6
                mov     g11, r7
                mov     g12, r8
                mov     g13, r9
                mov     g0, r10
                mov     g1, g0
                mov     g2, g1
                b       stf_go
_stf_task:
                mov     g8, r4
                mov     g9, r5
                mov     g10, r6
                mov     g11, r7
                mov     g12, r8
                mov     g13, r9
                mov     g0, r10
                mov     g1, g13
                mov     g2, g7
                mov     g3, g8
                mov     0, g0
                b       stf_go
_stf_call:
                mov     g8, r4
                mov     g9, r5
                mov     g10, r6
                mov     g11, r7
                mov     g12, r8
                mov     g13, r9
                mov     g0, r10
                mov     g1, g7
                mov     g2, g8
                mov     g3, g0
stf_go:
                lda     0x800000, g10
                lda     0x880000, g11
                lda     0x4000, g12
                mov     0, g14
                callx   (r10)
                mov     r4, g8
                mov     r5, g9
                mov     r6, g10
                mov     r7, g11
                mov     r8, g12
                mov     r9, g13
                mov     0, g14
                ret
