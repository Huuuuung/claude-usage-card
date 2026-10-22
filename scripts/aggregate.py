"""Aggregate Claude Code usage from local transcripts into per-day stats.

Reads every ~/.claude/projects/**/*.jsonl, caching each file's parsed
entries in ~/.claude/cache/usage-card.json so only changed files are
re-read. The cache also keeps files Claude Code has since cleaned up, so
history older than the transcript retention period is not lost.

Prints one JSON object on stdout: { generatedAt, today, files, days: { "YYYY-MM-DD": DayStat } },
days and today in this computer's local time.
"""
import datetime as dt
import glob
import json
import os
import sys

CACHE_VERSION = 1

base = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude")
root = os.path.join(base, "projects")
cache_path = os.path.join(base, "cache", "usage-card.json")


def load_cache():
    try:
        with open(cache_path, encoding="utf-8") as f:
            cache = json.load(f)
        if cache.get("v") == CACHE_VERSION:
            return cache
    except (OSError, ValueError):
        pass
    return {"v": CACHE_VERSION, "files": {}}


def epoch(ts):
    return int(dt.datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp())


def is_prompt(message):
    """A prompt the person typed, not a tool result handed back to the model."""
    content = message.get("content")
    if isinstance(content, str):
        return True
    if isinstance(content, list):
        kinds = {block.get("type") for block in content if isinstance(block, dict)}
        return "text" in kinds and "tool_result" not in kinds
    return False


def parse(path):
    # replies: "<message id>|<request id>" -> [epoch, session, sidechain, model, in, out, cache write, cache read]
    # prompts: uuid -> [epoch, session, sidechain]
    replies, prompts = {}, {}
    with open(path, encoding="utf-8", errors="ignore") as f:
        for line in f:
            if '"assistant"' not in line and '"user"' not in line:
                continue
            try:
                row = json.loads(line)
            except ValueError:
                continue
            ts, kind = row.get("timestamp"), row.get("type")
            message = row.get("message") or {}
            if not ts:
                continue
            session, side = row.get("sessionId") or "", 1 if row.get("isSidechain") else 0
            if kind == "assistant" and message.get("usage"):
                model = message.get("model") or "?"
                if model == "<synthetic>":
                    continue
                u = message["usage"]
                key = f'{message.get("id")}|{row.get("requestId")}'
                counts = [u.get("input_tokens") or 0, u.get("output_tokens") or 0,
                          u.get("cache_creation_input_tokens") or 0, u.get("cache_read_input_tokens") or 0]
                held = replies.get(key)
                if held:
                    held[4:] = [max(a, b) for a, b in zip(held[4:], counts)]
                else:
                    replies[key] = [epoch(ts), session, side, model, *counts]
            elif kind == "user" and not row.get("isMeta") and row.get("uuid") and is_prompt(message):
                prompts[row["uuid"]] = [epoch(ts), session, side]
    return {"r": replies, "p": prompts}


def main():
    cache = load_cache()
    files = cache["files"]
    changed = False
    for path in glob.glob(os.path.join(root, "**", "*.jsonl"), recursive=True):
        try:
            st = os.stat(path)
        except OSError:
            continue
        held = files.get(path)
        stamp = [st.st_size, int(st.st_mtime)]
        if held and held.get("stamp") == stamp:
            continue
        files[path] = {"stamp": stamp, **parse(path)}
        changed = True

    # Forked and resumed sessions copy earlier rows: merge by id so each counts once.
    replies, prompts = {}, {}
    for entry in files.values():
        replies.update(entry["r"])
        prompts.update(entry["p"])

    sessions, days = {}, {}

    def day_of(ts):
        local = dt.datetime.fromtimestamp(ts)
        key = local.strftime("%Y-%m-%d")
        day = days.get(key)
        if day is None:
            day = days[key] = {"m": 0, "i": 0, "o": 0, "cw": 0, "cr": 0, "h": [0] * 24, "md": {}, "s": set()}
        return day, local.hour

    def count_session(day, session, side):
        if session and not side:
            day["s"].add(sessions.setdefault(session, len(sessions)))

    for ts, session, side, model, i, o, cw, cr in replies.values():
        day, hour = day_of(ts)
        day["m"] += 1
        day["h"][hour] += 1
        day["i"] += i
        day["o"] += o
        day["cw"] += cw
        day["cr"] += cr
        per = day["md"].setdefault(model, [0, 0, 0, 0])
        for n, v in enumerate((i, o, cw, cr)):
            per[n] += v
        count_session(day, session, side)

    for ts, session, side in prompts.values():
        day, hour = day_of(ts)
        day["m"] += 1
        day["h"][hour] += 1
        count_session(day, session, side)

    for day in days.values():
        day["s"] = sorted(day["s"])

    if changed:
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        tmp = cache_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cache, f, separators=(",", ":"))
        os.replace(tmp, cache_path)

    out = {
        "generatedAt": int(dt.datetime.now().timestamp() * 1000),
        "today": dt.date.today().isoformat(),
        "files": len(files),
        "days": days,
    }
    sys.stdout.write(json.dumps(out, separators=(",", ":")))


if __name__ == "__main__":
    main()
