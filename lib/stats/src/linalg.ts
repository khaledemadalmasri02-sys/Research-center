/** Minimal dense linear algebra for OLS regression. */

export type Matrix = number[][];

export function multiply(a: Matrix, b: Matrix): Matrix {
  const n = a.length;
  const m = b[0].length;
  const k = b.length;
  const out: Matrix = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let p = 0; p < k; p++) {
      const aip = a[i][p];
      if (aip === 0) continue;
      for (let j = 0; j < m; j++) out[i][j] += aip * b[p][j];
    }
  }
  return out;
}

export function transpose(a: Matrix): Matrix {
  return a[0].map((_, j) => a.map((row) => row[j]));
}

export function inverse(a: Matrix): Matrix {
  const n = a.length;
  // Augment with identity.
  const m: Matrix = a.map((row, i) => [
    ...row,
    ...new Array(n).fill(0).map((_, j) => (i === j ? 1 : 0)),
  ]);
  for (let col = 0; col < n; col++) {
    // Pivot.
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) throw new Error("Matrix is singular.");
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const div = m[col][col];
    for (let j = 0; j < 2 * n; j++) m[col][j] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r][col];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) m[r][j] -= factor * m[col][j];
    }
  }
  return m.map((row) => row.slice(n));
}

/**
 * Eigen-decomposition of a real symmetric matrix via the cyclic Jacobi method.
 * Returns eigenvalues (descending) and the corresponding eigenvectors as
 * column vectors. Suited to correlation/covariance matrices for PCA.
 */
export function jacobiEigen(input: Matrix, maxSweeps = 100): { values: number[]; vectors: Matrix } {
  const n = input.length;
  // Working copy.
  const a = input.map((row) => row.slice());
  const v: Matrix = Array.from({ length: n }, (_, i) => new Array(n).fill(0).map((_, j) => (i === j ? 1 : 0)));

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off < 1e-14) break;

    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-18) continue;
        const app = a[p][p];
        const aqq = a[q][q];
        const apq = a[p][q];
        const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
        const c = Math.cos(phi);
        const s = Math.sin(phi);
        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }

  const values = a.map((row, i) => row[i]);
  // Sort descending with eigenvectors.
  const order = values.map((_, i) => i).sort((x, y) => values[y] - values[x]);
  const sortedValues = order.map((i) => values[i]);
  const sortedVectors = v.map((row) => order.map((i) => row[i]));
  return { values: sortedValues, vectors: sortedVectors };
}

/** Varimax rotation of a loadings matrix (columns = factors). */
export function varimax(loadings: Matrix, maxIter = 100, gamma = 1): Matrix {
  const n = loadings.length;
  const m = loadings[0].length;
  const L = loadings.map((row) => row.slice());
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let j = 0; j < m; j++) {
      for (let k = j + 1; k < m; k++) {
        let u = 0;
        let v = 0;
        let uu = 0;
        let vv = 0;
        for (let i = 0; i < n; i++) {
          const lj = L[i][j];
          const lk = L[i][k];
          u += lj * lk;
          v += lj * lj - lk * lk;
          uu += lj * lj;
          vv += lk * lk;
        }
        const num = 2 * (gamma * u - 0 * 0);
        const den = v - gamma * (uu - vv);
        if (Math.abs(den) < 1e-12 && Math.abs(num) < 1e-12) continue;
        const theta = Math.atan2(num, den) / 4;
        const c = Math.cos(theta);
        const s = Math.sin(theta);
        changed = true;
        for (let i = 0; i < n; i++) {
          const a = L[i][j];
          const b = L[i][k];
          L[i][j] = a * c + b * s;
          L[i][k] = -a * s + b * c;
        }
      }
    }
    if (!changed) break;
  }
  return L;
}
