// Fixed arena: no allocator, dependencies, WASI, threads, or per-pixel JS calls.
const M: usize = 1024 * 1024;
#[repr(align(16))]
struct Arena([u8; 24 * M]);
static mut ARENA: Arena = Arena([0; 24 * M]);
fn arena() -> *mut u8 { std::ptr::addr_of_mut!(ARENA).cast::<u8>() }
#[no_mangle]
pub extern "C" fn input_ptr() -> *mut u8 { arena() }
#[no_mangle]
pub extern "C" fn output_ptr() -> *mut u8 { unsafe { arena().add(20*M) } }

#[no_mangle]
pub unsafe extern "C" fn image(w: usize, h: usize, baseline: u32) -> usize {
    if !(7..=2048).contains(&w) || !(7..=2048).contains(&h) { return 0; }
    let n = w*h;
    let a = std::slice::from_raw_parts(arena(), n);
    let t = std::slice::from_raw_parts_mut(arena().add(8*M).cast::<u16>(), n);
    let b = std::slice::from_raw_parts_mut(arena().add(16*M), n);
    let out = std::slice::from_raw_parts_mut(output_ptr(), n);
    b.fill(0); out.fill(0);
    if baseline != 0 {
        let weights = [1u32, 4, 6, 4, 1];
        for y in 2..h-2 { for x in 2..w-2 {
            let mut s = 0;
            for dy in 0..5 { for dx in 0..5 {
                s += a[(y+dy-2)*w+x+dx-2] as u32 * weights[dy] * weights[dx];
            }}
            b[y*w+x] = ((s+128)>>8) as u8;
        }}
    } else {
        for y in 0..h { for x in 2..w-2 {
            let p = y*w+x;
            t[p] = a[p-2] as u16 + 4*a[p-1] as u16 + 6*a[p] as u16 + 4*a[p+1] as u16 + a[p+2] as u16;
        }}
        for y in 2..h-2 { for x in 2..w-2 {
            let p = y*w+x;
            b[p] = ((t[p-2*w] as u32 + 4*t[p-w] as u32 + 6*t[p] as u32 + 4*t[p+w] as u32 + t[p+2*w] as u32 + 128)>>8) as u8;
        }}
    }
    for y in 3..h-3 { for x in 3..w-3 {
        let p=y*w+x; let u=p-w; let v=p+w;
        let gx = -(b[u-1] as i32) + b[u+1] as i32 - 2*b[p-1] as i32 + 2*b[p+1] as i32 - b[v-1] as i32 + b[v+1] as i32;
        let gy = -(b[u-1] as i32) - 2*b[u] as i32 - b[u+1] as i32 + b[v-1] as i32 + 2*b[v] as i32 + b[v+1] as i32;
        out[p] = (gx.abs()+gy.abs()).min(255) as u8;
    }}
    n
}

#[inline]
fn dot(a: &[i8], b: &[i8]) -> i32 {
    #[cfg(feature = "simd")]
    unsafe {
        use std::arch::wasm32::*;
        let mut acc = i32x4_splat(0);
        for j in (0..a.len()).step_by(16) {
            let x = v128_load(a.as_ptr().add(j).cast());
            let y = v128_load(b.as_ptr().add(j).cast());
            acc = i32x4_add(acc, i32x4_dot_i16x8(i16x8_extend_low_i8x16(x), i16x8_extend_low_i8x16(y)));
            acc = i32x4_add(acc, i32x4_dot_i16x8(i16x8_extend_high_i8x16(x), i16x8_extend_high_i8x16(y)));
        }
        i32x4_extract_lane::<0>(acc) + i32x4_extract_lane::<1>(acc) + i32x4_extract_lane::<2>(acc) + i32x4_extract_lane::<3>(acc)
    }
    #[cfg(not(feature = "simd"))]
    a.iter().zip(b).map(|(&x,&y)| x as i32 * y as i32).sum()
}

#[no_mangle]
pub unsafe extern "C" fn search(n: usize, d: usize, q: usize, k: usize, baseline: u32) -> usize {
    if n == 0 || n > 32768 || d == 0 || d > 256 || d%16 != 0 || q == 0 || q > 16 || k == 0 || k > 100 || k > n || (n+q)*d > 8*M { return 0; }
    let a = std::slice::from_raw_parts(arena().cast::<i8>(), (n+q)*d);
    let out = std::slice::from_raw_parts_mut(output_ptr().cast::<i32>(), q*k*2);
    let all = std::slice::from_raw_parts_mut(arena().add(8*M).cast::<(i32,i32)>(), n);
    let mut ids = [0i32; 100]; let mut scores = [0i32; 100];
    for qi in 0..q {
        scores.fill(i32::MIN);
        let query = &a[n*d+qi*d..n*d+(qi+1)*d];
        for i in 0..n {
            let score = dot(&a[i*d..(i+1)*d], query);
            if baseline != 0 { all[i] = (score, i as i32); }
            else if score > scores[k-1] {
                let mut j = k-1;
                while j > 0 && score > scores[j-1] { scores[j]=scores[j-1]; ids[j]=ids[j-1]; j-=1; }
                scores[j]=score; ids[j]=i as i32;
            }
        }
        if baseline != 0 {
            all.sort_unstable_by(|a,b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
            for j in 0..k { scores[j]=all[j].0; ids[j]=all[j].1; }
        }
        for j in 0..k { out[(qi*k+j)*2]=ids[j]; out[(qi*k+j)*2+1]=scores[j]; }
    }
    q*k*8
}
