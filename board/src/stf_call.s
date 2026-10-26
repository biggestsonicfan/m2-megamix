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
