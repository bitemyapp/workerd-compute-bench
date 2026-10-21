// Fixed arena: no allocator, dependencies, WASI, threads, or per-pixel JS calls.
const M: usize = 1024 * 1024;
#[repr(align(16))]
struct Arena([u8; 24 * M]);
static mut ARENA: Arena = Arena([0; 24 * M]);
fn arena() -> *mut u8 {
    unsafe { std::ptr::addr_of_mut!(ARENA.0).cast::<u8>() }
}
#[no_mangle]
pub extern "C" fn input_ptr() -> *mut u8 {
    arena()
}
#[no_mangle]
pub extern "C" fn output_ptr() -> *mut u8 {
    unsafe { arena().add(20 * M) }
}

#[no_mangle]
pub unsafe extern "C" fn image(w: usize, h: usize, baseline: u32) -> usize {
    if !(7..=2048).contains(&w) || !(7..=2048).contains(&h) {
        return 0;
    }
    #[cfg(feature = "manual")]
    if baseline == 0 {
        return image_simd(w, h);
    }
    let n = w * h;
    let a = std::slice::from_raw_parts(arena(), n);
    let t = std::slice::from_raw_parts_mut(arena().add(8 * M).cast::<u16>(), n);
    let b = std::slice::from_raw_parts_mut(arena().add(16 * M), n);
    let out = std::slice::from_raw_parts_mut(output_ptr(), n);
    b.fill(0);
    out.fill(0);
    if baseline != 0 {
        let weights = [1u32, 4, 6, 4, 1];
        for y in 2..h - 2 {
            for x in 2..w - 2 {
                let mut s = 0;
                for dy in 0..5 {
                    for dx in 0..5 {
                        s += a[(y + dy - 2) * w + x + dx - 2] as u32 * weights[dy] * weights[dx];
                    }
                }
                b[y * w + x] = ((s + 128) >> 8) as u8;
            }
        }
    } else {
        for y in 0..h {
            for x in 2..w - 2 {
                let p = y * w + x;
                t[p] = a[p - 2] as u16
                    + 4 * a[p - 1] as u16
                    + 6 * a[p] as u16
                    + 4 * a[p + 1] as u16
                    + a[p + 2] as u16;
            }
        }
        for y in 2..h - 2 {
            for x in 2..w - 2 {
                let p = y * w + x;
                b[p] = ((t[p - 2 * w] as u32
                    + 4 * t[p - w] as u32
                    + 6 * t[p] as u32
                    + 4 * t[p + w] as u32
                    + t[p + 2 * w] as u32
                    + 128)
                    >> 8) as u8;
            }
        }
    }
    for y in 3..h - 3 {
        for x in 3..w - 3 {
            let p = y * w + x;
            let u = p - w;
            let v = p + w;
            let gx = -(b[u - 1] as i32) + b[u + 1] as i32 - 2 * b[p - 1] as i32
                + 2 * b[p + 1] as i32
                - b[v - 1] as i32
                + b[v + 1] as i32;
            let gy = -(b[u - 1] as i32) - 2 * b[u] as i32 - b[u + 1] as i32
                + b[v - 1] as i32
                + 2 * b[v] as i32
                + b[v + 1] as i32;
            out[p] = (gx.abs() + gy.abs()).min(255) as u8;
        }
    }
    n
}

