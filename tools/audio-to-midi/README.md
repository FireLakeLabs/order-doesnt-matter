# audio-to-midi

Turns a song into multitrack MIDI. Give it an audio file or a YouTube URL.
It is a standalone Python tool and is not part of the app build.

## Run

Needs `uv`, `ffmpeg`, and Node or Deno (yt-dlp uses one of them for YouTube).

```bash
cd tools/audio-to-midi
uv python install 3.10   # once, if uv has no Python 3.10
uv sync                  # once
uv run extract.py "https://www.youtube.com/watch?v=..."
uv run extract.py ~/Music/song.wav --out ~/transcriptions
```

Options:

- `-o, --out DIR`: where results go. Defaults to `tools/audio-to-midi/out/`, which is git ignored.
- `--chapters 1,3`: only these chapters.
- `--no-chapters`: treat the input as one piece.
- `--model NAME`: Demucs model. The default `htdemucs_6s` gives six stems; `htdemucs_ft` gives four.
- `--min-stem-db N`: skip stems quieter than this against the mix. Default -30.
- `--force`: redo every step instead of reusing cached results.

## What it does

A video with chapters is cut into one piece per chapter. Each piece goes through:

1. **Separate**: Demucs splits the mix into drums, bass, vocals, guitar, piano and other.
2. **Beats**: `beat_this` finds beats and downbeats on the full mix.
3. **Transcribe**: ADTOF reads the drum stem; Basic Pitch reads each pitched stem.
4. **Assemble**: one MIDI file with a track per stem.

The MIDI carries a tempo map built from the detected beats, so notes keep their
real timing and still sit on the bar grid. Time zero is tick zero, so the MIDI
lines up with the stems when both start at the beginning of a project.

## Output

```
out/<title> [<video id>]/
  manifest.json                 source, chapters, settings, per-piece summary
  01 - <chapter>.mid            the result
  01 - <chapter>.json           tempo, beats, downbeats, stem levels, note counts
  interim/
    source.webm                 the downloaded audio
    01 - <chapter>/
      audio.wav                 the chapter, 44.1 kHz stereo
      stems/<stem>.wav          separated audio
      beats.json                beat tracker output
      notes.json                every note as [start, end, pitch, velocity]
      midi/<stem>.mid           one MIDI file per stem
```

## Limits

- Drums come out as five kinds of hit: kick, snare, tom, hi-hat, cymbal.
- Bass and vocals are forced to one note at a time.
- Basic Pitch reports pitch, not playing technique; distorted guitar is the weakest stem.
- A quiet stem can be bleed from other instruments. Check `stem_levels_db` in the piece's JSON.
- The beat tracker can settle on half or double the tempo a player would count.
- `pyproject.toml` pins CPU builds of PyTorch for Linux. Remove the `pytorch-cpu` index blocks to use a GPU.

## Licences

The code of every dependency is open source. The pretrained ADTOF drum weights
derive from a non-commercial release, and the PyTorch port used here declares no
licence, so treat drum transcription as personal-use only until that is checked.
