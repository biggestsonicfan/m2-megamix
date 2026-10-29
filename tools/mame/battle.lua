-- One two-player battle, the same in a source game and on the board build:
-- set the fight up, play a seeded input script from each round's start, and
-- log both fighters every frame of every round. tools/grade-battle.mjs
-- compares two such logs (docs/GRADING.md).
--
--   BT_GAME=stf BT_P1=0 BT_P2=15 BT_STAGE=1 BT_SEED=1 BT_OUT=<file> \
--   mame sfight -rompath $ROMS_DIR -video none -sound none -nothrottle \
--     -skip_gameinfo -autoboot_script tools/mame/battle.lua
--
-- BT_GAME   stf: real Sonic the Fighters (sfight), a 2P versus.
--           vf2: real Virtua Fighter 2 (vf2, Version 2.1), a 2P versus;
--           run it on an empty -nvram_directory (credits are kept there).
--           fv: real Fighting Vipers (fvipers, Revision D), a 2P versus.
--           board: the board build (sfight -rompath board/roms;$ROMS_DIR),
--           its setup menu set by BT_MENU (below).
-- BT_P1/P2  stf: StF's character numbers (Sonic 0, Eggman 8, Honey 15),
--           forced on the select screen (their robs' +0x1B0).
--           vf2: VF2's, the roster's order (Akira 0, Lau 4, Jeffry 5;
--           default 0 for both), the same way. 2P wears 1P's colours: the
--           game's second colours for a same pick (13 + n) do not come.
--           fv: FV's (Jane 0, Grace 1, Honey 2, Tokio 3, Bahn 4, Picky 5,
--           Raxel 6, Sanman 7, Mahler 8, B.M. 9; default Mahler for both),
--           the same way. 2P picking 1P's fighter gets FV's second colours
--           (+0x1B0 13 + n, Mahler's purple; +0x1B1 is n), and that is kept.
-- BT_STAGE  stf: StF's stage number, forced on 0x500064 (-1 leaves it).
--           vf2: VF2's, the same way: 0 Akira's (the board's Tou-rin),
--           1 the Colosseum, 5 Jeffry's island.
--           fv: FV's stage slot, the same way (default 0, Western).
-- BT_TIME, BT_WINS  fv: the round time (default 30) and the rounds to win
--           (default 2), forced on 0x500090 and 0x500052.
-- BT_MENU   board: the menu's values "time,round,stage,p1,p2,energy,barrier"
--           (the menu's own indices), e.g. "30,2,0,0,1,140,5".
-- BT_SEED   the input script's seed (its own LCG, so both games get the
--           same script); BT_INPUTS=<file> plays a written one instead:
--           lines "<frame> <p1> <p2>", each pad a string of U D L R P K G
--           (or -), held from that frame of the round on.
-- BT_RECORD=<file>  write the replay: what was pressed, by round, as lines
--           "r<round> <frame> <p1> <p2>" (each pad as BT_INPUTS', from the
--           round's start, BT_LEAD in it), one each time a pad changes.
-- BT_REPLAY=<file>  play a written replay (BT_RECORD's) instead of the
--           script: each round its own lines; a round it lacks, no input.
-- BT_LEAD   frames of no input before the script, from the round's start
--           (default 30), so the games' few frames of intro pose do not
--           eat its first presses.
-- BT_ROUNDS how many rounds to log at most (default: the match).
-- BT_FRAMES the run's frame limit (default 20000).
-- BT_TRACE_BOOT, BT_TRACE_PAD: debugging, to stderr: the modes every 60
--           frames; every write to 1P's pad from the round's start, by pc.
--
-- A round starts on the first frame game_timer (0x500028) counts down
-- with both fighters' energy up, in every game, and ends when also_sub_mode (0x500031) is JUDGE_DSP (13)
-- or the clock stops (fv: in the fight, mode 9, only). Frame k of a round is the k-th frame after its
-- start; the script's frame k is held on it. The log:
--   setup <game> stage=<n> c0=<n> c1=<n> energy=<n> wins_needed=<n> time=<n> barrier=<n>
--         seed=<n> lead=<n> stage_yang=<n> stage_x=<f> control=<rob0>,<rob1>
--   r<round> <k> <timer> | <x> <y> <z> <mot> <coma> <energy> <st> <yang> <pad> <char> | <same for 2P>
--   end r<round> k=<n> wins=<p1>,<p2> energy=<e0>,<e1> sub=<also_sub_mode>
--   done
local GAME   = os.getenv("BT_GAME") or "stf"
local OUT    = assert(os.getenv("BT_OUT"), "BT_OUT")
local P1     = tonumber(os.getenv("BT_P1") or (GAME == "fv" and "8" or "0"))
local P2     = tonumber(os.getenv("BT_P2") or (GAME == "vf2" and "0" or GAME == "fv" and "8" or "15"))
local STAGE  = tonumber(os.getenv("BT_STAGE") or (GAME == "fv" and "0" or "-1"))
local SEED   = tonumber(os.getenv("BT_SEED") or "1")
local ROUNDS = tonumber(os.getenv("BT_ROUNDS") or "99")
local FRAMES = tonumber(os.getenv("BT_FRAMES") or "20000")
local MENU   = os.getenv("BT_MENU") or "30,2,0,0,1,140,5"
local INPUTS = os.getenv("BT_INPUTS")
local TRACE_BOOT = os.getenv("BT_TRACE_BOOT")
local LEAD = tonumber(os.getenv("BT_LEAD") or "30")
local RECORD, REPLAY = os.getenv("BT_RECORD"), os.getenv("BT_REPLAY")

local sp = manager.machine.devices[":maincpu"].spaces["program"]
-- The board keeps StF's globals where its link put them (stf_ram_<addr>
-- blocks, stf_motion.h's stf_ram), read from its map (BT_MAP); a source
-- game has them where they are.
local ram_blocks = {}
if GAME == "board" then
  local map = assert(os.getenv("BT_MAP"), "BT_MAP: the board build's game.map")
  for line in io.lines(map) do
    local at, name = line:match("^%s+0x(%x+)%s+stf_ram_(%x+)$")
    if at then ram_blocks[#ram_blocks + 1] = { tonumber(name, 16), tonumber(at, 16) } end
  end
  table.sort(ram_blocks, function(a, b) return a[1] > b[1] end)
  assert(#ram_blocks > 0, "no stf_ram blocks in " .. map)
end
local function G(a)
  for _, b in ipairs(ram_blocks) do if a >= b[1] then return a - b[1] + b[2] end end
  return a
end
local fields = {}
for _, port in pairs(manager.machine.ioport.ports) do
  for name, fl in pairs(port.fields) do fields[name] = fl end
end
local function set(name, on) local fl = fields[name]; if fl then fl:set_value(on and 1 or 0) end end
local out = assert(io.open(OUT, "w"))
local n = 0   -- frames since boot

---- the input script ----------------------------------------------------------

-- A pad's held state as letters; the script holds a state for a stretch.
local BUTTON = { U = "Up", D = "Down", L = "Left", R = "Right", P = "Punch", K = "Kick", G = (GAME == "vf2" or GAME == "fv") and "Guard" or "Barrier" }
local function pad(player, s)
  for letter, name in pairs(BUTTON) do set(player .. " " .. name, s:find(letter, 1, true) ~= nil) end
end

-- Park-Miller, so the script is the same for any game and any Lua.
local seed = SEED % 2147483647; if seed <= 0 then seed = 1 end
local function rnd(n) seed = (seed * 16807) % 2147483647; return seed % n end
-- What a player does for a stretch: walk in, strike, guard, throw, crouch, jump.
-- f is toward the other fighter at the round's start (1P is on the left).
local MOVES = {
  { "f", 10 }, { "", 6 }, { "P", 10 }, { "K", 8 }, { "fP", 4 }, { "fK", 4 },
  { "dP", 4 }, { "dK", 4 }, { "G", 5 }, { "PG", 3 }, { "PK", 3 }, { "KG", 2 },
  { "b", 3 }, { "u", 2 }, { "d", 3 }, { "ff", 2 }, { "bP", 2 }, { "dfP", 2 },
}
local WEIGHT = 0; for _, m in ipairs(MOVES) do WEIGHT = WEIGHT + m[2] end
local function pick()
  local w = rnd(WEIGHT)
  for _, m in ipairs(MOVES) do if w < m[2] then return m[1] end; w = w - m[2] end
end
-- A stretch's letters for a player, by the side it starts on.
local function letters(move, right)
  local s = move:gsub("ff", "f")
  s = s:gsub("f", right and "L" or "R"):gsub("b", right and "R" or "L"):gsub("u", "U"):gsub("d", "D")
  return s
end
-- script[i] = { frame, p1, p2 }, from each player's stretches: a strike's
-- buttons are held 3 frames (its direction the whole stretch), a dash is
-- forward tapped twice, a walk or guard is held.
local script = {}
local LEN = 99 * 60
if INPUTS then
  for line in io.lines(INPUTS) do
    local k, a, b = line:match("^(%d+)%s+(%S+)%s+(%S+)")
    if k then script[#script + 1] = { tonumber(k), a == "-" and "" or a, b == "-" and "" or b } end
  end
else
  local frames = { {}, {} }
  for p = 1, 2 do
    local k = 0
    while k < LEN do
      local m = pick()
      local strike = m:find("[PK]") ~= nil or m == "PG" or m == "KG"
      local len = strike and 8 + rnd(16) or 6 + rnd(30)
      local held = letters(m, p == 2)
      local dir = held:gsub("[PKG]", "")
      for i = 0, len - 1 do
        local s
        if m == "ff" then s = (i < 2 or (i >= 4 and i < 6)) and dir or ""
        elseif strike then s = i < 3 and held or dir
        else s = held end
        frames[p][k + i] = s
      end
      k = k + len
    end
  end
  local last = { nil, nil }
  for k = 0, LEN - 1 do
    local a, b = frames[1][k] or "", frames[2][k] or ""
    if a ~= last[1] or b ~= last[2] then script[#script + 1] = { k, a, b }; last = { a, b } end
  end
end
-- the last entry of a list in frame order at or before k
local function entry_at(list, k)
  local lo, hi, best = 1, #list, nil
  while lo <= hi do
    local mid = (lo + hi) // 2
    if list[mid][1] <= k then best = mid; lo = mid + 1 else hi = mid - 1 end
  end
  return best and list[best] or { 0, "", "" }
end
-- A replay: each round's own list, its frames the round's (the lead in them).
local replay = {}
if REPLAY then
  for line in io.lines(REPLAY) do
    local r, k, a, b = line:match("^r(%d+)%s+(%d+)%s+(%S+)%s+(%S+)")
    if r then
      r = tonumber(r); replay[r] = replay[r] or {}
      table.insert(replay[r], { tonumber(k), a == "-" and "" or a, b == "-" and "" or b })
    end
  end
end
local function script_at(k, r)
  if REPLAY then return entry_at(replay[r] or {}, k) end
  k = k - LEAD
  if k < 0 then return { 0, "", "" } end
  return entry_at(script, k)
end
local record = RECORD and assert(io.open(RECORD, "w"))
local recorded = {}   -- the last pads written to the replay, and its round
local function record_at(r, k, e)
  if not record or (recorded[1] == r and recorded[2] == e[2] and recorded[3] == e[3]) then return end
  record:write(string.format("r%d %d %s %s\n", r, k, e[2] == "" and "-" or e[2], e[3] == "" and "-" or e[3]))
  record:flush()
  recorded = { r, e[2], e[3] }
end

---- the setup -----------------------------------------------------------------

-- A setup is a list of { frame, function }: what to press when, from boot.
local steps = {}
local armed = 0   -- board: the frame its fight starts, a round looked for from then
local per_frame   -- board: the menu's driver, run every frame
local held = {}   -- vf2, fv: each rob's pad as its input read wrote it
local function at(n, fn) steps[#steps + 1] = { n, fn } end
local function tap(n, name, len) at(n, function() set(name, true) end); at(n + (len or 4), function() set(name, false) end) end

if GAME == "stf" then
  -- The select screen writes the fighter under each cursor to its rob's
  -- +0x1B0 (rob 0x510D00 and 0x514100) as the cursor moves, and the pick
  -- is what is there when the player presses. From the 1P Start (the
  -- first pick is written a frame before mode 7) on, every such
  -- write is the fighter asked for. (Honey is hidden: Start on Amy picks
  -- her; this puts her there without the cursor.)
  local function force(addr, c)
    return sp:install_write_tap(addr, addr + 3, "bt_char" .. addr, function(o, d, mk)
      if mk & 0xFF == 0 or n < 600 then return nil end
      return (d & ~0xFF) | c end)
  end
  _G.BT_CHAR0 = force(0x510EB0, P1)
  _G.BT_CHAR1 = force(0x5142B0, P2)
  -- Two coins in the attract (mode 3; the title, mode 1, takes none), then
  -- both Starts. A Start too soon after the coins is lost: the other then
  -- starts a game against the CPU (select0_flag 0, enemy_control driving
  -- that side's pad all match).
  tap(900, "Coin 1", 8); tap(940, "Coin 1", 8)
  tap(1100, "1 Player Start", 6); tap(1160, "2 Players Start", 6)
  tap(1300, "P1 Punch", 4); tap(1320, "P2 Punch", 4)
  if STAGE >= 0 then
    _G.BT_STAGE_TAP = sp:install_write_tap(0x500064, 0x500067, "bt_stage", function(o, d, mk)
      if (mk & 0xFF) == 0 then return nil end
      return (d & ~0xFF) | STAGE end)
  end
elseif GAME == "vf2" then
  -- VF2 keeps StF's globals and rob layout (docs/DEBUG-MODE.md): robs
  -- 0x510980 and 0x512980, the pick at +0x1B0, written as the cursor
  -- moves (0x32148 for 1P, 0x322C0 for 2P) and read when the player
  -- presses. (A write of 13 or more, a second-colours pick, would be kept
  -- as 13 + the fighter; with the cursors left where they are none comes.)
  local function force(addr, c)
    return sp:install_write_tap(addr, addr + 3, "bt_char" .. addr, function(o, d, mk)
      if mk & 0xFF == 0 or n < 600 then return nil end
      return (d & ~0xFF) | ((d & 0xFF) >= 13 and c + 13 or c) end)
  end
  _G.BT_CHAR0 = force(0x510B30, P1)
  _G.BT_CHAR1 = force(0x512B30, P2)
  -- Four coins in the attract (from a cold nvram, two a credit), 1P Start
  -- (the select screen, mode 7, from the next frame on), and 2P Start a
  -- while into it: a 2P Start in the same few frames as 1P's is lost and
  -- the match is against the CPU (0xCEC4 writes its pick, in mode 8).
  tap(900, "Coin 1", 8); tap(940, "Coin 1", 8); tap(980, "Coin 1", 8); tap(1020, "Coin 1", 8)
  tap(1100, "1 Player Start", 6); tap(1300, "2 Players Start", 6)
  tap(1500, "P1 Punch", 4); tap(1520, "P2 Punch", 4)
  -- The settings the backup RAM gives at boot (the factory's are these
  -- too): the round time, 0x500090, read by the round start (0xE398);
  -- the wins needed, 0x500052, written from the rounds setting at the
  -- match start (0xD28C, 0xDB24).
  at(1100, function() sp:write_u8(0x500090, 30) end)
  _G.BT_NEED_TAP = sp:install_write_tap(0x500050, 0x500053, "bt_need", function(o, d, mk)
    if (mk >> 16) & 0xFF == 0 then return nil end
    return (d & ~0xFF0000) | (2 << 16) end)
  if STAGE >= 0 then
    _G.BT_STAGE_TAP = sp:install_write_tap(0x500064, 0x500067, "bt_stage", function(o, d, mk)
      if (mk & 0xFF) == 0 then return nil end
      return (d & ~0xFF) | STAGE end)
  end
  -- The pad (+0x1200, u8, the IN1/IN2 bits: P 1, K 2, G 4, D 0x10, U 0x20,
  -- R 0x40, L 0x80) lives only inside a step: the input read (0x1BA6C
  -- for 1P, 0x1BAC0 for 2P) writes it and 0x164E8 / 0x164DC clear it
  -- before the clock's countdown, so it is kept here as the read wrote it.
  local cpu = manager.machine.devices[":maincpu"]
  local function keep(r, pc)
    return sp:install_write_tap(r + 0x1200, r + 0x1203, "bt_pad" .. r, function(o, d, mk)
      if mk & 0xFF ~= 0 and cpu.state["ip"].value == pc then held[r] = d & 0xFF end end)
  end
  _G.BT_PAD0 = keep(0x510980, 0x1BA6C)
  _G.BT_PAD1 = keep(0x512980, 0x1BAC0)
elseif GAME == "fv" then
  -- FV keeps StF's globals and rob layout too: robs 0x510C00 and 0x512C00,
  -- the pick at +0x1B0, written as the cursor moves (0x39AF8 for 2P) and,
  -- when 2P picks 1P's fighter, raised by 13 (0x39B88: the second colours;
  -- +0x1B1 keeps the fighter). From the 1P Start on, every such write is
  -- the fighter asked for, the + 13 kept. (Mahler is the boss, not on the
  -- select screen: this puts him there.)
  local function force(addr, c)
    return sp:install_write_tap(addr, addr + 3, "bt_char" .. addr, function(o, d, mk)
      if mk & 0xFF == 0 or n < 1100 then return nil end
      return (d & ~0xFF) | ((d & 0xFF) >= 13 and c + 13 or c) end)
  end
  _G.BT_CHAR0 = force(0x510DB0, P1)
  _G.BT_CHAR1 = force(0x512DB0, P2)
  -- Coins, Starts and picks as StF's: two coins in the attract, both
  -- Starts (the select, mode 7), both Punches (the fight, mode 9).
  tap(900, "Coin 1", 8); tap(940, "Coin 1", 8)
  tap(1100, "1 Player Start", 6); tap(1160, "2 Players Start", 6)
  tap(1300, "P1 Punch", 4); tap(1320, "P2 Punch", 4)
  -- The settings (the backup RAM's at boot are these too): the round
  -- time, 0x500090 (time * 64 to the clock at each round's start), and the
  -- wins needed, 0x500052, forced on every write and set at the coin.
  local TIME, WINS = tonumber(os.getenv("BT_TIME") or "30"), tonumber(os.getenv("BT_WINS") or "2")
  at(900, function() sp:write_u8(0x500090, TIME); sp:write_u8(0x500052, WINS) end)
  _G.BT_TIME_TAP = sp:install_write_tap(0x500090, 0x500093, "bt_time", function(o, d, mk)
    if mk & 0xFF == 0 then return nil end
    return (d & ~0xFF) | TIME end)
  _G.BT_NEED_TAP = sp:install_write_tap(0x500050, 0x500053, "bt_need", function(o, d, mk)
    if (mk >> 16) & 0xFF == 0 then return nil end
    return (d & ~0xFF0000) | (WINS << 16) end)
  -- The stage: the select writes 0x500064 (0xB674; 2P's Start cycles it at
  -- 0xB648) and loads the scene from it (0x21614), so a forced write loads
  -- the one asked for. Slot 0 is Western: its town turns (0x50A022, -10 a
  -- frame).
  if STAGE >= 0 then
    _G.BT_STAGE_TAP = sp:install_write_tap(0x500064, 0x500067, "bt_stage", function(o, d, mk)
      if (mk & 0xFF) == 0 or n < 1100 then return nil end
      return (d & ~0xFF) | STAGE end)
  end
  -- The pad (+0x1200, u8) lives only inside a step, as VF2's: 0x16BC4
  -- clears it before the clock's countdown and the input task (0x1D1B8 for
  -- 1P) writes it after, so it is kept here as the clear found it.
  local function keep(r)
    return sp:install_write_tap(r + 0x1200, r + 0x1203, "bt_pad" .. r, function(o, d, mk)
      if mk & 0xFF ~= 0 and d & 0xFF == 0 then held[r] = sp:read_u8(r + 0x1200) end end)
  end
  _G.BT_PAD0 = keep(0x510C00)
  _G.BT_PAD1 = keep(0x512C00)
elseif GAME == "board" then
  -- The setup menu: the cursor starts on GAME_START; down moves it, kick
  -- raises a value and punch lowers it (on GAME_START either begins the
  -- fight), Start begins the fight. A pass that loads a stage or a fighter
  -- runs many frames and a press inside it is lost, so the menu is driven
  -- by what it shows: its cursor and values (menu_cur, menu_val, from the
  -- map), one press at a time, the next once the last one took or a second
  -- went by. The fight is on once in_menu is 0; Start again till it is.
  local want = {}
  for v in MENU:gmatch("[^,]+") do want[#want + 1] = tonumber(v) end
  local sym = {}
  for line in io.lines(os.getenv("BT_MAP")) do
    local at, name = line:match("^%s+0x(%x+)%s+_([%a_]+)$")
    if at then sym[name] = tonumber(at, 16) end
  end
  assert(sym.menu_val and sym.menu_cur and sym.in_menu, "no menu_val/menu_cur/in_menu in the map")
  local held, wait, seen, presses = nil, 0, nil, 0
  armed = math.huge
  local function shown()
    local t = { sp:read_u32(sym.menu_cur) }
    for i = 1, 7 do t[#t + 1] = sp:read_u16(sym.menu_val + 2 * i) end
    return table.concat(t, ",")
  end
  per_frame = function()
    if n < 600 then return end
    if armed == math.huge and sp:read_u32(sym.in_menu) == 0 then armed = n end
    if held then
      wait = wait + 1
      if wait == 4 then set(held, false) end
      if wait >= 8 and (shown() ~= seen or wait >= 60) then held = nil end
      return
    end
    if armed < math.huge then return end
    local cur, press = sp:read_u32(sym.menu_cur), nil
    for i = 1, 7 do
      local v = sp:read_u16(sym.menu_val + 2 * i)
      if want[i] and v ~= want[i] then
        press = cur < i and "P1 Down" or cur > i and "P1 Up" or v < want[i] and "P1 Kick" or "P1 Punch"
        break
      end
    end
    if not press then
      -- the menu's pass runs a fight step too (its clock flickers, 1920
      -- and 1919, on a pass that runs long): no round before the fight
      press = "1 Player Start"
    end
    presses = presses + 1
    if presses > 400 then error("the menu never showed " .. MENU .. " (" .. shown() .. ")") end
    held, wait, seen = press, 0, shown()
    set(press, true)
  end
else
  error("BT_GAME " .. GAME .. ": not yet")
end
table.sort(steps, function(a, b) return a[1] < b[1] end)

-- BT_TRACE_PAD: who writes 1P's pad (rob+0x1200), from the round's start.
local TRACE_PAD = os.getenv("BT_TRACE_PAD")
local function trace_pad(a)
  local cpu = manager.machine.devices[":maincpu"]
  _G.BT_PADTAP = sp:install_write_tap(a, a + 3, "bt_pad", function(o, d, mk)
    if d & mk & 0xFFFF ~= 0 then io.stderr:write(string.format("pad %d %08x %08x pc=%x\n", n, d, mk, cpu.state["ip"].value)) end
  end)
end

---- the log -------------------------------------------------------------------

local function rob(p) return sp:read_u32(G(p == 0 and 0x500804 or 0x500808)) end
local function f32(a) return (string.unpack("<f", string.pack("<I4", sp:read_u32(a)))) end
local function fighter(r)
  return string.format("%.3f %.3f %.3f %d %d %d %d %d %x %d",
    f32(r + 0x18), f32(r + 0x1C), f32(r + 0x20),
    sp:read_u16(r + 0x1A8), sp:read_u16(r + 0x1AA), sp:read_i16(r + 0x1AC), sp:read_u8(r + 0x19F), sp:read_u16(r + 0x26), held[r] or sp:read_u16(r + 0x1200),
    sp:read_u8(r + 0x1B0))
end

-- The fighters are logged as they are when the game's clock counts down,
-- not at MAME's frame end: a real StF's frame now and then runs past the
-- vblank, and a frame-end log then caught 1P's task run and 2P's not. At
-- the countdown both games have run the same tasks of their step (the
-- collision, get_game_info, the camera: StF's task list, which the board
-- keeps) and none of the fighters' own: the state is the last step's, the
-- timer's value before the write that step's. A frame the game steps
-- twice in (the board, catching up) logs both.
local snap
_G.BT_SNAP = sp:install_write_tap(G(0x500028) & ~3, (G(0x500028) & ~3) + 3, "bt_snap", function(o, d, mk)
  local sh = (G(0x500028) & 3) * 8
  if (mk >> sh) & 0xFFFF == 0 then return nil end
  local old = sp:read_u16(G(0x500028))
  if (d >> sh) & 0xFFFF == old then return nil end
  local r0, r1 = rob(0), rob(1)
  if r0 ~= 0 and r1 ~= 0 then snap = snap or {}; snap[#snap + 1] = { old, fighter(r0), fighter(r1) } end
end)

local si = 1
local round, k, t0, in_round, prev_timer, still, lagged = 0, 0, 0, false, 0, 0, false
local logged_setup = false
local logged_k
local function finish()
  out:write("done\n"); out:close(); manager.machine:exit()
end

local frame
emu.register_frame_done(function()
  local ok, err = pcall(frame)
  if not ok then out:write("error ", tostring(err), "\n"); finish() end
end)
frame = function()
  n = n + 1
  while steps[si] and steps[si][1] <= n do steps[si][2](); si = si + 1 end
  if per_frame then per_frame() end
  local timer = sp:read_u16(G(0x500028))
  if TRACE_BOOT and n % 60 == 0 then
    io.stderr:write(string.format("boot %d timer=%d mode=%d sub=%d also=%d sel=%x,%x\n", n, timer, sp:read_u8(G(0x50002A)), sp:read_u8(G(0x500030)), sp:read_u8(G(0x500031)), sp:read_u32(G(0x500248)), sp:read_u32(G(0x50024C))))
  end
  local judge = sp:read_u8(G(0x500031)) == 13
  if not in_round then
    if n >= armed and prev_timer > 0 and timer > 0 and timer < prev_timer and not judge
       and (GAME ~= "fv" or sp:read_u8(0x50002A) == 9)
       and sp:read_i16(rob(0) + 0x1AC) > 0 and sp:read_i16(rob(1) + 0x1AC) > 0 then
      -- frame k of the round is the game's own step k: the clock from its
      -- round's start (time << 6), so a game that steps twice in a frame
      -- (the board, catching up after a round's setup) keeps in step
      in_round, still = true, 0
      t0, k, logged_k, lagged = (prev_timer + 63) // 64 * 64, nil, nil, false
      round = round + 1
      if TRACE_PAD and not _G.BT_PADTAP then trace_pad(rob(0) + 0x1200) end
      if not logged_setup then
        logged_setup = true
        out:write(string.format("setup %s stage=%d c0=%d c1=%d energy=%d wins_needed=%d time=%d barrier=%d seed=%d lead=%d stage_yang=%d stage_x=%.3f control=%x,%x\n",
          GAME, sp:read_u8(G(0x500064)), sp:read_u8(rob(0) + 0x1B0), sp:read_u8(rob(1) + 0x1B0),
          sp:read_u16(G(0x5000A0)), sp:read_u8(G(0x500052)), (prev_timer + 63) // 64, (GAME == "vf2" or GAME == "fv") and 0 or sp:read_u8(G(0x50A424)), SEED, LEAD, sp:read_u16(G(0x50A022)), f32(G(0x50A00C)), sp:read_u32(rob(0) + 0x1208), sp:read_u32(rob(1) + 0x1208)))
      end
    end
  end
  if in_round then
    -- a frame the game did not step (the board's, running long): the clock
    -- ran the frame before and both fighters stand, so it has not stopped.
    -- k and the pads wait for the step, which reads the last step's pads,
    -- and nothing is logged. Still stopped the next frame, k makes it up.
    local lag = k and timer == prev_timer and still == 0 and not judge
      and sp:read_i16(rob(0) + 0x1AC) > 0 and sp:read_i16(rob(1) + 0x1AC) > 0
    if not lag then
      if lagged and timer == prev_timer then k = k + 1 end
      k = k and math.max(k + 1, t0 - timer - 1) or t0 - timer - 1
      local e = script_at(k, round)
      pad("P1", e[2]); pad("P2", e[3])
      record_at(round, k, e)
      -- the last countdown's state, as step t0 - old - 1; once the clock
      -- stops (the KO), the frame's own
      if snap then
        for _, sn in ipairs(snap) do
          local ks = t0 - sn[1] - 1
          if ks >= 0 and ks > (logged_k or -1) then
            out:write(string.format("r%d %d %d | %s | %s\n", round, ks, sn[1], sn[2], sn[3]))
            logged_k = ks
          end
        end
      elseif k > (logged_k or -1) then
        out:write(string.format("r%d %d %d | %s | %s\n", round, k, timer, fighter(rob(0)), fighter(rob(1))))
        logged_k = k
      end
    end
    lagged = lag
    still = timer == prev_timer and still + 1 or 0
    if judge or still > 30 then
      pad("P1", ""); pad("P2", "")
      out:write(string.format("end r%d k=%d wins=%d,%d energy=%d,%d sub=%d\n", round, k,
        sp:read_u8(G(0x50004F)), sp:read_u8(G(0x500051)), sp:read_i16(rob(0) + 0x1AC), sp:read_i16(rob(1) + 0x1AC), sp:read_u8(G(0x500031))))
      out:flush()
      in_round = false
      local need = sp:read_u8(G(0x500052))
      if round >= ROUNDS or (need > 0 and (sp:read_u8(G(0x50004F)) >= need or sp:read_u8(G(0x500051)) >= need)) then return finish() end
    end
  end
  snap = nil
  prev_timer = timer
  if n >= FRAMES then out:write("timeout\n"); finish() end
end
