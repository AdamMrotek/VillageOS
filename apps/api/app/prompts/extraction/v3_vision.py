# Module import (not the package) so this file can be imported from the
# package __init__ without a circular-import cycle.
from app.prompts.extraction.v3 import SYSTEM_PROMPT as _V3_PROMPT

VERSION = "v3v"

_VISION_ADDENDUM = """
## Image input

The user message may contain an IMAGE — a photo of a school leaflet or flyer,
a screenshot of a chat thread, or a noticeboard poster — optionally accompanied
by a short text caption from the parent.

- Read ALL text in the image before extracting: headings, small print, dates in
  footers, prices, and return-slip instructions.
- The same field rules apply. An explicit calendar date printed in the image
  wins over relative phrases, exactly as rule 1 above.
- Leaflets often print a time RANGE (e.g. "11:00am – 2:00pm"). The first time
  is start_time_literal; the second is explicitly stated, so set end_time from
  it (same date unless the image says otherwise).
- The caption adds context (e.g. which child it concerns, or which of several
  events to extract); trust the image for dates, times, locations, and costs.
- If the image is blurry or partially unreadable, extract what you can read and
  set confidence below 0.7.
""".strip()

SYSTEM_PROMPT = _V3_PROMPT + "\n\n" + _VISION_ADDENDUM
