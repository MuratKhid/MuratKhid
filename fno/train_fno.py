"""
Train a small Fourier Neural Operator to learn the solution operator of
potential flow past a cylinder:  cylinder SDF  ->  steady velocity field.

Ground truth is the classical analytic solution (uniform stream + doublet,
U = 1) sampled on a square [0,1]^2 grid. The trained weights are exported
as a flat float32 blob + JSON manifest consumed by fno.js, which runs the
operator live in the browser to drive the hero flow animation.

Run:  python3 fno/train_fno.py
Outputs: fno/fno-weights.bin, fno/fno-manifest.json, fno/fno-test.json, fno/fno.pt
"""

import json
import math
import os
import struct

import torch
import torch.nn as nn

torch.manual_seed(7)

WIDTH = 12       # hidden channels
MODES = 8        # Fourier modes kept per dimension
LAYERS = 3
STEPS = 1500
BATCH = 12
LR = 2e-3
OUT_DIR = os.path.dirname(os.path.abspath(__file__))


# ── analytic ground truth ────────────────────────────────────────────────────

def flow_batch(a, b, r, n):
    """u, v of potential flow past a cylinder at (a, b) radius r on an n×n
    grid over [0,1]^2 (U = 1, x to the right). Inside the body: 0."""
    B = a.shape[0]
    xs = torch.arange(n, dtype=torch.float32) / n
    y, x = torch.meshgrid(xs, xs, indexing="ij")          # row i = y, col j = x
    x = x.expand(B, n, n)
    y = y.expand(B, n, n)
    dx = x - a.view(B, 1, 1)
    dy = y - b.view(B, 1, 1)
    r2 = dx * dx + dy * dy
    R2 = (r * r).view(B, 1, 1)
    f = R2 / (r2 * r2).clamp_min(1e-12)
    u = 1 - f * (dx * dx - dy * dy)
    v = -f * 2 * dx * dy
    inside = r2 < R2 * 1.02**2
    u = torch.where(inside, torch.zeros_like(u), u)
    v = torch.where(inside, torch.zeros_like(v), v)
    sdf = torch.sqrt(r2.clamp_min(1e-12)) - r.view(B, 1, 1)
    inp = torch.stack([sdf, x, y], dim=1)                 # (B, 3, n, n)
    tgt = torch.stack([u, v], dim=1)                      # (B, 2, n, n)
    mask = (~inside).unsqueeze(1).float()                 # grade outside only
    return inp, tgt, mask


def sample_batch(B, n):
    a = torch.rand(B) * 0.84 + 0.08
    b = torch.rand(B) * 0.84 + 0.08
    r = torch.rand(B) * 0.10 + 0.03
    inp, tgt, mask = flow_batch(a, b, r, n)
    return inp, tgt, mask


# ── model ────────────────────────────────────────────────────────────────────

class SpectralConv2d(nn.Module):
    def __init__(self, in_c, out_c, m1, m2):
        super().__init__()
        self.m1, self.m2 = m1, m2
        scale = 1.0 / (in_c * out_c)
        self.w1 = nn.Parameter(scale * torch.rand(in_c, out_c, m1, m2, dtype=torch.cfloat))
        self.w2 = nn.Parameter(scale * torch.rand(in_c, out_c, m1, m2, dtype=torch.cfloat))

    def forward(self, x):
        B, C, H, W = x.shape
        xf = torch.fft.rfft2(x)
        out = torch.zeros(B, self.w1.shape[1], H, W // 2 + 1, dtype=torch.cfloat)
        out[:, :, :self.m1, :self.m2] = torch.einsum(
            "bixy,ioxy->boxy", xf[:, :, :self.m1, :self.m2], self.w1)
        out[:, :, -self.m1:, :self.m2] = torch.einsum(
            "bixy,ioxy->boxy", xf[:, :, -self.m1:, :self.m2], self.w2)
        return torch.fft.irfft2(out, s=(H, W))


class FNO2d(nn.Module):
    def __init__(self, width=WIDTH, modes=MODES, layers=LAYERS):
        super().__init__()
        self.lift = nn.Conv2d(3, width, 1)
        self.sconvs = nn.ModuleList(
            [SpectralConv2d(width, width, modes, modes) for _ in range(layers)])
        self.wconvs = nn.ModuleList(
            [nn.Conv2d(width, width, 1) for _ in range(layers)])
        self.proj1 = nn.Conv2d(width, 64, 1)
        self.proj2 = nn.Conv2d(64, 2, 1)

    def forward(self, x):
        x = self.lift(x)
        n = len(self.sconvs)
        for i, (sc, wc) in enumerate(zip(self.sconvs, self.wconvs)):
            x = sc(x) + wc(x)
            if i < n - 1:
                x = torch.nn.functional.gelu(x)
        return self.proj2(torch.nn.functional.gelu(self.proj1(x)))


# ── training ─────────────────────────────────────────────────────────────────

def rel_l2(pred, tgt, mask):
    diff = ((pred - tgt) * mask).flatten(1)
    ref = (tgt * mask).flatten(1)
    return (diff.norm(dim=1) / ref.norm(dim=1).clamp_min(1e-9))


def main():
    model = FNO2d()
    n_params = sum(p.numel() for p in model.parameters())
    print(f"FNO2d width={WIDTH} modes={MODES} layers={LAYERS}  ({n_params:,} params)")

    opt = torch.optim.Adam(model.parameters(), lr=LR)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=STEPS, eta_min=LR / 20)

    # mixed-resolution training: the operator must be discretization-invariant
    res_choices = [32, 32, 48, 64]

    for step in range(1, STEPS + 1):
        n = res_choices[step % len(res_choices)]
        inp, tgt, mask = sample_batch(BATCH, n)
        pred = model(inp)
        loss = (((pred - tgt) * mask) ** 2).sum() / mask.sum().clamp_min(1.0) / 2
        opt.zero_grad()
        loss.backward()
        opt.step()
        sched.step()
        if step % 100 == 0 or step == 1:
            print(f"step {step:5d}  n={n}  loss {loss.item():.3e}")

    # validation at the deployment resolution
    model.eval()
    with torch.no_grad():
        torch.manual_seed(1234)
        inp, tgt, mask = sample_batch(64, 64)
        err = rel_l2(model(inp), tgt, mask)
        print(f"val rel-L2 @64x64: median {err.median():.4f}  "
              f"mean {err.mean():.4f}  max {err.max():.4f}")

    torch.save(model.state_dict(), os.path.join(OUT_DIR, "fno.pt"))
    export(model)
    export_test_fixture(model)


