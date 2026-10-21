-- Attract and select: which models each screen reads, and a hash of every frame,
-- so a run with the Akira patch can be compared with one without.
--
--   AS_OUT=<file> AS_FRAMES=45000 AS_INPUT=attract|select \
--   AS_PATCH=md@d6f1b0=<dir>/main_data-d6f1b0.bin,md@30000c=<dir>/main_data-30000c.bin,tx@78bdc0=<dir>/textures-78bdc0.bin \
--   mame sfight -rompath $ROMS_DIR -video none -sound none -nothrottle
--     -skip_gameinfo -autoboot_script tools/mame/screen-pages.lua
--
-- AS_PATCH writes `node tools/pack-akira.mjs --out <dir>` blobs into the regions
-- before boot; leave it out for the unpatched run. AS_INPUT=attract presses
-- nothing; select puts a coin in at 1000, Start at 1100, then P1 Right every
-- 120 frames, so the cursor visits all eight characters. Model keys are
-- m<mode 0x50002A>.s<sub 0x500030>.st<stage 0x500064>, as fight-models.lua.
-- <file>: per key "first=<frame> frames=<n> id:reads ..."; <file>.hash: one
-- line per frame "<n> <key> <hash>"; AS_PERFRAME=1 adds <file>.pf, the model
-- ids each frame read; AS_SNAPS="n n ..." snapshots those frames (AS_TAG-n.png).
local OUT = os.getenv("AS_OUT"); local FRAMES = tonumber(os.getenv("AS_FRAMES"))
local INPUT = os.getenv("AS_INPUT"); local PATCH = os.getenv("AS_PATCH")
local sp = manager.machine.devices[":maincpu"].spaces["program"]
local scr = manager.machine.screens[":screen"]
if PATCH then
  local regs = { md = manager.machine.memory.regions[":main_data"], tx = manager.machine.memory.regions[":textures"] }
  for spec in PATCH:gmatch("[^,]+") do
    local reg, off, path = spec:match("(%w+)@(%x+)=(.+)")
    local data = io.open(path, "rb"):read("a")
    for i = 1, #data do regs[reg]:write_u8(tonumber(off, 16) + i - 1, data:byte(i)) end
    print("patched", reg, off, #data)
  end
end
local fields = {}
for _, port in pairs(manager.machine.ioport.ports) do for name, fl in pairs(port.fields) do fields[name] = fl end end
local COIN, START, RIGHT = fields["Coin 1"], fields["1 Player Start"], fields["P1 Right"]
assert(RIGHT, "no P1 Right")
local n, key = 0, "boot"
local counts, keys, first = {}, {}, {}
PF = os.getenv("AS_PERFRAME") and {} or nil
local pff = PF and io.open(OUT .. ".pf", "w")
SNAPS = {}
for v in (os.getenv("AS_SNAPS") or ""):gmatch("%d+") do SNAPS[tonumber(v)] = true end
local hf = io.open(OUT .. ".hash", "w")
local function dump()
  local f = io.open(OUT, "w")
  for k, t in pairs(counts) do
    local ids = {}
    for id, c in pairs(t) do ids[#ids + 1] = id .. ":" .. c end
    f:write(k, " first=", first[k], " frames=", keys[k], " ", table.concat(ids, " "), "\n")
  end
  f:write("done ", n, "\n"); f:close(); hf:flush()
end
local function set(fl, on) if fl then fl:set_value(on and 1 or 0) end end
local function hash(s)
  local h1, h2 = 0, 0
  for i = 1, #s - 63, 64 do
    local a, b, c, d = string.unpack("<I4I4I4I4", s, i)
    h1 = (h1 * 31 + a + c) & 0xFFFFFFFF; h2 = (h2 * 37 + b + d) & 0xFFFFFFFF
  end
  return string.format("%08x%08x", h1, h2)
end
_G.AS_EDGE = sp:install_write_tap(0x50D000, 0x50D003, "as_edge", function()
  if INPUT == "select" then set(COIN, n >= 1000 and n < 1008); set(START, n >= 1100 and n < 1106)
    set(RIGHT, n >= 1250 and n < 2210 and (n - 1250) % 120 < 6) end
  key = string.format("m%d.s%d.st%d", sp:read_u8(0x50002A), sp:read_u8(0x500030), sp:read_u8(0x500064))
  if not keys[key] then first[key] = n end
  keys[key] = (keys[key] or 0) + 1
  if PF then local u, seen = {}, {}; for _, v in ipairs(PF) do if not seen[v] then seen[v] = 1; u[#u+1] = v end end
    pff:write(n, " ", key, " ", table.concat(u, " "), "\n"); PF = {} end
  if SNAPS[n] then scr:snapshot(string.format("%s-%05d.png", os.getenv("AS_TAG"), n)) end
  n = n + 1
  if n % 1000 == 0 then dump() end
  if n >= FRAMES then dump(); manager.machine:exit() end
end)
emu.register_frame_done(function()
  local px = scr:pixels()
  hf:write(n, " ", key, " ", hash(px), "\n")
end)
_G.AS_READ = sp:install_read_tap(0x020E0004, 0x020E0004 + 5125 * 16 - 1, "as_read", function(o)
  local id = (o - 0x020E0004) // 16
  if PF then PF[#PF+1] = id end
  local t = counts[key]; if not t then t = {}; counts[key] = t end
  t[id] = (t[id] or 0) + 1
end)
