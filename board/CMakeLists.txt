cmake_minimum_required(VERSION 3.20)

# m2-megamix's board build: a new program for the Sonic the Fighters board (Model 2B),
# built against m2-sdk (headers, i960 boot assembly, linker script, ROM splitter).
#
#   node tools/bake-board.mjs                        (board/src/poses.h, from the ROM sets)
#   python3 tools/lift-stf.py                        (board/src/stf_motion.s, .h, stf_rom_80000.bin,
#                                                     from the StF disassembly)
#   node tools/import-assets.mjs                     (board/roms/sfight/'s data ROMs, only the assets used)
#   cmake -G "Unix Makefiles" -B <build> -S board
#   make -C <build> -j2                              -> board/roms/sfight/epr-19001.15, epr-19002.16
#
# m2-sdk is expected beside this checkout (-DM2_SDK=<path> otherwise).
set(M2_SDK "${CMAKE_CURRENT_SOURCE_DIR}/../../m2-sdk" CACHE PATH "Path to the m2-sdk checkout")
if(NOT EXISTS "${M2_SDK}/src/m2.h")
    message(FATAL_ERROR "m2-sdk not found at ${M2_SDK} (set -DM2_SDK=<path>)")
endif()
if(NOT CMAKE_TOOLCHAIN_FILE)
    set(CMAKE_TOOLCHAIN_FILE "${M2_SDK}/toolchain-i960-elf.cmake")
endif()

project(m2_megamix C ASM)

if(NOT EXISTS "${CMAKE_SOURCE_DIR}/src/poses.h")
    message(FATAL_ERROR "src/poses.h is missing: run node tools/bake-board.mjs first")
endif()
if(NOT EXISTS "${CMAKE_SOURCE_DIR}/src/stf_motion.s")
    message(FATAL_ERROR "src/stf_motion.s is missing: run python3 tools/lift-stf.py first")
endif()

set(M2_STARTUP_ASM
    ${M2_SDK}/src/kx_init.s
    ${M2_SDK}/src/kx_ftbl.s
    ${M2_SDK}/src/i_table.s
    ${M2_SDK}/src/i_handle.s)

# The program's modules (src/*.c) are compiled as one unit through megamix.c,
# which includes them: the header-only SDK defines its functions in the
# headers (M2_API=, below), so a module built on its own would carry its own copy.
add_executable(game.elf ${M2_STARTUP_ASM} src/megamix.c src/link.c src/carry.c src/push.c src/stf_call.s src/stf_motion.s)
# StF's motion code keeps its ROM tables' addresses (.stfrom, 0x80000..0xFFFFF).
set_source_files_properties(src/stf_motion.s PROPERTIES
    COMPILE_OPTIONS "-Wa,-I${CMAKE_SOURCE_DIR}/src"
    OBJECT_DEPENDS "${CMAKE_SOURCE_DIR}/src/stf_rom_80000.bin")
# carry.c and push.c alone on the i960's floating point (the rest is soft-float, below):
# its last -mnumerics wins over the target's -msoft-float.
set_source_files_properties(src/carry.c src/push.c PROPERTIES COMPILE_OPTIONS "-mnumerics")
target_include_directories(game.elf PRIVATE src "${M2_SDK}/src")
target_compile_options(game.elf PRIVATE $<$<COMPILE_LANGUAGE:C>:-O2>)
target_compile_definitions(game.elf PRIVATE $<$<COMPILE_LANGUAGE:C>:M2_API=>)
set_target_properties(game.elf PROPERTIES SUFFIX "")
target_link_options(game.elf PRIVATE
    -nostdlib
    "-T${M2_SDK}/lib/testlinkrom_elf.ld"
    "-Wl,--section-start=.stfrom=0x80000"
    "-Wl,-Map=game.map")

include("${M2_SDK}/cmake/m2sdk.cmake")
if(M2_SOFTFLOAT)
    m2sdk_softfloat(game.elf)
endif()

find_package(Python3 REQUIRED COMPONENTS Interpreter)

# roms/sfight/: the program EPROM pair, beside the data ROMs tools/import-assets.mjs
# writes there. MAME runs it with -rompath board/roms alone.
set(ROM_DIR "${CMAKE_SOURCE_DIR}/roms/sfight")
add_custom_target(rom ALL
    COMMAND ${CMAKE_COMMAND} -E make_directory "${ROM_DIR}"
    COMMAND ${CMAKE_OBJCOPY} -O binary $<TARGET_FILE:game.elf> game.bin
    COMMAND ${Python3_EXECUTABLE} "${M2_SDK}/tools/stfbin2rom.py"
            --input game.bin --output "${ROM_DIR}"
    DEPENDS game.elf
    WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
    VERBATIM)