// Eight pixels per vector. Each load stays within a validated row/plane;
// scalar tails handle all widths, including those not divisible by eight.
#[cfg(feature = "manual")]
unsafe fn image_simd(w: usize, h: usize) -> usize {
    use std::arch::wasm32::*;
    #[inline(always)]
    unsafe fn load(p: *const u8) -> v128 {
        u16x8_extend_low_u8x16(v128_load64_zero(p.cast()))
    }
    #[inline(always)]
    unsafe fn blur(a: v128, b: v128, c: v128, d: v128, e: v128) -> v128 {
        i16x8_add(
            i16x8_add(a, e),
            i16x8_add(i16x8_shl(i16x8_add(b, d), 2), i16x8_mul(c, i16x8_splat(6))),
        )
    }
    let n = w * h;
    let a = arena();
    let t = arena().add(8 * M).cast::<u16>();
    let b = arena().add(16 * M);
    let o = output_ptr();
    std::ptr::write_bytes(b, 0, n);
    std::ptr::write_bytes(o, 0, n);
    for y in 0..h {
        let mut p = y * w + 2;
        let end = (y + 1) * w - 2;
        while p + 8 <= end {
            v128_store(
                t.add(p).cast(),
                blur(
                    load(a.add(p - 2)),
                    load(a.add(p - 1)),
                    load(a.add(p)),
                    load(a.add(p + 1)),
                    load(a.add(p + 2)),
                ),
            );
            p += 8;
        }
        while p < end {
            *t.add(p) = *a.add(p - 2) as u16
                + 4 * (*a.add(p - 1) as u16)
                + 6 * (*a.add(p) as u16)
                + 4 * (*a.add(p + 1) as u16)
                + *a.add(p + 2) as u16;
            p += 1;
        }
    }
    for y in 2..h - 2 {
        let mut p = y * w + 2;
        let end = (y + 1) * w - 2;
        while p + 8 <= end {
            let s = blur(
                v128_load(t.add(p - 2 * w).cast()),
                v128_load(t.add(p - w).cast()),
                v128_load(t.add(p).cast()),
                v128_load(t.add(p + w).cast()),
                v128_load(t.add(p + 2 * w).cast()),
            );
            let s = u16x8_shr(i16x8_add(s, i16x8_splat(128)), 8);
            v128_store64_lane::<0>(u8x16_narrow_i16x8(s, i16x8_splat(0)), b.add(p).cast());
            p += 8;
        }
        while p < end {
            *b.add(p) = ((*t.add(p - 2 * w) as u32
                + 4 * (*t.add(p - w) as u32)
                + 6 * (*t.add(p) as u32)
                + 4 * (*t.add(p + w) as u32)
                + *t.add(p + 2 * w) as u32
                + 128)
                >> 8) as u8;
            p += 1;
        }
    }
    for y in 3..h - 3 {
        let mut p = y * w + 3;
        let end = (y + 1) * w - 3;
        while p + 8 <= end {
            let a = load(b.add(p - w - 1));
            let c = load(b.add(p - w + 1));
            let g = load(b.add(p + w - 1));
            let i = load(b.add(p + w + 1));
            let gx = i16x8_add(
                i16x8_add(i16x8_sub(c, a), i16x8_sub(i, g)),
                i16x8_shl(i16x8_sub(load(b.add(p + 1)), load(b.add(p - 1))), 1),
            );
            let gy = i16x8_add(
                i16x8_add(i16x8_sub(g, a), i16x8_sub(i, c)),
                i16x8_shl(i16x8_sub(load(b.add(p + w)), load(b.add(p - w))), 1),
            );
            let mag = i16x8_add(i16x8_abs(gx), i16x8_abs(gy));
            v128_store64_lane::<0>(u8x16_narrow_i16x8(mag, i16x8_splat(0)), o.add(p).cast());
            p += 8;
        }
        while p < end {
            let u = p - w;
            let v = p + w;
            let gx = -(*b.add(u - 1) as i32) + *b.add(u + 1) as i32 - 2 * (*b.add(p - 1) as i32)
                + 2 * (*b.add(p + 1) as i32)
                - *b.add(v - 1) as i32
                + *b.add(v + 1) as i32;
            let gy = -(*b.add(u - 1) as i32) - 2 * (*b.add(u) as i32) - *b.add(u + 1) as i32
                + *b.add(v - 1) as i32
                + 2 * (*b.add(v) as i32)
                + *b.add(v + 1) as i32;
            *o.add(p) = (gx.abs() + gy.abs()).min(255) as u8;
            p += 1;
        }
    }
    n
}

