cmake_minimum_required(VERSION 3.20)

# m2-megamix's board build: a new program for the Sonic the Fighters board (Model 2B),
# built against m2-sdk (headers, i960 boot assembly, linker script, ROM splitter).
#
#   node tools/bake-board.mjs                        (board/src/poses.h, from the ROM sets)
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

set(M2_STARTUP_ASM
    ${M2_SDK}/src/kx_init.s
    ${M2_SDK}/src/kx_ftbl.s
    ${M2_SDK}/src/i_table.s
    ${M2_SDK}/src/i_handle.s)

add_executable(game.elf ${M2_STARTUP_ASM} src/megamix.c)
target_include_directories(game.elf PRIVATE src "${M2_SDK}/src")
target_compile_options(game.elf PRIVATE $<$<COMPILE_LANGUAGE:C>:-O2>)
target_compile_definitions(game.elf PRIVATE $<$<COMPILE_LANGUAGE:C>:M2_API=>)
set_target_properties(game.elf PROPERTIES SUFFIX "")
target_link_options(game.elf PRIVATE
    -nostdlib
    "-T${M2_SDK}/lib/testlinkrom_elf.ld"
    "-Wl,-Map=game.map")

include("${M2_SDK}/cmake/m2sdk.cmake")
if(M2_SOFTFLOAT)
    m2sdk_softfloat(game.elf)
endif()

find_package(Python3 REQUIRED COMPONENTS Interpreter)

# roms/sfight/: the program EPROM pair. Put the folder before the stock sfight.zip
# on MAME's -rompath.
set(ROM_DIR "${CMAKE_SOURCE_DIR}/roms/sfight")
add_custom_target(rom ALL
    COMMAND ${CMAKE_COMMAND} -E make_directory "${ROM_DIR}"
    COMMAND ${CMAKE_OBJCOPY} -O binary $<TARGET_FILE:game.elf> game.bin
    COMMAND ${Python3_EXECUTABLE} "${M2_SDK}/tools/stfbin2rom.py"
            --input game.bin --output "${ROM_DIR}"
    DEPENDS game.elf
    WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
    VERBATIM)
