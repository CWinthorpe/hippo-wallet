#!/usr/bin/env python3
import re, sys
files = sys.argv[1:]
for p in files:
    c = open(p, encoding='utf-8').read()
    n = c.count('<<<<<<< HEAD')
    print(f"\n{'#'*20} {p}  blocks={n}")
    if n == 0:
        continue
    lines = c.splitlines()
    i = 0; idx = 0
    while i < len(lines):
        if lines[i].startswith('<<<<<<< HEAD'):
            idx += 1
            j = i + 1; head = []
            while not lines[j].startswith('======='):
                head.append(lines[j]); j += 1
            j += 1; theirs = []
            while not lines[j].startswith('>>>>>>> refs'):
                theirs.append(lines[j]); j += 1
            j += 1
            print(f"\n--- BLOCK {idx} at line {i+1} ---")
            print("[HEAD]")
            print('\n'.join(head)[:1500])
            print("[THEIRS]")
            print('\n'.join(theirs)[:1500])
            i = j
        else:
            i += 1
