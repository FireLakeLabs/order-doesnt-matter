#!/usr/bin/env python3
"""Turn a song into multitrack MIDI.

Input is an audio file or a YouTube URL. Each chapter (or the whole thing when
there are none) goes through four steps:

  1. separate   Demucs splits the mix into stems (drums, bass, vocals, ...)
  2. beats      beat_this finds beats and downbeats on the full mix
  3. transcribe ADTOF reads the drum stem, Basic Pitch reads every pitched stem
  4. assemble   one MIDI file, one track per stem, with a tempo map so the
                notes sit on the bar grid while keeping their real timing

Every step caches its result under `interim/`, so a rerun only redoes what is
missing. Pass --force to redo everything.

    uv run extract.py <audio file or URL> [--out DIR]
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import shutil
import subprocess
import sys
import warnings
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
DEFAULT_OUT = HERE / "out"
SAMPLE_RATE = 44100
PPQ = 480  # MIDI ticks per beat

# General MIDI program per stem. Drums go on channel 10 and ignore the program.
GM_PROGRAM = {"bass": 33, "guitar": 27, "piano": 0, "vocals": 52, "other": 48}
TRACK_ORDER = ["drums", "bass", "guitar", "piano", "vocals", "other"]

# Basic Pitch settings per stem: frequency range in Hz, and whether the part is
# one note at a time.
PITCHED = {
    "bass": {"fmin": 30.0, "fmax": 400.0, "mono": True},
    "guitar": {"fmin": 70.0, "fmax": 1400.0, "mono": False},
    "piano": {"fmin": 27.0, "fmax": 4200.0, "mono": False},
    "vocals": {"fmin": 80.0, "fmax": 1200.0, "mono": True},
    "other": {"fmin": None, "fmax": None, "mono": False},
}

# ADTOF's five classes, as General MIDI drum notes.
DRUM_NAMES = {35: "kick", 38: "snare", 47: "tom", 42: "hi-hat", 49: "cymbal"}


def log(msg: str) -> None:
    print(msg, flush=True)


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, text=True, **kw)


def safe_name(name: str) -> str:
    """Make a title usable as a file or folder name."""
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', " ", name)
    name = re.sub(r"\s+", " ", name).strip(" .")
    return name[:120] or "untitled"


def is_url(text: str) -> bool:
    return re.match(r"^https?://", text) is not None


# --------------------------------------------------------------------------
# Getting the audio
# --------------------------------------------------------------------------


@dataclass
class Source:
    title: str
    audio: Path  # the original file, in whatever format it came in
    chapters: list[dict]  # [{title, start, end}] in seconds; may be empty
    info: dict  # goes into manifest.json


def ytdlp_base() -> list[str]:
    cmd = [sys.executable, "-m", "yt_dlp", "--no-playlist"]
    # YouTube needs a JavaScript runtime. yt-dlp looks for Deno by itself;
    # Node has to be named.
    if not shutil.which("deno") and shutil.which("node"):
        cmd += ["--js-runtimes", "node"]
    return cmd


def fetch_url(url: str, out_root: Path, force: bool) -> tuple[Source, Path]:
    log(f"Reading video details: {url}")
    meta = json.loads(run(ytdlp_base() + ["-J", url], capture_output=True).stdout)
    folder = out_root / safe_name(f"{meta['title']} [{meta['id']}]")
    interim = folder / "interim"
    interim.mkdir(parents=True, exist_ok=True)

    existing = [p for p in interim.glob("source.*") if p.suffix != ".part"]
    if existing and not force:
        audio = existing[0]
        log(f"Using downloaded audio: {audio.name}")
    else:
        for p in existing:
            p.unlink()
        log("Downloading audio")
        run(ytdlp_base() + ["-f", "bestaudio/best", "--force-overwrites", "-o", str(interim / "source.%(ext)s"), url])
        audio = next(p for p in interim.glob("source.*") if p.suffix != ".part")

    chapters = [
        {"title": c.get("title") or f"Chapter {i + 1}", "start": float(c["start_time"]), "end": float(c["end_time"])}
        for i, c in enumerate(meta.get("chapters") or [])
    ]
    info = {
        "source": url,
        "title": meta["title"],
        "id": meta["id"],
        "uploader": meta.get("uploader"),
        "duration_seconds": meta.get("duration"),
    }
    return Source(meta["title"], audio, chapters, info), folder


def open_file(path: Path, out_root: Path) -> tuple[Source, Path]:
    if not path.is_file():
        sys.exit(f"No such file: {path}")
    probe = json.loads(
        run(
            ["ffprobe", "-v", "error", "-print_format", "json", "-show_chapters", "-show_format", str(path)],
            capture_output=True,
        ).stdout
    )
    chapters = [
        {
            "title": (c.get("tags") or {}).get("title") or f"Chapter {i + 1}",
            "start": float(c["start_time"]),
            "end": float(c["end_time"]),
        }
        for i, c in enumerate(probe.get("chapters") or [])
    ]
    folder = out_root / safe_name(path.stem)
    (folder / "interim").mkdir(parents=True, exist_ok=True)
    info = {
        "source": str(path.resolve()),
        "title": path.stem,
        "duration_seconds": float(probe["format"].get("duration", 0)) or None,
    }
    return Source(path.stem, path, chapters, info), folder


def cut_wav(src: Path, dst: Path, start: float | None, end: float | None) -> None:
    """Decode (a slice of) any audio file to 44.1 kHz stereo WAV."""
    cmd = ["ffmpeg", "-v", "error", "-y"]
    if start is not None:
        cmd += ["-ss", f"{start:.3f}"]
    if end is not None:
        cmd += ["-to", f"{end:.3f}"]
    cmd += ["-i", str(src), "-vn", "-ac", "2", "-ar", str(SAMPLE_RATE), "-c:a", "pcm_s16le", str(dst)]
    run(cmd)


# --------------------------------------------------------------------------
# Step 1: separation
# --------------------------------------------------------------------------

_separator = None


def separate(wav_path: Path, stems_dir: Path, model_name: str, device: str) -> None:
    import soundfile as sf
    import torch
    from demucs.api import Separator

    global _separator
    if _separator is None:
        log(f"  loading Demucs model {model_name}")
        _separator = Separator(model=model_name, device=device, progress=True)

    audio, sr = sf.read(str(wav_path), dtype="float32", always_2d=True)
    _, stems = _separator.separate_tensor(torch.from_numpy(audio.T.copy()), sr)
    stems_dir.mkdir(parents=True, exist_ok=True)
    for name, tensor in stems.items():
        data = tensor.cpu().numpy().T
        sf.write(str(stems_dir / f"{name}.wav"), np.clip(data, -1.0, 1.0), _separator.samplerate, subtype="PCM_16")


def stem_levels(wav_path: Path, stems_dir: Path) -> dict[str, float]:
    """Loudness of each stem relative to the full mix, in dB."""
    import soundfile as sf

    def rms(p: Path) -> float:
        data, _ = sf.read(str(p), dtype="float32", always_2d=True)
        return float(np.sqrt(np.mean(np.square(data)))) if len(data) else 0.0

    mix = max(rms(wav_path), 1e-9)
    return {
        p.stem: round(20 * np.log10(max(rms(p), 1e-9) / mix), 1)
        for p in sorted(stems_dir.glob("*.wav"))
    }


# --------------------------------------------------------------------------
# Step 2: beats
# --------------------------------------------------------------------------

_beat_tracker = None


def track_beats(wav_path: Path, device: str) -> dict:
    import soundfile as sf
    from beat_this.inference import Audio2Beats

    global _beat_tracker
    if _beat_tracker is None:
        log("  loading beat_this model")
        _beat_tracker = Audio2Beats(checkpoint_path="final0", device=device, dbn=False)

    audio, sr = sf.read(str(wav_path), dtype="float32", always_2d=True)
    beats, downbeats = _beat_tracker(audio.mean(axis=1), sr)
    beats = [round(float(b), 4) for b in beats]
    downbeats = [round(float(b), 4) for b in downbeats]

    result = {"duration_seconds": round(len(audio) / sr, 3), "beats": beats, "downbeats": downbeats}
    if len(beats) >= 2:
        result["bpm_median"] = round(60.0 / float(np.median(np.diff(beats))), 2)
    result["beats_per_bar"] = beats_per_bar(beats, downbeats)
    return result


def beats_per_bar(beats: list[float], downbeats: list[float]) -> int:
    """The most common number of beats between two downbeats."""
    if len(beats) < 2 or len(downbeats) < 2:
        return 4
    b = np.asarray(beats)
    idx = [int(np.argmin(np.abs(b - d))) for d in downbeats]
    counts = Counter(int(n) for n in np.diff(idx) if n > 0)
    return counts.most_common(1)[0][0] if counts else 4


# --------------------------------------------------------------------------
# Step 3: transcription
# --------------------------------------------------------------------------

_pitch_model = None
_drum_model = None


def transcribe_pitched(stem_path: Path, stem: str) -> list[list]:
    """Notes as [start, end, pitch, velocity]."""
    global _pitch_model
    if _pitch_model is None:
        logging.getLogger().setLevel(logging.ERROR)  # Basic Pitch warns about backends we don't use
        warnings.filterwarnings("ignore")
        from basic_pitch import FilenameSuffix, build_icassp_2022_model_path
        from basic_pitch.inference import Model

        _pitch_model = Model(build_icassp_2022_model_path(FilenameSuffix.onnx))
    from basic_pitch.inference import predict

    cfg = PITCHED.get(stem, PITCHED["other"])
    _, _, events = predict(
        str(stem_path),
        _pitch_model,
        onset_threshold=0.5,
        frame_threshold=0.3,
        minimum_note_length=90.0,
        minimum_frequency=cfg["fmin"],
        maximum_frequency=cfg["fmax"],
        multiple_pitch_bends=False,
        melodia_trick=True,
    )
    notes = sorted(
        [round(float(s), 4), round(float(e), 4), int(p), int(np.clip(round(127 * float(a)), 1, 127))]
        for s, e, p, a, _ in events
    )
    return make_monophonic(notes) if cfg["mono"] else notes


def make_monophonic(notes: list[list]) -> list[list]:
    """One note at a time: near-simultaneous notes keep the louder, overlaps are cut short."""
    out: list[list] = []
    for note in notes:
        if out and note[0] < out[-1][1]:
            prev = out[-1]
            if note[0] - prev[0] < 0.03:
                if note[3] > prev[3]:
                    out[-1] = note
                continue
            prev[1] = note[0]
        out.append(note)
    return out


def transcribe_drums(stem_path: Path, device: str) -> list[list]:
    import torch
    from adtof_pytorch import (
        FRAME_RNN_THRESHOLDS,
        LABELS_5,
        PeakPicker,
        calculate_n_bins,
        create_frame_rnn_model,
        get_default_weights_path,
        load_audio_for_model,
        load_pytorch_weights,
    )

    global _drum_model
    if _drum_model is None:
        model = create_frame_rnn_model(calculate_n_bins())
        model = load_pytorch_weights(model, get_default_weights_path(), strict=False)
        _drum_model = model.eval().to(device)

    fps = 100
    with torch.no_grad():
        activations = _drum_model(load_audio_for_model(str(stem_path)).to(device)).cpu().numpy()
    peaks = PeakPicker(thresholds=FRAME_RNN_THRESHOLDS, fps=fps).pick(activations, labels=LABELS_5)[0]

    notes = []
    for i, label in enumerate(LABELS_5):
        threshold = FRAME_RNN_THRESHOLDS[i]
        for t in peaks[int(label)]:
            frame = min(int(round(t * fps)), activations.shape[1] - 1)
            strength = (float(activations[0, frame, i]) - threshold) / (1.0 - threshold)
            velocity = int(np.clip(round(50 + 77 * strength), 1, 127))
            notes.append([round(float(t), 4), round(float(t) + 0.1, 4), int(label), velocity])
    return sorted(notes)


# --------------------------------------------------------------------------
# Step 4: MIDI
# --------------------------------------------------------------------------


class Grid:
    """Maps seconds to MIDI ticks so detected beats land exactly on beats.

    Time zero stays at tick zero, so the MIDI lines up with the audio and the
    stems when both start at the beginning of a project.
    """

    def __init__(self, beats: list[float], downbeats: list[float], per_bar: int, duration: float):
        self.per_bar = per_bar
        if len(beats) < 2:
            # No usable beat grid: fall back to a steady 120 bpm.
            beats = [0.0, 0.5]
            downbeats = [0.0]
        b = [float(x) for x in beats]
        first_interval = b[1] - b[0]
        # Fill back towards zero. A first beat very close to zero is treated
        # as being at zero; otherwise the stretch from zero to the first beat
        # counts as one beat (a quarter to one and a quarter beats long).
        while b[0] > 1.25 * first_interval:
            b.insert(0, b[0] - first_interval)
        if b[0] > 0.25 * first_interval:
            b.insert(0, 0.0)
        else:
            b[0] = 0.0
        last_interval = b[-1] - b[-2]
        while b[-1] < duration + last_interval:
            b.append(b[-1] + last_interval)
        self.beats = np.asarray(b)
        self.ticks = np.arange(len(b)) * PPQ
        # Downbeats vote on where the bar line falls; the tracker's first
        # downbeat alone is often off. Beats before the first bar line form a
        # short pickup bar.
        phases = Counter(int(np.argmin(np.abs(self.beats - d))) % per_bar for d in downbeats)
        self.pickup = phases.most_common(1)[0][0] if phases else 0

    def tick(self, seconds: float) -> int:
        return int(round(float(np.interp(seconds, self.beats, self.ticks))))

    def conductor_track(self, name: str):
        import mido

        track = mido.MidiTrack()
        track.append(mido.MetaMessage("track_name", name=name, time=0))
        events = []  # (tick, order, message)
        if self.pickup:
            events.append((0, 0, mido.MetaMessage("time_signature", numerator=self.pickup, denominator=4)))
            events.append((self.pickup * PPQ, 0, mido.MetaMessage("time_signature", numerator=self.per_bar, denominator=4)))
        else:
            events.append((0, 0, mido.MetaMessage("time_signature", numerator=self.per_bar, denominator=4)))
        last_tempo = None
        for i, interval in enumerate(np.diff(self.beats)):
            tempo = int(np.clip(round(interval * 1_000_000), 1, 0xFFFFFF))
            if tempo != last_tempo:
                events.append((i * PPQ, 1, mido.MetaMessage("set_tempo", tempo=tempo)))
                last_tempo = tempo
        events.sort(key=lambda e: (e[0], e[1]))
        now = 0
        for tick, _, msg in events:
            track.append(msg.copy(time=tick - now))
            now = tick
        return track


def write_midi(path: Path, title: str, grid: Grid, notes_by_stem: dict[str, list[list]]) -> None:
    import mido

    mid = mido.MidiFile(type=1, ticks_per_beat=PPQ)
    mid.tracks.append(grid.conductor_track(title))

    next_channel = 0
    ordered = [s for s in TRACK_ORDER if s in notes_by_stem] + [s for s in notes_by_stem if s not in TRACK_ORDER]
    for stem in ordered:
        notes = notes_by_stem[stem]
        if not notes:
            continue
        track = mido.MidiTrack()
        track.append(mido.MetaMessage("track_name", name=stem, time=0))
        if stem == "drums":
            channel = 9
        else:
            channel = next_channel
            next_channel += 2 if next_channel == 8 else 1  # skip the drum channel
            track.append(mido.Message("program_change", channel=channel, program=GM_PROGRAM.get(stem, 0), time=0))
        events = []  # (tick, 0 for off / 1 for on, pitch, velocity)
        for start, end, pitch, velocity in notes:
            on = grid.tick(start)
            off = max(grid.tick(end), on + 1)
            events.append((on, 1, pitch, velocity))
            events.append((off, 0, pitch, 0))
        events.sort()
        now = 0
        for tick, is_on, pitch, velocity in events:
            kind = "note_on" if is_on else "note_off"
            track.append(mido.Message(kind, channel=channel, note=pitch, velocity=velocity, time=tick - now))
            now = tick
        mid.tracks.append(track)

    path.parent.mkdir(parents=True, exist_ok=True)
    mid.save(str(path))


# --------------------------------------------------------------------------
# One chapter, start to finish
# --------------------------------------------------------------------------


def process(name: str, src: Source, start, end, folder: Path, args) -> dict:
    work = folder / "interim" / name
    work.mkdir(parents=True, exist_ok=True)
    wav = work / "audio.wav"
    stems_dir = work / "stems"
    beats_file = work / "beats.json"
    notes_file = work / "notes.json"

    log(f"\n== {name}")
    if args.force or not wav.exists():
        cut_wav(src.audio, wav, start, end)

    if args.force or not any(stems_dir.glob("*.wav")):
        log("  separating stems")
        separate(wav, stems_dir, args.model, args.device)
    else:
        log("  stems: cached")
    levels = stem_levels(wav, stems_dir)

    if args.force or not beats_file.exists():
        log("  tracking beats")
        beats_file.write_text(json.dumps(track_beats(wav, args.device)))
    else:
        log("  beats: cached")
    beats = json.loads(beats_file.read_text())

    if args.force or not notes_file.exists():
        notes: dict[str, list[list]] = {}
        for stem, level in levels.items():
            if level < args.min_stem_db:
                log(f"  {stem}: skipped, {level} dB against the mix is below {args.min_stem_db} dB")
                continue
            log(f"  transcribing {stem}")
            path = stems_dir / f"{stem}.wav"
            notes[stem] = transcribe_drums(path, args.device) if stem == "drums" else transcribe_pitched(path, stem)
        notes_file.write_text(json.dumps(notes))
    else:
        log("  notes: cached")
    notes = json.loads(notes_file.read_text())

    grid = Grid(beats["beats"], beats["downbeats"], beats["beats_per_bar"], beats["duration_seconds"])
    midi_path = folder / f"{name}.mid"
    write_midi(midi_path, name, grid, notes)
    for stem, stem_notes in notes.items():
        if stem_notes:
            write_midi(work / "midi" / f"{stem}.mid", f"{name} ({stem})", grid, {stem: stem_notes})

    tracks = {}
    for stem, stem_notes in notes.items():
        tracks[stem] = {"notes": len(stem_notes)}
        if stem == "drums":
            hits = Counter(DRUM_NAMES.get(n[2], str(n[2])) for n in stem_notes)
            tracks[stem]["hits"] = dict(hits)
        elif stem_notes:
            tracks[stem]["lowest_midi_note"] = min(n[2] for n in stem_notes)
            tracks[stem]["highest_midi_note"] = max(n[2] for n in stem_notes)
    summary = {
        "name": name,
        "midi": midi_path.name,
        "start_seconds": start,
        "end_seconds": end,
        "duration_seconds": beats["duration_seconds"],
        "bpm_median": beats.get("bpm_median"),
        "beats_per_bar": beats["beats_per_bar"],
        "beats_found": len(beats["beats"]),
        "pickup_beats": grid.pickup,
        "stem_levels_db": levels,
        "tracks": tracks,
        "beats": beats["beats"],
        "downbeats": beats["downbeats"],
    }
    (folder / f"{name}.json").write_text(json.dumps(summary, indent=2))
    counts = ", ".join(f"{s} {t['notes']}" for s, t in tracks.items())
    log(f"  wrote {midi_path.name}: {beats.get('bpm_median')} bpm, notes: {counts}")
    return {k: v for k, v in summary.items() if k not in ("beats", "downbeats")}


def main() -> None:
    parser = argparse.ArgumentParser(description="Turn a song (audio file or YouTube URL) into multitrack MIDI.")
    parser.add_argument("input", help="audio file path or video URL")
    parser.add_argument("-o", "--out", type=Path, default=DEFAULT_OUT, help=f"output folder (default: {DEFAULT_OUT})")
    parser.add_argument("--model", default="htdemucs_6s", help="Demucs model (default: htdemucs_6s, six stems)")
    parser.add_argument("--no-chapters", action="store_true", help="treat the input as one piece even if it has chapters")
    parser.add_argument("--chapters", help="only these chapters, by number, e.g. 1,3")
    parser.add_argument("--min-stem-db", type=float, default=-30.0, help="skip stems quieter than this against the mix (default: -30)")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--force", action="store_true", help="redo every step, ignoring cached results")
    args = parser.parse_args()

    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            sys.exit(f"{tool} is required and was not found on PATH")
    if args.device == "auto":
        import torch

        args.device = "cuda" if torch.cuda.is_available() else "cpu"

    out_root = args.out.expanduser().resolve()
    if is_url(args.input):
        src, folder = fetch_url(args.input, out_root, args.force)
    else:
        src, folder = open_file(Path(args.input).expanduser(), out_root)

    if src.chapters and not args.no_chapters:
        width = max(2, len(str(len(src.chapters))))
        jobs = [
            (f"{i + 1:0{width}d} - {safe_name(c['title'])}", c["start"], c["end"])
            for i, c in enumerate(src.chapters)
        ]
        if args.chapters:
            wanted = {int(n) for n in args.chapters.split(",")}
            jobs = [job for i, job in enumerate(jobs) if i + 1 in wanted]
        log(f"{len(src.chapters)} chapters found, processing {len(jobs)}")
    else:
        jobs = [(safe_name(src.title), None, None)]

    results = [process(name, src, start, end, folder, args) for name, start, end in jobs]

    manifest = {
        **src.info,
        "chapters_in_source": src.chapters,
        "settings": {"separation_model": args.model, "min_stem_db": args.min_stem_db, "device": args.device},
        "pieces": results,
    }
    (folder / "manifest.json").write_text(json.dumps(manifest, indent=2))
    log(f"\nDone. Results are in {folder}")


if __name__ == "__main__":
    main()
