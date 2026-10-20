"""Acceptance checks for the real-footage overlay demo (demo/realfeed, SPEC 7).

The demo is decoupled from the synthetic product: these tests need no footage, only numpy and
OpenCV, and run on generated images.
"""

from pathlib import Path

import cv2
import numpy as np
import pytest

from demo.realfeed.calibrate import Observation, fit_calibration, load_calibration
from demo.realfeed.camera import TrackerParams, track_sequence
from demo.realfeed.download import sha256_of
from demo.realfeed.geometry import apply_h, fit_homography
from demo.realfeed.overlay import composite, grass_mask
from demo.realfeed.pitch import FutsalPitch
from demo.realfeed.players import NearestNeighbourTracker, classify_teams
from demo.realfeed.privacy import blur_outside, polygon_mask

CALIBRATION_JSON = Path(__file__).parents[1] / "demo" / "realfeed" / "calibration.json"


def _camera_homography(
    yaw: float, tilt: float, focal: float, cam=(0.0, -16.0, 7.0), size=(1920, 1080)
) -> np.ndarray:
    """Image-from-world homography of a pinhole camera looking at the ground plane z = 0."""
    cy, sy = np.cos(yaw), np.sin(yaw)
    forward = np.array([sy, cy, 0.0])
    right = np.array([cy, -sy, 0.0])
    down = np.array([0.0, 0.0, -1.0])
    # Tilt the optical axis down by `tilt` around the right vector.
    axis = np.cos(tilt) * forward + np.sin(tilt) * down
    rot = np.stack([right, np.cross(axis, right), axis])  # camera x right, y down, z forward
    k = np.array([[focal, 0, size[0] / 2], [0, focal, size[1] / 2], [0, 0, 1.0]])
    t = -rot @ np.asarray(cam)
    p = k @ np.column_stack([rot, t])
    h = p[:, [0, 1, 3]]
    return h / h[2, 2]


# --- (a) homography round trip and calibration --------------------------------------------


def test_homography_round_trip_error_is_negligible():
    rng = np.random.default_rng(0)
    world = rng.uniform([-20, -10], [20, 10], size=(200, 2))
    for yaw in (-0.6, 0.0, 0.5):
        h = _camera_homography(yaw, 0.35, 1400.0)
        img = apply_h(h, world)
        seen = (img >= 0).all(axis=1) & (img[:, 0] < 1920) & (img[:, 1] < 1080)
        world_seen, img = world[seen], img[seen]
        assert len(world_seen) > 30
        back = apply_h(np.linalg.inv(h), img)
        assert np.abs(back - world_seen).max() < 1e-9
        # A DLT fit from the projected points recovers the same mapping.
        h_fit = fit_homography(world_seen, img)
        assert np.abs(apply_h(h_fit, world_seen) - img).max() < 1e-6


