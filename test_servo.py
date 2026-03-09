"""Thorough servo diagnostic for AxiDraw with brushless upgrade."""
from pyaxidraw import axidraw
from plotink import ebb_serial
import time

ad = axidraw.AxiDraw()
ad.interactive()
ad.connect()
port = ad.plot_status.port

# --- Info ---
ver = ebb_serial.query(port, "V\r")
print("Firmware:", ver.strip() if ver else "unknown")

# Check current servo config
for cmd in ["QP\r", "QC\r"]:
    resp = ebb_serial.query(port, cmd)
    print(f"  {cmd.strip()} -> {resp.strip() if resp else 'None'}")

# --- 1. Toggle Pen (TP) - simplest command ---
print("\n=== Test 1: TP (Toggle Pen) ===")
print("  Toggling pen...")
ebb_serial.command(port, "TP\r")
time.sleep(2)
print("  Toggling pen back...")
ebb_serial.command(port, "TP\r")
time.sleep(2)

# --- 2. Configure servo positions then use SP ---
print("\n=== Test 2: SC + SP (configure then move) ===")
# SC,4,<pen-up-pos>  SC,5,<pen-down-pos>  (values ~12000-25000 typical)
print("  Setting pen-up=20000, pen-down=12000 on standard pin...")
ebb_serial.command(port, "SC,4,20000\r")  # pen-up position
ebb_serial.command(port, "SC,5,12000\r")  # pen-down position
ebb_serial.command(port, "SC,10,65535\r") # servo timeout = never
time.sleep(0.5)
print("  SP,0 (pen down)...")
ebb_serial.command(port, "SP,0,1000\r")
time.sleep(2)
print("  SP,1 (pen up)...")
ebb_serial.command(port, "SP,1,1000\r")
time.sleep(2)

# --- 3. Direct S2 on pin 0 (RB0) in addition to pin 1 and 2 ---
print("\n=== Test 3: S2 on pins 0, 1, 2 with wide range ===")
for pin in [0, 1, 2]:
    print(f"  Pin {pin}: position 10000...")
    ebb_serial.command(port, f"S2,10000,{pin},0,0\r")
    time.sleep(1.5)
    print(f"  Pin {pin}: position 25000...")
    ebb_serial.command(port, f"S2,25000,{pin},0,0\r")
    time.sleep(1.5)

# --- 4. Try narrow-band mode explicitly ---
print("\n=== Test 4: Narrow-band (SC,8,1) + S2 pin 2 ===")
ebb_serial.command(port, "SC,8,1\r")  # 1 channel = narrow-band
time.sleep(0.3)
print("  S2 pin 2 -> 7000...")
ebb_serial.command(port, "S2,7000,2,0,0\r")
time.sleep(2)
print("  S2 pin 2 -> 11000...")
ebb_serial.command(port, "S2,11000,2,0,0\r")
time.sleep(2)

# Restore standard mode
ebb_serial.command(port, "SC,8,8\r")

ad.disconnect()
print("\nDone. Did the pen move at ANY point during these tests?")
