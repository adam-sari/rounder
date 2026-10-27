#!/usr/bin/env sh
# Regenerates the media fixtures with a desktop ffmpeg (made with 8.1, Lavf62).
#   sh tests/fixtures/media/make-fixtures.sh [out-dir]     (default: this folder)
# Picture: ffmpeg's testsrc2 (colour bars, moving gradient, timecode + frame counter), so
# trims, seeks and speed changes can be checked by eye. Sound: a quiet 440/660 Hz sine pair.
# Every file is tiny (< 400 KB) and the durations are what the smoke tests assert.
set -eu
OUT="${1:-$(dirname "$0")}"
mkdir -p "$OUT"
FF="ffmpeg -hide_banner -loglevel error -y"
tone() { echo "sine=f=440:d=$1:sample_rate=$2,volume=0.3[l];sine=f=660:d=$1:sample_rate=$2,volume=0.3[r];[l][r]amerge=inputs=2"; }

# 3 s 640×360 30 fps H.264 High + AAC 48 kHz stereo (the everyday phone/web file)
$FF -f lavfi -i testsrc2=s=640x360:r=30:d=3 -f lavfi -i "$(tone 3 48000)" \
  -c:v libx264 -crf 30 -preset medium -pix_fmt yuv420p -c:a aac -b:a 96k -shortest -movflags +faststart "$OUT/sample.mp4"

# 3 s 640×360 30 fps VP9 + Opus mono (browser recordings, YouTube downloads)
$FF -f lavfi -i testsrc2=s=640x360:r=30:d=3 -f lavfi -i sine=f=440:d=3:sample_rate=48000 \
  -c:v libvpx-vp9 -crf 40 -b:v 0 -deadline good -cpu-used 4 -c:a libopus -b:a 64k -ac 1 -shortest "$OUT/sample.webm"

# 3 s 480×270 25 fps H.264 + AAC 44.1 kHz mono in QuickTime (iPhone-style container, odd rate)
$FF -f lavfi -i testsrc2=s=480x270:r=25:d=3 -f lavfi -i sine=f=440:d=3:sample_rate=44100 \
  -c:v libx264 -crf 30 -pix_fmt yuv420p -c:a aac -b:a 96k -ac 1 -shortest "$OUT/sample.mov"

# 3 s MP3 128k 44.1 kHz stereo
$FF -f lavfi -i "$(tone 3 44100)" -c:a libmp3lame -b:a 128k "$OUT/sample.mp3"

# 2 s 16-bit WAV 44.1 kHz stereo
$FF -f lavfi -i "$(tone 2 44100)" -c:a pcm_s16le "$OUT/sample.wav"

# 2 s 160×90 GIF, 20 frames at 10 fps (one palette)
$FF -f lavfi -i testsrc2=s=160x90:r=10:d=2 -vf "split[a][b];[a]palettegen[p];[b][p]paletteuse" -loop 0 "$OUT/sample.gif"

# ~2 s 320×180 MPEG-4 Part 2 + MP3 mono in AVI: browsers can't open this, so it exercises
# the ffmpeg.wasm fallback
$FF -f lavfi -i testsrc2=s=320x180:r=25:d=2 -f lavfi -i sine=f=440:d=2:sample_rate=44100 \
  -c:v mpeg4 -q:v 5 -c:a libmp3lame -b:a 96k -ac 1 "$OUT/sample.avi"

ls -l "$OUT"/sample.*