# ── export for the browser ───────────────────────────────────────────────────

def export(model):
    """Flat float32 blob + manifest. Complex tensors split into .re/.im,
    1x1 convs squeezed to (out, in). Order matters — fno.js reads by name."""
    entries = []
    blobs = []

    def add(name, t):
        t = t.detach().to(torch.float32).contiguous()
        entries.append({"name": name, "shape": list(t.shape)})
        blobs.append(t.numpy().tobytes())

    add("lift.weight", model.lift.weight.squeeze(-1).squeeze(-1))
    add("lift.bias", model.lift.bias)
    for i, (sc, wc) in enumerate(zip(model.sconvs, model.wconvs)):
        add(f"sc{i}.w1.re", sc.w1.real)
        add(f"sc{i}.w1.im", sc.w1.imag)
        add(f"sc{i}.w2.re", sc.w2.real)
        add(f"sc{i}.w2.im", sc.w2.imag)
        add(f"w{i}.weight", wc.weight.squeeze(-1).squeeze(-1))
        add(f"w{i}.bias", wc.bias)
    add("proj1.weight", model.proj1.weight.squeeze(-1).squeeze(-1))
    add("proj1.bias", model.proj1.bias)
    add("proj2.weight", model.proj2.weight.squeeze(-1).squeeze(-1))
    add("proj2.bias", model.proj2.bias)

    offset = 0
    for e, b in zip(entries, blobs):
        e["offset"] = offset
        offset += len(b) // 4

    manifest = {"width": WIDTH, "modes": MODES, "layers": LAYERS,
                "grid": 64, "tensors": entries}
    with open(os.path.join(OUT_DIR, "fno-manifest.json"), "w") as f:
        json.dump(manifest, f)
    with open(os.path.join(OUT_DIR, "fno-weights.bin"), "wb") as f:
        f.write(b"".join(blobs))
    print(f"exported {offset * 4 / 1024:.0f} KB of weights")


def export_test_fixture(model):
    """One known input/output pair so fno.js can verify numeric parity."""
    a = torch.tensor([0.62])
    b = torch.tensor([0.42])
    r = torch.tensor([0.085])
    inp, tgt, mask = flow_batch(a, b, r, 64)
    with torch.no_grad():
        pred = model(inp)
    err = rel_l2(pred, tgt, mask).item()
    fix = {
        "a": 0.62, "b": 0.42, "r": 0.085, "n": 64,
        "rel_l2_vs_analytic": err,
        "u": [round(v, 6) for v in pred[0, 0].flatten().tolist()],
        "v": [round(v, 6) for v in pred[0, 1].flatten().tolist()],
    }
    with open(os.path.join(OUT_DIR, "fno-test.json"), "w") as f:
        json.dump(fix, f)
    print(f"test fixture rel-L2 vs analytic: {err:.4f}")


if __name__ == "__main__":
    main()