#[inline]
fn dot(a: &[i8], b: &[i8]) -> i32 {
    #[cfg(feature = "unroll")]
    {
        return unsafe { dot_unrolled(a, b) };
    }
    #[cfg(not(feature = "unroll"))]
    {
        #[cfg(feature = "simd")]
        unsafe {
            use std::arch::wasm32::*;
            let mut acc = i32x4_splat(0);
            for j in (0..a.len()).step_by(16) {
                let x = v128_load(a.as_ptr().add(j).cast());
                let y = v128_load(b.as_ptr().add(j).cast());
                acc = i32x4_add(
                    acc,
                    i32x4_dot_i16x8(i16x8_extend_low_i8x16(x), i16x8_extend_low_i8x16(y)),
                );
                acc = i32x4_add(
                    acc,
                    i32x4_dot_i16x8(i16x8_extend_high_i8x16(x), i16x8_extend_high_i8x16(y)),
                );
            }
            i32x4_extract_lane::<0>(acc)
                + i32x4_extract_lane::<1>(acc)
                + i32x4_extract_lane::<2>(acc)
                + i32x4_extract_lane::<3>(acc)
        }
        #[cfg(not(feature = "simd"))]
        a.iter().zip(b).map(|(&x, &y)| x as i32 * y as i32).sum()
    }
}

#[cfg(feature = "unroll")]
unsafe fn dot_unrolled(a: &[i8], b: &[i8]) -> i32 {
    use std::arch::wasm32::*;
    #[inline(always)]
    unsafe fn pair(a: *const i8, b: *const i8) -> v128 {
        let x = v128_load(a.cast());
        let y = v128_load(b.cast());
        i32x4_add(
            i32x4_dot_i16x8(i16x8_extend_low_i8x16(x), i16x8_extend_low_i8x16(y)),
            i32x4_dot_i16x8(i16x8_extend_high_i8x16(x), i16x8_extend_high_i8x16(y)),
        )
    }
    let mut s0 = i32x4_splat(0);
    let mut s1 = s0;
    let mut s2 = s0;
    let mut s3 = s0;
    let mut p = 0;
    while p + 64 <= a.len() {
        s0 = i32x4_add(s0, pair(a.as_ptr().add(p), b.as_ptr().add(p)));
        s1 = i32x4_add(s1, pair(a.as_ptr().add(p + 16), b.as_ptr().add(p + 16)));
        s2 = i32x4_add(s2, pair(a.as_ptr().add(p + 32), b.as_ptr().add(p + 32)));
        s3 = i32x4_add(s3, pair(a.as_ptr().add(p + 48), b.as_ptr().add(p + 48)));
        p += 64;
    }
    while p < a.len() {
        s0 = i32x4_add(s0, pair(a.as_ptr().add(p), b.as_ptr().add(p)));
        p += 16;
    }
    let acc = i32x4_add(i32x4_add(s0, s1), i32x4_add(s2, s3));
    i32x4_extract_lane::<0>(acc)
        + i32x4_extract_lane::<1>(acc)
        + i32x4_extract_lane::<2>(acc)
        + i32x4_extract_lane::<3>(acc)
}

#[no_mangle]
pub unsafe extern "C" fn search(n: usize, d: usize, q: usize, k: usize, baseline: u32) -> usize {
    if n == 0
        || n > 32768
        || d == 0
        || d > 256
        || d % 16 != 0
        || q == 0
        || q > 16
        || k == 0
        || k > 100
        || k > n
        || (n + q) * d > 8 * M
    {
        return 0;
    }
    let a = std::slice::from_raw_parts(arena().cast::<i8>(), (n + q) * d);
    let out = std::slice::from_raw_parts_mut(output_ptr().cast::<i32>(), q * k * 2);
    let all = std::slice::from_raw_parts_mut(arena().add(8 * M).cast::<(i32, i32)>(), n);
    let mut ids = [0i32; 100];
    let mut scores = [0i32; 100];
    for qi in 0..q {
        scores.fill(i32::MIN);
        let query = &a[n * d + qi * d..n * d + (qi + 1) * d];
        for i in 0..n {
            let score = dot(&a[i * d..(i + 1) * d], query);
            if baseline != 0 {
                all[i] = (score, i as i32);
            } else if score > scores[k - 1] {
                let mut j = k - 1;
                while j > 0 && score > scores[j - 1] {
                    scores[j] = scores[j - 1];
                    ids[j] = ids[j - 1];
                    j -= 1;
                }
                scores[j] = score;
                ids[j] = i as i32;
            }
        }
        if baseline != 0 {
            all.sort_unstable_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
            for j in 0..k {
                scores[j] = all[j].0;
                ids[j] = all[j].1;
            }
        }
        for j in 0..k {
            out[(qi * k + j) * 2] = ids[j];
            out[(qi * k + j) * 2 + 1] = scores[j];
        }
    }
    q * k * 8
}
