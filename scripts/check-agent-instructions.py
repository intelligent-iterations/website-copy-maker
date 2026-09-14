#!/usr/bin/env python3
"""Check instruction entry points and their local documentation links."""
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parents[1]
claude = root / "CLAUDE.md"
agents = root / "AGENTS.md"
errors = []
if not agents.is_symlink() or str(agents.readlink()) != "CLAUDE.md":
    errors.append("AGENTS.md must link exactly to CLAUDE.md")
text = claude.read_text()
if text:
    if len(text.splitlines()) > 80:
        errors.append("Keep CLAUDE.md at most 80 lines; route procedures into docs")
    if "docs/agent-workflow.md" not in text:
        errors.append("CLAUDE.md must route reconstruction work to the agent workflow")
names = ["README.md", "CONTRIBUTING.md", "docs/agent-workflow.md"]
if text:
    names.insert(0, "CLAUDE.md")
for name in names:
    file = root / name
    for target in re.findall(r"\]\(([^)]+)\)", file.read_text()):
        if "://" in target or target.startswith("#"):
            continue
        if not (file.parent / target.split("#")[0]).exists():
            errors.append(f"{name}: missing linked file {target}")
if errors:
    print("\n".join(errors), file=sys.stderr)
    sys.exit(1)
print("Agent entry points and documentation links passed")
