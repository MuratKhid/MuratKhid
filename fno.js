/* FNOFlow — a Fourier Neural Operator running live in the browser.
   The operator was trained offline (fno/train_fno.py) to map a cylinder's
   signed-distance field to the steady potential-flow velocity field; here
   its weights are executed in a Web Worker with a hand-rolled FFT so
   inference never blocks the 120fps streamline animation.

   API:
     FNOFlow.init(baseUrl, onReady, onField)   — fetch weights, boot worker
     FNOFlow.predict(a, b, r)                  — cylinder in [0,1]² coords
   onField receives {field: Float32Array(2·64·64) [u|v], a, b, r, err, ms}. */

(function () {
  'use strict';

  /* Everything below runs inside the Web Worker (serialized via toString). */
  function workerMain() {
    var MAN = null, WTS = null, T = {};
    var WIDTH = 0, MODES = 0, LAYERS = 0, N = 64, K = 0, N2 = 0;

    /* buffers, allocated on init */
    var inBuf, chA, chB, xfRe, xfIm, ofRe, ofIm, tmpRe, tmpIm, rowRe, rowIm, colRe, colIm;

    /* ── radix-2 complex FFT, length N ── */
    var fftRev, fftCos, fftSin;
    function fftInit(n) {
      var bits = Math.round(Math.log(n) / Math.LN2);
      fftRev = new Uint32Array(n);
      for (var i = 0; i < n; i++) {
        var r = 0;
        for (var b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
        fftRev[i] = r;
      }
      fftCos = new Float64Array(n / 2);
      fftSin = new Float64Array(n / 2);
      for (var k = 0; k < n / 2; k++) {
        fftCos[k] = Math.cos(-2 * Math.PI * k / n);
        fftSin[k] = Math.sin(-2 * Math.PI * k / n);
      }
    }
    function fft(re, im, inverse) {
      var n = re.length, i, j, t;
      for (i = 0; i < n; i++) {
        j = fftRev[i];
        if (j > i) {
          t = re[i]; re[i] = re[j]; re[j] = t;
          t = im[i]; im[i] = im[j]; im[j] = t;
        }
      }
      for (var len = 2; len <= n; len <<= 1) {
        var half = len >> 1, step = n / len;
        for (i = 0; i < n; i += len) {
          for (j = 0; j < half; j++) {
            var k = j * step;
            var wr = fftCos[k], wi = inverse ? -fftSin[k] : fftSin[k];
            var a = i + j, b = a + half;
            var tr = re[b] * wr - im[b] * wi;
            var ti = re[b] * wi + im[b] * wr;
            re[b] = re[a] - tr; im[b] = im[a] - ti;
            re[a] += tr; im[a] += ti;
          }
        }
      }
      if (inverse) for (i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
    }

    /* rfft2 of one real channel, keeping only the first K frequency
       columns (all that the spectral conv will touch) */
    function rfft2keep(src, sOff, dstRe, dstIm, dOff) {
      var i, j, k;
      for (i = 0; i < N; i++) {
        for (j = 0; j < N; j++) { rowRe[j] = src[sOff + i * N + j]; rowIm[j] = 0; }
        fft(rowRe, rowIm, false);
        for (k = 0; k < K; k++) { tmpRe[i * K + k] = rowRe[k]; tmpIm[i * K + k] = rowIm[k]; }
      }
      for (k = 0; k < K; k++) {
        for (i = 0; i < N; i++) { colRe[i] = tmpRe[i * K + k]; colIm[i] = tmpIm[i * K + k]; }
        fft(colRe, colIm, false);
        for (i = 0; i < N; i++) { dstRe[dOff + i * K + k] = colRe[i]; dstIm[dOff + i * K + k] = colIm[i]; }
      }
    }

    /* irfft2 of a spectrum that is nonzero only in columns k < K
       (Hermitian reconstruction of the real row transform) */
    function irfft2(srcRe, srcIm, sOff, dst, dOff) {
      var i, j, k;
      for (k = 0; k < K; k++) {
        for (i = 0; i < N; i++) { colRe[i] = srcRe[sOff + i * K + k]; colIm[i] = srcIm[sOff + i * K + k]; }
        fft(colRe, colIm, true);
        for (i = 0; i < N; i++) { tmpRe[i * K + k] = colRe[i]; tmpIm[i * K + k] = colIm[i]; }
      }
      for (i = 0; i < N; i++) {
        rowRe.fill(0); rowIm.fill(0);
        for (k = 0; k < K; k++) {
          rowRe[k] = tmpRe[i * K + k]; rowIm[k] = tmpIm[i * K + k];
          if (k > 0) { rowRe[N - k] = tmpRe[i * K + k]; rowIm[N - k] = -tmpIm[i * K + k]; }
        }
        fft(rowRe, rowIm, true);
        for (j = 0; j < N; j++) dst[dOff + i * N + j] = rowRe[j];
      }
    }

    /* exact-erf GELU, matching torch.nn.functional.gelu */
    function erf(x) {
      var s = x < 0 ? -1 : 1;
      x = Math.abs(x);
      var t = 1 / (1 + 0.3275911 * x);
      var y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
        - 0.284496736) * t + 0.254829592) * t) * Math.exp(-x * x);
      return s * y;
    }
    function gelu(x) { return 0.5 * x * (1 + erf(x / 1.4142135623730951)); }

    /* out_f = spectral weights ⊗ xf on the two retained mode corners */
    function spectral(l) {
      ofRe.fill(0); ofIm.fill(0);
      var w1r = T['sc' + l + '.w1.re'], w1i = T['sc' + l + '.w1.im'];
      var w2r = T['sc' + l + '.w2.re'], w2i = T['sc' + l + '.w2.im'];
      var M = MODES, NK = N * K;
      for (var ci = 0; ci < WIDTH; ci++) {
        for (var co = 0; co < WIDTH; co++) {
          var wBase = (ci * WIDTH + co) * M * M;
          for (var k1 = 0; k1 < M; k1++) {
            var x1 = ci * NK + k1 * K, o1 = co * NK + k1 * K;
            var x2 = ci * NK + (N - M + k1) * K, o2 = co * NK + (N - M + k1) * K;
            var wRow = wBase + k1 * M;
            for (var k2 = 0; k2 < M; k2++) {
              var xr = xfRe[x1 + k2], xi = xfIm[x1 + k2];
              var wr = w1r[wRow + k2], wi = w1i[wRow + k2];
              ofRe[o1 + k2] += xr * wr - xi * wi;
              ofIm[o1 + k2] += xr * wi + xi * wr;
              xr = xfRe[x2 + k2]; xi = xfIm[x2 + k2];
              wr = w2r[wRow + k2]; wi = w2i[wRow + k2];
              ofRe[o2 + k2] += xr * wr - xi * wi;
              ofIm[o2 + k2] += xr * wi + xi * wr;
            }
          }
        }
      }
    }

    function forward(a, b, r, out) {
      var i, j, p, ci, co;
      /* input channels: [sdf, x, y] on the [0,1]² grid */
      for (i = 0; i < N; i++) {
        for (j = 0; j < N; j++) {
          p = i * N + j;
          var x = j / N, y = i / N;
          var dx = x - a, dy = y - b;
          inBuf[p] = Math.sqrt(dx * dx + dy * dy) - r;
          inBuf[N2 + p] = x;
          inBuf[2 * N2 + p] = y;
        }
      }
      /* lift 3 → WIDTH */
      var lw = T['lift.weight'], lb = T['lift.bias'];
      for (co = 0; co < WIDTH; co++) {
        var w0 = lw[co * 3], w1 = lw[co * 3 + 1], w2 = lw[co * 3 + 2], bo = lb[co];
        for (p = 0; p < N2; p++) {
          chA[co * N2 + p] = bo + w0 * inBuf[p] + w1 * inBuf[N2 + p] + w2 * inBuf[2 * N2 + p];
        }
      }
      /* FNO layers: spectral conv + pointwise conv, GELU between */
      for (var l = 0; l < LAYERS; l++) {
        for (ci = 0; ci < WIDTH; ci++) rfft2keep(chA, ci * N2, xfRe, xfIm, ci * N * K);
        spectral(l);
        for (co = 0; co < WIDTH; co++) irfft2(ofRe, ofIm, co * N * K, chB, co * N2);
        var ww = T['w' + l + '.weight'], wb = T['w' + l + '.bias'];
        for (co = 0; co < WIDTH; co++) {
          var off = co * N2, bv = wb[co];
          for (p = 0; p < N2; p++) chB[off + p] += bv;
          for (ci = 0; ci < WIDTH; ci++) {
            var wv = ww[co * WIDTH + ci], src = ci * N2;
            if (wv === 0) continue;
            for (p = 0; p < N2; p++) chB[off + p] += wv * chA[src + p];
          }
        }
        if (l < LAYERS - 1) for (p = 0; p < WIDTH * N2; p++) chB[p] = gelu(chB[p]);
        var t = chA; chA = chB; chB = t;
      }
      /* projection WIDTH → 64 → 2, per pixel */
      var p1w = T['proj1.weight'], p1b = T['proj1.bias'];
      var p2w = T['proj2.weight'], p2b = T['proj2.bias'];
      var hid = new Float64Array(64);
      for (p = 0; p < N2; p++) {
        for (var h = 0; h < 64; h++) {
          var acc = p1b[h];
          for (ci = 0; ci < WIDTH; ci++) acc += p1w[h * WIDTH + ci] * chA[ci * N2 + p];
          hid[h] = gelu(acc);
        }
        for (co = 0; co < 2; co++) {
          var acc2 = p2b[co];
          for (var h2 = 0; h2 < 64; h2++) acc2 += p2w[co * 64 + h2] * hid[h2];
          out[co * N2 + p] = acc2;
        }
      }
    }

    /* rel-L2 of the prediction against the analytic solution, body excluded */
    function analyticError(a, b, r, out) {
      var num = 0, den = 0;
      for (var i = 0; i < N; i++) {
        for (var j = 0; j < N; j++) {
          var x = j / N, y = i / N;
          var dx = x - a, dy = y - b;
          var r2 = dx * dx + dy * dy;
          if (r2 < r * r * 1.0404) continue;
          var f = r * r / (r2 * r2);
          var ua = 1 - f * (dx * dx - dy * dy);
          var va = -f * 2 * dx * dy;
          var p = i * N + j;
          var du = out[p] - ua, dv = out[N2 + p] - va;
          num += du * du + dv * dv;
          den += ua * ua + va * va;
        }
      }
      return Math.sqrt(num / Math.max(den, 1e-12));
    }

    self.onmessage = function (e) {
      var msg = e.data;
      if (msg.type === 'init') {
        MAN = msg.manifest;
        WTS = new Float32Array(msg.weights);
        for (var k = 0; k < MAN.tensors.length; k++) {
          var t = MAN.tensors[k];
          var size = t.shape.reduce(function (x, y) { return x * y; }, 1);
          T[t.name] = WTS.subarray(t.offset, t.offset + size);
        }
        WIDTH = MAN.width; MODES = MAN.modes; LAYERS = MAN.layers;
        N = MAN.grid; K = MAN.modes; N2 = N * N;
        fftInit(N);
        inBuf = new Float64Array(3 * N2);
        chA = new Float64Array(WIDTH * N2);
        chB = new Float64Array(WIDTH * N2);
        xfRe = new Float64Array(WIDTH * N * K); xfIm = new Float64Array(WIDTH * N * K);
        ofRe = new Float64Array(WIDTH * N * K); ofIm = new Float64Array(WIDTH * N * K);
        tmpRe = new Float64Array(N * K); tmpIm = new Float64Array(N * K);
        rowRe = new Float64Array(N); rowIm = new Float64Array(N);
        colRe = new Float64Array(N); colIm = new Float64Array(N);
        self.postMessage({ type: 'ready' });
      } else if (msg.type === 'predict') {
        var t0 = performance.now();
        var out = new Float64Array(2 * N2);
        forward(msg.a, msg.b, msg.r, out);
        var err = analyticError(msg.a, msg.b, msg.r, out);
        var buf = new Float32Array(out);
        self.postMessage({
          type: 'field', a: msg.a, b: msg.b, r: msg.r, err: err,
          ms: performance.now() - t0, buf: buf.buffer
        }, [buf.buffer]);
      }
    };
  }

  var FNOFlow = {
    ready: false,
    pending: false,
    _worker: null,
    _onField: null,

    init: function (baseUrl, onReady, onField) {
      this._onField = onField;
      var self_ = this;
      Promise.all([
        fetch(baseUrl + 'fno-manifest.json').then(function (r) {
          if (!r.ok) throw new Error('manifest ' + r.status);
          return r.json();
        }),
        fetch(baseUrl + 'fno-weights.bin').then(function (r) {
          if (!r.ok) throw new Error('weights ' + r.status);
          return r.arrayBuffer();
        })
      ]).then(function (res) {
        var need = 0;
        res[0].tensors.forEach(function (t) {
          var size = t.shape.reduce(function (x, y) { return x * y; }, 1);
          if (t.offset + size > need) need = t.offset + size;
        });
        if (res[1].byteLength < need * 4) {
          throw new Error('weights truncated: got ' + res[1].byteLength +
            ' bytes, need ' + need * 4);
        }
        var src = '(' + workerMain.toString() + ')()';
        var url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
        var w = new Worker(url);
        URL.revokeObjectURL(url);
        self_._worker = w;
        w.onerror = function (e) {
          self_.pending = false;
          self_.ready = false;
          self_._worker = null;
          try { w.terminate(); } catch (_) {}
          if (onReady) onReady(e || new Error('worker error'));
        };
        w.onmessageerror = w.onerror;
        w.onmessage = function (e) {
          var msg = e.data;
          if (msg.type === 'ready') {
            self_.ready = true;
            if (onReady) onReady(null);
          } else if (msg.type === 'field') {
            self_.pending = false;
            if (self_._onField) {
              self_._onField({
                field: new Float32Array(msg.buf),
                a: msg.a, b: msg.b, r: msg.r, err: msg.err, ms: msg.ms
              });
            }
          }
        };
        w.postMessage({ type: 'init', manifest: res[0], weights: res[1] }, [res[1]]);
      }).catch(function (err) {
        if (onReady) onReady(err);
      });
    },

    predict: function (a, b, r) {
      if (!this.ready || this.pending || !this._worker) return false;
      this.pending = true;
      this._worker.postMessage({ type: 'predict', a: a, b: b, r: r });
      return true;
    }
  };

  window.FNOFlow = FNOFlow;
})();
