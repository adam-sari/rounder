# Media fixtures

Small synthetic files for the media engine. Made with desktop ffmpeg 8.1; regenerate with
`sh tests/fixtures/media/make-fixtures.sh` (the exact commands are in that script). Output
from other ffmpeg versions differs byte-wise, but not in any property the tests check.

| file        | contents                                              | duration | exercises                          |
| ----------- | ----------------------------------------------------- | -------- | ---------------------------------- |
| sample.mp4  | H.264 High 640×360 30 fps + AAC 48 kHz stereo         | 3 s      | the common case, remux, every op   |
| sample.webm | VP9 640×360 30 fps + Opus 48 kHz mono                 | 3 s      | WebM input, mono audio             |
| sample.mov  | H.264 480×270 25 fps + AAC 44.1 kHz mono (QuickTime)  | 3 s      | MOV input, mixed sizes in concat   |
| sample.mp3  | MP3 128k 44.1 kHz stereo                              | 3 s      | audio tools                        |
| sample.wav  | PCM s16 44.1 kHz stereo                               | 2 s      | WAV reader (unit tests), audio     |
| sample.gif  | 160×90, 20 frames at 10 fps                           | 2 s      | GIF decode (unit tests), GIF → MP4 |
| sample.avi  | MPEG-4 Part 2 320×180 25 fps + MP3 mono               | 2.04 s   | the ffmpeg.wasm fallback           |

The picture is ffmpeg's `testsrc2` (timecode and frame counter burnt in), so trims, seeks and
speed changes can be checked by eye. Used by `tests/unit/media-*.test.ts` and by the browser
smoke tests in `src/engines/media/lab/smoke.ts` (served by the dev server at
`/tests/fixtures/media/…`).
