-- A board build's cabinet role for the comm-board link, as the setup's LINK
-- keeps it (board/src/link.c link_save: 0x01D03FF0 "MMX1", the role, its
-- complement), written over the first frames, before the boot's watchdog
-- reads it. LINK_ROLE: 0 off, 1 1P's cabinet (the master), 2 2P's.
local role = tonumber(os.getenv("LINK_ROLE") or "0")
local sp = manager.machine.devices[":maincpu"].spaces["program"]
local f = 0
local sub
sub = emu.add_machine_frame_notifier(function()
  f = f + 1
  sp:write_u32(0x01D03FF0, 0x4D4D5831)
  sp:write_u32(0x01D03FF4, role)
  sp:write_u32(0x01D03FF8, ~role & 0xFFFFFFFF)
  if f >= 3 then sub = nil end
end)
