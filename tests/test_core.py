import json
from collections import Counter

import numpy as np
import pytest
from PIL import Image

from chromalith.core.colorplan import ColorPlan, ColorStop, auto_plan, simulate_colors
from chromalith.core.export import export_all
from chromalith.core.filaments import (Filament, FilamentLibrary, builtin_library, hex_to_rgb,
                                       parse_filaments)
from chromalith.core.heightmap import HeightSettings, build_heightmap, layer_top_z, luminance
from chromalith.core.mesh import heightmap_to_mesh, read_stl, write_stl
from chromalith.core.project import Project


def gradient(w=64, h=32):
    x = np.linspace(0, 255, w, dtype=np.float32)
    arr = np.tile(x, (h, 1))
    return Image.fromarray(np.stack([arr] * 3, -1).astype(np.uint8), "RGB")


WHITE = Filament("Weiß", "#ffffff", 4.0, id="w")
BLACK = Filament("Schwarz", "#000000", 0.5, id="k")
RED = Filament("Rot", "#ff0000", 2.0, id="r")


def settings(**kw):
    s = HeightSettings(width_mm=20, pixel_size_mm=0.5)
    for k, v in kw.items():
        setattr(s, k, v)
    return s


def test_heights_quantized_and_in_range():
    s = settings()
    hm = build_heightmap(gradient(), s, "bright_high")
    k = (hm.heights - s.base_layer_mm) / s.layer_height_mm
    assert np.allclose(k, np.round(k), atol=1e-4)
    assert hm.heights.min() >= s.min_height_mm - 1e-4
    assert hm.heights.max() <= s.max_height_mm + s.layer_height_mm / 2
    # links dunkel, rechts hell -> rechts höher
    assert hm.heights[:, -1].mean() > hm.heights[:, 0].mean()
    hm2 = build_heightmap(gradient(), s, "dark_high")
    assert hm2.heights[:, -1].mean() < hm2.heights[:, 0].mean()


def test_size_and_border():
    s = settings(border_mm=2.0, border_height_mm=1.0)
    hm = build_heightmap(gradient(), s)
    w, _ = hm.size_mm
    assert w == pytest.approx(24.0, abs=0.01)
    assert hm.heights[0, 0] == pytest.approx(1.0, abs=0.05)


def test_luminance_methods_range():
    rgb = np.random.default_rng(0).random((8, 8, 3)).astype(np.float32)
    for m in ("rec709", "rec601", "average", "lightness", "max"):
        y = luminance(rgb, m)
        assert y.min() >= 0 and y.max() <= 1


def test_mesh_watertight_and_volume(tmp_path):
    hm = build_heightmap(gradient(30, 20), settings(width_mm=10))
    mesh = heightmap_to_mesh(hm)
    edges = Counter()
    for a, b, c in mesh.faces:
        for e in ((a, b), (b, c), (c, a)):
            edges[e] += 1
    for (a, b), n in edges.items():
        assert n == 1 and edges[(b, a)] == 1, "Netz ist nicht geschlossen/konsistent"
    w, d = hm.size_mm
    expected = hm.heights.mean() * w * d
    assert mesh.volume() > 0
    assert mesh.volume() == pytest.approx(expected, rel=0.05)
    path = tmp_path / "m.stl"
    write_stl(mesh, path)
    tris = read_stl(path)
    assert len(tris) == len(mesh.faces)


def test_plan_segments_and_simulation():
    hm = build_heightmap(gradient(), settings(), "dark_high")
    plan = auto_plan([WHITE, RED, BLACK], hm)
    segs = plan.segments(hm.base_layer_mm, hm.layer_height_mm, hm.layer_count)
    assert [s[0].id for s in segs] == ["w", "r", "k"]
    assert segs[0][3] == 1 and segs[-1][4] == hm.layer_count
    for a, b in zip(segs, segs[1:]):
        assert b[3] == a[4] + 1
        assert b[1] == pytest.approx(a[2])
    rgb = simulate_colors(hm, plan)
    # dunkle Bildseite (links, hoch, viel Schwarz) muss dunkler sein als rechts
    assert rgb[:, 0].mean() < rgb[:, -1].mean()


def test_thin_layer_is_translucent():
    hm = build_heightmap(gradient(), settings(), "bright_high")
    plan = ColorPlan([ColorStop(WHITE, 1), ColorStop(BLACK, hm.layer_count)])
    rgb = simulate_colors(hm, plan)
    top = rgb[:, -1].mean()
    assert 0.05 < top < 0.95   # eine 0.08-mm-Schicht Schwarz deckt nicht komplett


