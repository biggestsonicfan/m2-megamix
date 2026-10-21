-- Which StF models a fight draws: every model-table entry the i960 reads
-- (main_data 0xE0004 + id*16, at 0x020E0004), counted per frame key
-- m<mode 0x50002A>.s<sub 0x500030>.st<stage 0x500064>.c<P1 char 0x510EB0>.
-- Mode 9 is the fight scene (intro, round, K.O., stage clear); 7 is select.
--
--   MT_OUT=<file> MT_FRAMES=6000 MT_CHAR=15 MT_STAGE=5 \
--   mame sfight -rompath $ROMS_DIR -video none -sound none -nothrottle
--     -skip_gameinfo -autoboot_script tools/mame/fight-models.lua
--
-- MT_CHAR forces P1's character and MT_STAGE the stage (as m2-hle2's
-- round-intro.lua); MT_SNAP=1 snapshots the first frame of each key.
-- Inputs: a coin every 600 frames from 300, Start, Punch and Kick mashed.
-- <file> gets one line per key: "<key> frames=<n> id:reads ...", then "done <n>".
local OUT    = assert(os.getenv("MT_OUT"))
local FRAMES = tonumber(os.getenv("MT_FRAMES") or "9000")
local STAGE  = tonumber(os.getenv("MT_STAGE") or "-1")
local sp = manager.machine.devices[":maincpu"].spaces["program"]
local fields = {}
for _, port in pairs(manager.machine.ioport.ports) do for name, fl in pairs(port.fields) do fields[name] = fl end end
local COIN, START, B1, B2 = fields["Coin 1"], fields["1 Player Start"], fields["P1 Punch"], fields["P1 Kick"]
local n, key = 0, "0"
local counts, keys = {}, {}
local function dump()
  local f = assert(io.open(OUT, "w"))
  for k, t in pairs(counts) do
    local ids = {}
    for id, c in pairs(t) do ids[#ids + 1] = id .. ":" .. c end
    f:write(k, " frames=", keys[k], " ", table.concat(ids, " "), "\n")
  end
  f:write("done ", n, "\n"); f:close()
end
local function set(fl, on) if fl then fl:set_value(on and 1 or 0) end end
local function edge()
  local m = n % 60
  set(COIN, n > 300 and n % 600 < 8)
  set(START, n > 300 and m < 6)
  set(B1, n > 300 and m >= 20 and m < 26)
  set(B2, n > 300 and m >= 40 and m < 46)
  key = string.format("m%d.s%d.st%d.c%d", sp:read_u8(0x50002A), sp:read_u8(0x500030), sp:read_u8(0x500064), sp:read_u8(0x510D00 + 0x1B0))
  if not keys[key] and os.getenv("MT_SNAP") then manager.machine.screens[":screen"]:snapshot(string.format("%05d_%s.png", n, key)) end
  keys[key] = (keys[key] or 0) + 1
  n = n + 1
  if n % 1000 == 0 then dump() end
  if n >= FRAMES then dump(); manager.machine:exit() end
  return nil
end
_G.MT_EDGE = sp:install_write_tap(0x50D000, 0x50D003, "mt_edge", edge)
local function rd(offset, data, mask)
  local id = (offset - 0x020E0004) // 16
  local t = counts[key]; if not t then t = {}; counts[key] = t end
  t[id] = (t[id] or 0) + 1
  return nil
end
_G.MT_READ = sp:install_read_tap(0x020E0004, 0x020E0004 + 5125 * 16 - 1, "mt_read", rd)
if STAGE >= 0 then
  _G.MT_STAGE = sp:install_write_tap(0x500064, 0x500067, "mt_stage", function(o, d, mk)
    if (mk & 0xFF) == 0 or n < 320 then return nil end
    return (d & ~0xFF) | STAGE end)
end
local CHAR = tonumber(os.getenv("MT_CHAR") or "-1")
if CHAR >= 0 then
  -- P1's character byte (player struct 0x510D00 + 0x1B0); 0x510EB0 is the low byte of its word
  _G.MT_CHAR = sp:install_write_tap(0x510EB0, 0x510EB3, "mt_char", function(o, d, mk)
    if (mk & 0xFF) == 0 then return nil end
    return (d & ~0xFF) | CHAR end)
end
