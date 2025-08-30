import sys
from pyaxidraw import axidraw

def draw_dot(x, y):
    ad = axidraw.AxiDraw()
    ad.interactive()
    ad.connect()
    ad.options.units = 2  # set working units to cm.
    ad.update()

    try:
        ad.moveto(x, y)  # Move to the specified position
        ad.lineto(x, y)  # Raise the pen
        ad.lineto(x+1, y)  # Raise the pen
        ad.lineto(x+1, y+1)  # Raise the pen
        ad.lineto(x, y+1)  # Raise the pen
        ad.lineto(x, y)  # Raise the pen
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
