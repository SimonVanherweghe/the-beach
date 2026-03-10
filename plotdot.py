import sys
import time
import math
import json

from pyaxidraw import axidraw

DOT_RADIUS = 1.5   # mm – radius of the filled spiral dot
ARM_SPACING = 0.8  # mm – distance between spiral arms (controls fill density)


def draw_spiral(ad, cx, cy):
    """Draw a filled Archimedean spiral centred at (cx, cy)."""
    turns = DOT_RADIUS / ARM_SPACING
    total_angle = 2 * math.pi * turns
    steps = int(turns * 60)  # ~60 segments per revolution for a smooth curve

    ad.moveto(cx, cy)
    time.sleep(0.3)
    for i in range(1, steps + 1):
        theta = total_angle * i / steps
        r = DOT_RADIUS * theta / total_angle
        ad.lineto(cx + r * math.cos(theta), cy + r * math.sin(theta))


# AxiDraw V3/A3 travel limits in mm
MAX_TRAVEL_X = 430
MAX_TRAVEL_Y = 297


def draw_dots(dots):
    """Draw one or more dots. Each dot is a dict with 'x' and 'y' in mm."""
    ad = axidraw.AxiDraw()
    ad.interactive()
    ad.options.units = 2  # set working units to mm.
    ad.options.model = 2  # AxiDraw V3/A3 – travel ~430 × 297 mm
    ad.options.penlift = 3  # brushless servo upgrade kit (narrow-band signal)
    ad.connect()
    ad.update()

    try:
        for i, dot in enumerate(dots):
            x, y = dot['x'], dot['y']
            if x < 0 or y < 0 or x > MAX_TRAVEL_X or y > MAX_TRAVEL_Y:
                print(f"Skipping dot {i+1}/{len(dots)}: ({x:.1f}, {y:.1f}) mm is out of plotter range", flush=True)
                continue
            print(f"Drawing dot {i+1}/{len(dots)} at ({x:.1f}, {y:.1f}) mm", flush=True)
            draw_spiral(ad, x, y)
            time.sleep(0.3)
        ad.moveto(0, 0)
        print("All dots drawn.", flush=True)
    finally:
        ad.disconnect()


if __name__ == "__main__":
    if len(sys.argv) == 2:
        # JSON mode: plotdot.py '[{"x":10,"y":20},{"x":50,"y":60}]'
        try:
            dots = json.loads(sys.argv[1])
            draw_dots(dots)
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            print(f"Error parsing JSON: {e}")
            sys.exit(1)
    elif len(sys.argv) == 3:
        # Legacy single-dot mode: plotdot.py <x> <y>
        try:
            x = float(sys.argv[1])
            y = float(sys.argv[2])
        except ValueError:
            print("Error: x and y must be numbers.")
            sys.exit(1)
        draw_dots([{'x': x, 'y': y}])
    else:
        print("Usage: python plotdot.py <x> <y>")
        print("       python plotdot.py '<json_array>'")
        sys.exit(1)