def _observations_from(h: np.ndarray, pitch: FutsalPitch, frame: str, rng, noise_px: float):
    obs = []
    for feature, pts in pitch.feature_samples().items():
        img = apply_h(h, pts)
        in_front = (np.column_stack([pts, np.ones(len(pts))]) @ h[2]) > 0
        inside = (img[:, 0] > 0) & (img[:, 0] < 1920) & (img[:, 1] > 0) & (img[:, 1] < 1080)
        inside &= in_front
        for p in img[inside][:: max(1, inside.sum() // 8)]:
            obs.append(Observation(frame, feature, p + rng.normal(0, noise_px, 2)))
    return obs


def test_calibration_fit_recovers_pitch_size_and_projection():
    rng = np.random.default_rng(1)
    truth = FutsalPitch(length=38.4, width=19.2)
    h_ref = _camera_homography(0.55, 0.30, 1500.0)  # looking at the right half
    h_ctr = _camera_homography(0.0, 0.42, 1300.0)  # looking at the centre circle
    obs = _observations_from(h_ref, truth, "ref", rng, 0.5)
    obs += _observations_from(h_ctr, truth, "centre", rng, 0.5)
    ref_from_centre = h_ref @ np.linalg.inv(h_ctr)
    # Start from a deliberately wrong pitch and a homography from four rough clicks.
    rough_world = np.array([[0.0, 9.6], [0.0, -3.0], [19.2, 1.5], [13.2, 0.0]])
    rough_img = apply_h(h_ref, rough_world) + rng.normal(0, 15, (4, 2))
    guess = fit_homography(np.array([[0, 10.0], [0, -3.0], [20.0, 1.5], [14.0, 0.0]]), rough_img)
    cal = fit_calibration(obs, {"ref": np.eye(3), "centre": ref_from_centre}, FutsalPitch(), guess)
    assert abs(cal.pitch.length - truth.length) < 0.4
    assert abs(cal.pitch.width - truth.width) < 0.3
    assert cal.rms_px < 1.0
    # Held-out ground points over the visible part of the pitch.
    grid, _ = truth.grid(1.0)
    img = apply_h(h_ref, grid)
    seen = (img >= 0).all(axis=1) & (img[:, 0] < 1920) & (img[:, 1] < 1080)
    err = np.linalg.norm(apply_h(cal.h_img_from_world, grid[seen]) - img[seen], axis=1)
    assert err.max() < 2.0


def test_committed_calibration_points_fit_within_a_few_pixels():
    cal = load_calibration(CALIBRATION_JSON)
    assert cal.rms_px < 3.0
    # Approximate futsal dimensions (Laws of the Game: 25-42 m by 16-25 m).
    assert 25.0 <= cal.pitch.length <= 42.0
    assert 16.0 <= cal.pitch.width <= 25.0


# --- (b) camera tracking drift on a video with known homography motion ----------------------


def _ground_texture(rng, shape=(900, 1600)) -> np.ndarray:
    noise = rng.normal(0, 1, shape).astype(np.float32)
    tex = cv2.GaussianBlur(noise, (0, 0), 2.0)
    tex = (tex - tex.min()) / (tex.max() - tex.min())
    img = np.zeros((*shape, 3), np.uint8)
    img[..., 0] = 40 + 50 * tex
    img[..., 1] = 90 + 70 * tex
    img[..., 2] = 40 + 40 * tex
    for x in range(100, shape[1], 400):
        cv2.line(img, (x, 0), (x + 150, shape[0]), (60, 200, 220), 5)
    cv2.circle(img, (800, 450), 220, (60, 200, 220), 5)
    return img


def test_camera_tracking_drift_is_below_a_pixel_on_known_motion():
    rng = np.random.default_rng(2)
    canvas = _ground_texture(rng)
    n, size = 150, (640, 360)
    truth = []
    frames = []
    blobs = rng.uniform([50, 50], [590, 310], size=(6, 2))
    blob_vel = rng.normal(0, 3, size=(6, 2))
    for i in range(n):
        s = i / (n - 1)
        # Pan right and down, zoom in by 8 %, with a little keystone change: a PTZ camera.
        zoom = 1.0 + 0.08 * s
        h = np.array(
            [[zoom, 0.02 * s, -(300 + 420 * s)], [0.0, zoom, -(200 + 90 * s)], [0, 2e-5 * s, 1.0]]
        )
        frame = cv2.warpPerspective(canvas, h, size, flags=cv2.INTER_LINEAR)
        # Independently moving "players" the tracker must reject.
        for b in blobs + blob_vel * i:
            x, y = int(b[0]) % size[0], int(b[1]) % size[1]
            cv2.rectangle(frame, (x, y), (x + 14, y + 40), (40, 40, 210), -1)
        frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
        truth.append(h)
    hs = track_sequence(frames, params=TrackerParams())
    corners = np.array([[0, 0], [size[0], 0], [size[0], size[1]], [0, size[1]]], float)
    worst = 0.0
    for i in range(n):
        true_rel = truth[i] @ np.linalg.inv(truth[0])
        err = np.linalg.norm(apply_h(hs[i], corners) - apply_h(true_rel, corners), axis=1)
        worst = max(worst, err.max())
    assert worst < 1.0, f"drift {worst:.2f} px"


# --- (c) everything outside the pitch polygon is blurred ------------------------------------


def _hf_energy(img: np.ndarray, mask: np.ndarray) -> float:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    lap = cv2.Laplacian(gray, cv2.CV_32F, ksize=3)
    return float(np.mean(lap[mask] ** 2))


def test_pixels_outside_the_pitch_polygon_are_blurred_and_darkened():
    rng = np.random.default_rng(3)
    frame = rng.integers(0, 256, size=(1080, 1920, 3), dtype=np.uint8)
    h = _camera_homography(0.5, 0.3, 1500.0)
    keep = polygon_mask(h, FutsalPitch(40.0, 20.0).polygon(margin=0.3), frame.shape[:2])
    assert 0.2 < keep.mean() < 0.9
    out = blur_outside(frame, keep)
    outside = cv2.erode((~keep).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    assert _hf_energy(out, outside) < 0.01 * _hf_energy(frame, outside)
    assert out[outside].mean() < 0.7 * frame[outside].mean()
    np.testing.assert_array_equal(out[keep], frame[keep])


def test_the_rendered_background_setting_also_blurs_everything_off_the_pitch():
    from demo.realfeed.render import BACKGROUND

    rng = np.random.default_rng(8)
    frame = rng.integers(0, 256, size=(1080, 1920, 3), dtype=np.uint8)
    h = _camera_homography(0.5, 0.3, 1500.0)
    keep = polygon_mask(h, FutsalPitch(40.0, 20.0).polygon(margin=0.3), frame.shape[:2])
    out = blur_outside(frame, keep, **BACKGROUND)
    grow = 2 * BACKGROUND["feather_px"] + 5  # the feathered rim reaches this far outward
    outside = cv2.erode((~keep).astype(np.uint8), np.ones((grow, grow), np.uint8)).astype(bool)
    assert _hf_energy(out, outside) < 0.01 * _hf_energy(frame, outside)
    np.testing.assert_array_equal(out[keep], frame[keep])


def test_prints_on_the_red_kit_are_found_but_not_the_ball():
    from demo.realfeed.privacy import erase_prints, kit_print_mask

    frame = np.empty((200, 300, 3), np.uint8)
    frame[:] = TURF[0]
    cv2.rectangle(frame, (40, 30), (120, 150), (60, 60, 225), -1)  # red shirt
    cv2.rectangle(frame, (60, 60), (100, 82), (235, 235, 240), -1)  # white sponsor patch
    cv2.putText(frame, "AB", (64, 78), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (40, 40, 160), 1)
    cv2.circle(frame, (128, 160), 8, (235, 235, 235), -1)  # ball at the player's feet
    mask = kit_print_mask(frame, np.ones(frame.shape[:2], bool))
    assert mask[62:80, 62:98].mean() > 0.95
    assert not mask[152:168, 120:136].any()
    erased = erase_prints(frame, mask)
    patch = cv2.cvtColor(erased[62:80, 62:98], cv2.COLOR_BGR2HSV)
    assert patch[..., 1].mean() > 120  # now shirt-coloured, not white


# --- (d) ground graphics appear on grass pixels only ----------------------------------------

# Turf, line, kit and surround colours sampled from the footage (BGR, frames at 16:05 and 16:12).
TURF = [(97, 117, 97), (101, 126, 103), (109, 140, 115), (92, 113, 91), (110, 135, 113)]
NOT_TURF = [
    (99, 152, 155),  # yellow line, near side
    (91, 84, 213),  # red shirt
    (217, 154, 86),  # sky-blue bib
    (57, 53, 47),  # black shorts
    (93, 100, 117),  # skin in shade
    (91, 133, 248),  # orange goalkeeper
    (164, 169, 195),  # brick walkway
    (235, 235, 235),  # white ball / socks
]


def test_grass_key_separates_turf_from_lines_kits_and_skin():
    swatch = np.array([TURF + NOT_TURF], np.uint8)
    key = grass_mask(swatch)[0]
    assert key[: len(TURF)].all()
    assert not key[len(TURF) :].any()


def test_ground_graphics_change_only_grass_pixels():
    rng = np.random.default_rng(4)
    frame = np.empty((360, 640, 3), np.uint8)
    frame[:] = TURF[0]
    frame += rng.integers(0, 12, frame.shape[:2], dtype=np.uint8)[..., None]
    cv2.line(frame, (0, 300), (640, 200), NOT_TURF[0], 6)
    for i, c in enumerate(NOT_TURF[1:]):
        cv2.rectangle(frame, (60 + 90 * i, 100), (90 + 90 * i, 200), c, -1)
    layer = np.zeros_like(frame)
    layer[:] = (255, 0, 255)
    alpha = np.full(frame.shape[:2], 0.6, np.float32)
    key = grass_mask(frame)
    out = composite(frame, layer, alpha, key)
    changed = np.any(out != frame, axis=-1)
    assert changed.any()
    assert not (changed & ~key).any()


# --- players and housekeeping ---------------------------------------------------------------


def test_team_clustering_splits_red_shirts_from_blue_bibs():
    rng = np.random.default_rng(5)
    red = np.column_stack([rng.normal(178, 3, 30) % 180, rng.uniform(150, 255, 30)])
    blue = np.column_stack([rng.normal(103, 4, 25), rng.uniform(120, 255, 25)])
    hue_sat = np.vstack([red, blue])
    labels, names = classify_teams(hue_sat)
    assert set(labels[:30]) == {names.index("red")}
    assert set(labels[30:]) == {names.index("blue")}


def test_nearest_neighbour_tracker_keeps_identities_and_smooths_velocity():
    tracker = NearestNeighbourTracker(gate_m=1.0, max_missing=10)
    fps = 50.0
    rng = np.random.default_rng(6)
    for i in range(100):
        t = i / fps
        pts = np.array([[1.0 + 3.0 * t, 2.0], [5.0, -1.0 - 2.0 * t]]) + rng.normal(0, 0.03, (2, 2))
        if i == 40:
            pts = pts[:1]  # one missed detection
        tracker.update(i, pts, np.zeros(len(pts), int))
    tracks = tracker.finished(min_length=50)
    assert len(tracks) == 2
    vel = sorted((tr.velocity(fps)[50] for tr in tracks), key=lambda v: v[0])
    np.testing.assert_allclose(vel[0], [0.0, -2.0], atol=0.3)
    np.testing.assert_allclose(vel[1], [3.0, 0.0], atol=0.3)


def test_sha256_of_streams_files(tmp_path):
    p = tmp_path / "x.bin"
    p.write_bytes(b"through their eyes")
    assert sha256_of(p) == "6c325d5b2a188a73a00bc01c0ff1ef7ccacf651e2aa2ae334c07d4e7c24d9d63"


@pytest.mark.parametrize("margin", [0.0, 0.5])
def test_pitch_polygon_contains_its_markings(margin):
    pitch = FutsalPitch(40.0, 20.0)
    for pts in pitch.feature_samples().values():
        assert pitch.contains(pts, margin=margin + 1e-6).all()


def test_player_silhouettes_stay_in_their_boxes_and_the_rest_is_blurred():
    from demo.realfeed.players import Detection
    from demo.realfeed.render import player_silhouettes

    rng = np.random.default_rng(7)
    frame = rng.integers(0, 256, size=(360, 640, 3), dtype=np.uint8)
    body = np.zeros((80, 30), bool)
    body[5:, 8:22] = True  # a standing figure inside its box
    det = Detection(
        np.array([215.0, 179.0]), np.zeros(2), (200, 100, 30, 80), 0.0, 0.0,
        silhouette=np.packbits(body, axis=1),
    )  # fmt: skip
    sil = player_silhouettes([det], frame.shape[:2], grow_px=3)
    ys, xs = np.nonzero(sil)
    assert xs.min() >= 200 - 3 and xs.max() < 230 + 3
    assert ys.min() >= 100 - 3 and ys.max() < 180 + 3
    pitch_area = np.zeros(frame.shape[:2], bool)
    pitch_area[200:] = True
    keep = pitch_area | sil
    out = blur_outside(frame, keep)
    outside = cv2.erode((~keep).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    assert _hf_energy(out, outside) < 0.01 * _hf_energy(frame, outside)
    np.testing.assert_array_equal(out[sil], frame[sil])


# --- decoupling from the app (SPEC 7, real-footage overlay) -----------------------------------

ROOT = Path(__file__).parents[1]
APP_PACKAGES = ("sim", "analytics", "explain", "agents", "api")
FRAME_SUFFIXES = {".mp4", ".webm", ".mov", ".mkv", ".avi", ".png", ".jpg", ".jpeg", ".gif"}


def test_the_app_never_imports_or_references_the_real_footage_demo():
    for pkg in APP_PACKAGES:
        for path in (ROOT / pkg).rglob("*.py"):
            text = path.read_text(encoding="utf-8")
            assert "realfeed" not in text, f"{path.relative_to(ROOT)} references demo.realfeed"
    skip = {"node_modules", "dist"}
    for path in (ROOT / "web").rglob("*"):
        if path.is_file() and not skip & set(path.parts):
            text = path.read_bytes().decode("utf-8", errors="ignore")
            assert "realfeed" not in text, f"{path.relative_to(ROOT)} references realfeed"


def test_no_video_or_image_frames_are_tracked_under_demo():
    import subprocess

    try:
        tracked = subprocess.run(
            ["git", "ls-files", "demo"], cwd=ROOT, capture_output=True, text=True, check=True
        ).stdout.split()
    except (OSError, subprocess.CalledProcessError):
        pytest.skip("not a git checkout")
    frames = [p for p in tracked if Path(p).suffix.lower() in FRAME_SUFFIXES]
    assert frames == []


def test_opencv_stays_out_of_the_app_dependencies():
    import tomllib

    project = tomllib.loads((ROOT / "pyproject.toml").read_text())
    main = " ".join(project["project"]["dependencies"]).lower()
    assert "opencv" not in main  # the API container syncs with --no-default-groups
    assert any("opencv" in d for d in project["dependency-groups"]["realfeed"])


def test_goal_frame_stays_sharp_but_a_pale_crest_behind_it_does_not():
    from demo.realfeed.privacy import camera_matrix, goal_frame_mask

    h = _camera_homography(0.55, 0.30, 1500.0)
    frame = np.empty((1080, 1920, 3), np.uint8)
    frame[:] = (200, 170, 190)  # pale lavender wall
    p = camera_matrix(h, (1920, 1080))

    def proj(x, y, z):
        q = p @ np.array([x, y, z, 1.0])
        return int(round(q[0] / q[2])), int(round(q[1] / q[2]))

    gx = 20.0
    a, b, c, d = proj(gx, 1.5, 0), proj(gx, 1.5, 2), proj(gx, -1.5, 2), proj(gx, -1.5, 0)
    posts = np.zeros(frame.shape[:2], np.uint8)
    for p0, p1 in ((a, b), (b, c), (c, d)):
        cv2.line(frame, p0, p1, (245, 245, 245), 6)
        cv2.line(posts, p0, p1, 1, 6)
    arc = np.zeros(frame.shape[:2], np.uint8)
    centre = proj(gx + 1.0, 0.0, 1.0)
    cv2.ellipse(frame, centre, (25, 25), 0, 20, 160, (225, 235, 240), 3)  # a pale crest stripe
    cv2.ellipse(arc, centre, (25, 25), 0, 20, 160, 1, 3)
    mask = goal_frame_mask(frame, h, gx)
    assert mask[posts.astype(bool)].mean() > 0.6
    assert mask[arc.astype(bool)].mean() < 0.1
