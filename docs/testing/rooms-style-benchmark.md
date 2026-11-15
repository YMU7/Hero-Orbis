# Six-room Orbis style benchmark (`/rooms`)

Route: `/rooms` (the `/mvp` app is unchanged and still works).
Config: [`app/rooms/roomConfigs.ts`](../../app/rooms/roomConfigs.ts). Every prompt is
`<room style sentence> + SHARED_SCENE + SHARED_ACTIONS[action]`, so only the
style line differs between rooms. Seed 42 in every room, delivery 1080p.

Status values: **PASS / PARTIAL / FAIL / NOT TESTED**. Desktop and emulator
results are kept separate from Quest 3 results. Quest rows stay NOT TESTED
until someone checks them on the headset.

## Room lifecycle (as implemented)

One Orbis connection for all rooms; only the active room generates.

```
activate(room) → [reset if this session already had input]  ← clears prompt, image, visual history
               → set_seed(42) → set_resolution(1080p, once per session)
               → [uploadFile + set_image if room.referenceImage]
               → set_prompt(room.initial) → start
               → canvas shows video only after THIS run's first chunk with frames
Approach/Point → set_prompt(room.<action>) on the active room only (4 s cooldown, no start/reset)
```

Activations are serialized, and a newer activation supersedes an older one
(each async step re-checks a token). Late acks after a room switch are ignored.
If the connection drops mid-activation, the room waits and resumes on the next Connect.

## Desktop live run (2026-11-14 14:15–14:22, team key, Chromium, this PC's network)

| Room | Activation | First frames | Initial look | APPROACH (acked) | POINT (acked) | Style distinct? |
|---|---|---|---|---|---|---|
| 1 Realistic Fantasy | `set_seed → set_resolution → set_prompt → start` | 4.0 s | Photoreal: auburn hair, green hooded cloak, arched door with iron padlock | PASS: walked to a close-up | PARTIAL: moved back toward the door, no clear raised-arm point in the captured frame | Baseline |
| 2 Stylized Realism / Storybook | `reset` first, then same chain | 4.8 s | Warmer and more saturated, storybook grade | PASS: close-up | PARTIAL: turned to face the padlocked door (back to camera), arm not visible | Moderate |
| 3 Animated Feature | reset → chain | 5.5 s | Smoother skin and shapes, still semi-realistic | PASS: close-up | **PASS**: walked to the door and reached toward it | Weak to moderate (not clearly "3D animated") |
| 4 Painterly Storybook | reset → chain | 5.3 s | Softer, slightly painted; brushstrokes not obvious | PARTIAL: moved somewhat closer | PARTIAL: turned and raised a hand to the wall; door drifted out of frame | Weak to moderate |
| 5 Anime Adventure | (1st room of a new session: no reset needed) | 4.0 s | Clear anime: line art, cel shading, anime face | PASS: close-up | PARTIAL: turned sideways toward the wall, no arm, door out of frame | **Strong** |
| 6 Dark Fairytale / Gothic | reset → chain | 4.6 s | Darker, colder, moodier | PASS: moved closer | PARTIAL: turned to the door (back to camera) | Moderate |

Evidence: event log plus a screenshot per state (initial, approach, point)
taken ~11 s after each ack. All 12 action `set_prompt`s were acked, with no command errors.

### Isolation / lifecycle checks

| Check | Result | Evidence |
|---|---|---|
| Room switch issues `reset` before the new room's prompt | PASS | Log room 2: `→ reset`, `generation_reset`, `← reset ok`, then `set_seed → set_prompt → start` |
| Chunk counter restarts per room (fresh run) | PASS | Screenshots show chunk 3 shortly after each activation |
| No style carry-over | PASS | Room 6 activated right after room 5 (anime) shows no anime traits |
| Only the active canvas shows video | PASS | Inactive canvases show their labelled placeholder (mock + live) |
| Inactive room's buttons can't affect the active canvas | PASS (emulated XR) | `select act:realistic:approach` while room 2 was active → `not sent — room not active` |
| One connection for all rooms | PASS | Same `sessionId` across rooms 1–4 |
| Connection drop mid-activation | FAIL, then FIXED, then PASS | 14:18:28 `peer connection state: Disconnected` during room 5's reset. The room was stuck in `error`. Now it parks in `waiting-connection` and resumes on Connect. Verified: Disconnect → Connect → room 6 restarted automatically on a new session |
| Time-to-first-frame metric after a reconnect | FIXED | Was measured from the original click (57.4 s); now measured from the restart |

### Findings

1. **Approach works consistently** (6/6 visible, 5 strong).
2. **Point is the weak action**: she turns toward the door in most rooms, but a
   clear raised-arm point was captured only in room 3. In rooms 4 and 5 the
   composition drifted and the door left the frame. Candidate prompt tweak for
   the next pass: restate "the door stays in frame on the left" and describe
   the arm pose earlier and more concretely. Not changed yet.
3. **Style separation is uneven**: anime is strong; storybook, gothic and
   animated are moderate; painterly is weak. Candidate: stronger, more
   medium-specific style sentences, or per-room reference images
   (`referenceImage` is supported but none are configured).
4. Network was good for this run (7.4–8.6 Mbps, 18 fps) except a short dip
   and one WebRTC disconnect between rooms 4 and 5.

## Emulated (IWER Quest 3, desktop Chromium), mock source, 0 credits

| Check | Result |
|---|---|
| Immersive session, six rooms around the viewer | PASS |
| Controller ray + trigger on a side room's canvas activates it | PASS (`select canvas:storybook-realism via controller 1 (right, tracked-pointer)`) |
| Trigger on an inactive room's button is refused | PASS |
| Trigger on the active room's APPROACH | PASS |

## Meta Quest 3 (physical): checklist

| ID | Test | Result | Notes |
|---|---|---|---|
| R0 | `/rooms` loads in Quest Browser; ENTER VR works | NOT TESTED | |
| R1 | Six rooms visible by turning the head; labels readable | NOT TESTED | |
| R2 | Ray + trigger on a canvas activates that room | NOT TESTED | |
| R3 | Live video appears only on the active canvas | NOT TESTED | |
| R4 | APPROACH / POINT in the active room change only that canvas | NOT TESTED | |
| R5 | Buttons of an inactive room do nothing | NOT TESTED | |
| R6 | Switch rooms 3+ times: no stale frames, no style carry-over | NOT TESTED | |
| R7 | Each style looks distinct on the headset | NOT TESTED | |
| R8 | XR render fps / decoded fps stable (HUD) | NOT TESTED | |
| R9 | Disconnect at the end | NOT TESTED | |