def test_import_foreign_schema():
    data = {"filaments": [{"Brand": "X", "Color": "#ff0000", "Name": "Rot", "Owned": True,
                           "Transmissivity": 2.5, "Type": "PETG", "uuid": "{abc}"}], "name": "Set"}
    f = parse_filaments(data)[0]
    assert (f.name, f.td, f.material, f.owned, f.id) == ("Rot", 2.5, "PETG", True, "abc")
    assert np.allclose(hex_to_rgb(f.color), [1, 0, 0])


def test_library_roundtrip(tmp_path):
    lib = builtin_library()
    assert len(lib) >= 10
    p = tmp_path / "lib.json"
    lib.save(p)
    lib2 = FilamentLibrary.load(p)
    assert [f.to_dict() for f in lib2] == [f.to_dict() for f in lib]


def test_project_roundtrip_and_export(tmp_path):
    proj = Project(image=gradient().convert("RGBA"), settings=settings(), name="Test")
    grey = Filament("Grau", "#808080", 1.5, id="g")
    proj.plan = ColorPlan([ColorStop(WHITE, 1), ColorStop(grey, 1), ColorStop(BLACK, 1)])
    proj.auto_distribute()
    assert proj.effective_height_mode() == "dark_high"
    p = tmp_path / "t.chroma"
    proj.save(p)
    proj2 = Project.load(p)
    assert [(s.filament.id, s.start_layer) for s in proj2.plan.stops] == \
           [(s.filament.id, s.start_layer) for s in proj.plan.stops]
    assert np.array_equal(np.asarray(proj2.image), np.asarray(proj.image))
    files = export_all(proj2, tmp_path / "out" / "modell")
    assert all(f.exists() for f in files)
    js = json.loads(files[2].read_text(encoding="utf-8"))
    assert len(js["changes"]) == 3
    assert "Wechsel vor Schicht" in files[1].read_text(encoding="utf-8")


def test_layer_top():
    assert layer_top_z(1, 0.16, 0.08) == pytest.approx(0.16)
    assert layer_top_z(3, 0.16, 0.08) == pytest.approx(0.32)


def test_detail_filter_removes_single_pixel_spikes():
    arr = np.full((40, 40), 128, np.uint8)
    arr[10, 10] = 255            # einzelner heller Punkt
    arr[20:30, 20:30] = 255      # echtes Detail
    img = Image.fromarray(arr)
    s = settings(width_mm=7.8, pixel_size_mm=0.2, detail_mm=0.4)
    hm = build_heightmap(img, s, "bright_high")
    base = hm.heights[5, 5]
    assert hm.heights[10, 10] == pytest.approx(base)          # Ausreißer weg
    assert hm.heights[25, 25] > base + 0.5                    # Fläche bleibt


def test_downsample_is_block_mean():
    hm = build_heightmap(gradient(200, 100), settings(width_mm=40, pixel_size_mm=0.2))
    small = hm.downsampled(50)
    assert small.heights.shape[1] <= 51
    assert small.heights.min() >= hm.heights.min() - 1e-4
    assert small.heights.max() <= hm.heights.max() + 1e-4


def test_color_mode_uses_filament_colors():
    # linke Hälfte rot, rechte Hälfte gelb
    arr = np.zeros((40, 80, 3), np.uint8)
    arr[:, :40] = (200, 30, 30)
    arr[:, 40:] = (240, 220, 20)
    yellow = Filament("Gelb", "#f5d10f", 5.0, id="y")
    proj = Project(image=Image.fromarray(arr).convert("RGBA"),
                   settings=settings(width_mm=16, pixel_size_mm=0.2))
    proj.plan = ColorPlan([ColorStop(WHITE, 1), ColorStop(yellow, 1), ColorStop(RED, 1)])
    assert proj.effective_height_mode() == "color"
    proj.auto_distribute()
    hm = proj.build()
    rgb = simulate_colors(hm, proj.plan)
    left, right = rgb[:, 5:30].mean((0, 1)), rgb[:, 50:75].mean((0, 1))
    assert left[0] > left[1] + 0.2           # links rötlich
    assert right[1] > 0.5 and right[0] > 0.5  # rechts gelblich


def test_analysis():
    from chromalith.core.analysis import filament_usage, image_palette, nearest_filament
    pal = image_palette(gradient().convert("RGB"), 4)
    assert abs(sum(s for _, s in pal) - 1) < 1e-6
    f, d = nearest_filament("#fe0101", [WHITE, BLACK, RED])
    assert f.id == "r" and d < 5
    hm = build_heightmap(gradient(), settings(), "bright_high")
    plan = auto_plan([BLACK, WHITE], hm)
    use = filament_usage(hm, plan)
    assert abs(sum(u[1] for u in use) - 1) < 1e-6
