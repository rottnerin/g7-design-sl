"""Rebuilds data/handbook.json from the service learning handbook PDF.

Run when a new handbook comes out (needs: pip install pypdf):
    python3 scripts/build-handbook.py "2026-2027 UNIS MSHS SERVICE LEARNING HANDBOOK.pdf"

Check PAGES below against the new handbook first: it maps each PDF page to a group name.
Only groups a Grade 7 student can join are kept.
"""
import json, re, sys, os

GRADE = 7
PAGES = {
    8: 'Animal Welfare', 9: 'Bamboo Music & Arts Service', 10: 'Blue Dragon Arts',
    11: 'Blue Hearts: Blue Dragon Leadership', 12: 'Breath & Belong (Community Yoga Initiative)',
    13: 'Build for Hope', 14: 'Common Threads: Fiber Arts for Good', 15: 'Community Mentoring',
    16: 'Cuc Phuong National Park', 17: 'First Aid Responders', 18: 'G.O.A.T (Tech Leadership)',
    19: 'Hanoi Student Leadership Network', 20: 'Happy Life Hanoi / Vietnam & Friends',
    21: 'Heartbeat Vietnam', 22: 'Helping Hands', 23: 'High School Senate',
    24: 'HS Gardening & Sustainability', 25: 'Huong La Centre', 26: 'KOTO & Blue Dragon Sports',
    27: 'Learners for Learners (L4L)', 28: 'Library Leadership', 29: 'Light Up the Night',
    30: 'Math & Data for Positive Change', 31: 'Micro-Finance for Change',
    32: 'Middle School Peace & Justice Council', 33: 'Moon & Sun Bears', 34: 'MS Sustainability Action',
    35: 'Operation Smile', 36: 'HS Peace & Justice Council', 37: 'Plastics Lab',
    38: 'Playgrounds & Parks', 39: 'RevivAll', 40: 'SANSE', 41: 'Service Through Music',
    42: 'Service-Learning Leaders', 43: 'SNNC Pet Rescue', 44: 'Swim for Life', 45: 'Student Council',
    46: 'Thuy An Arts Exchange', 47: 'Thuy An Sports HS', 48: 'Thuy An Sports Connect',
    49: 'UNIS Gardens & Pollinators', 50: 'Youth Sports Coaching',
}

def page_texts(path):
    if path.endswith('.txt'):  # already-extracted text, pages split by "===== PAGE n ====="
        parts = re.split(r'\n\n===== PAGE (\d+) =====\n', open(path).read())[1:]
        return {int(parts[i]): parts[i + 1] for i in range(0, len(parts), 2)}
    from pypdf import PdfReader
    return {i + 1: (p.extract_text() or '') for i, p in enumerate(PdfReader(path).pages)}

def tidy(text):
    keep = []
    for line in text.replace('ﬁ', 'fi').replace('ﬂ', 'fl').split('\n'):
        line = re.sub(r'\s+', ' ', line).strip()
        words = line.split(' ')
        spaced_title = len(words) > 3 and sum(len(w) <= 2 for w in words) / len(words) > 0.8
        if line and not spaced_title and not re.fullmatch(r'[\d. ]+', line):
            keep.append(line)
    return '\n'.join(keep)

here = os.path.dirname(os.path.abspath(__file__))
pages = page_texts(sys.argv[1])
groups = []
for n, name in PAGES.items():
    grades = re.findall(r'G(?:RADES?)?\s?(\d+)\s?-\s?(\d+)', pages[n])
    if grades and not any(int(a) <= GRADE <= int(b) for a, b in grades):
        continue
    groups.append({
        'id': 'sl-' + re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-'),
        'name': name,
        'text': tidy(pages[n]),
    })
out = os.path.join(here, '..', 'data', 'handbook.json')
json.dump(groups, open(out, 'w'), ensure_ascii=False, indent=1)
print(f'{len(groups)} groups written to data/handbook.json')
for g in groups: print(' ', g['name'], f"({len(g['text'])} characters)")
