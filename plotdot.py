import sys
from pyaxidraw import axidraw

def draw_dot(x, y):
    ad = axidraw.AxiDraw()
    ad.interactive()
    ad.connect()
    ad.options.units = 1  # set working units to mm.
    ad.update()

    # Draw a 2×2 mm square as the dot
    try:
        ad.moveto(x, y)
        ad.lineto(x + 2, y)
        ad.lineto(x + 2, y + 2)
        ad.lineto(x, y + 2)
        ad.lineto(x, y)
        ad.moveto(0, 0)  # Return to the origin
    finally:
        ad.disconnect()

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python plotdot.py <x> <y>")
        sys.exit(1)

    try:
        x = float(sys.argv[1])
        y = float(sys.argv[2])
    except ValueError:
        print("Error: x and y must be numbers.")
        sys.exit(1)

    draw_dot(x, y)
