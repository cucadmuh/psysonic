//! Windows Taskbar Thumbnail Toolbar (ITaskbarList3::ThumbBarAddButtons).
//!
//! Adds Prev / Play-Pause / Next buttons to the taskbar thumbnail preview.
//! Button clicks are intercepted via SetWindowSubclass and routed to the same
//! `media:prev`, `media:play-pause`, `media:next` events as souvlaki / tray.

use std::sync::atomic::{AtomicIsize, Ordering};

use tauri::{AppHandle, Emitter};
use windows::{
    core::Interface,
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        Graphics::Gdi::{
            CreateCompatibleDC, CreateSolidBrush, DeleteDC, DeleteObject, GetStockObject,
            Polygon, Rectangle as GdiRectangle, SelectObject, SetPolyFillMode,
            WHITE_BRUSH, WINDING, HGDIOBJ,
        },
        System::Com::{
            CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
        },
        UI::{
            Controls::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
            Shell::{
                CLSID_TaskbarList, ITaskbarList3,
                THUMBBUTTON, THUMBBUTTONFLAGS, THUMBBUTTONMASK, THBN_CLICKED,
                THB_FLAGS, THB_ICON, THB_TOOLTIP,
            },
            WindowsAndMessaging::{
                CreateIconIndirect, DestroyIcon, ICONINFO,
                WM_COMMAND, WM_NCDESTROY,
            },
        },
    },
};
use windows::Win32::Graphics::Gdi::{
    CreateBitmap, RGBQUAD,
};
use windows::Win32::UI::WindowsAndMessaging::HICON;

// ── Icon indices (positions in the per-button assignment) ────────────────────
const IDX_PREV:  u32 = 0;
const IDX_PLAY:  u32 = 1;
const IDX_PAUSE: u32 = 2;
const IDX_NEXT:  u32 = 3;

// Button IDs — arbitrary u32 values, must fit in WPARAM low-word.
const BTN_PREV: u32 = 0xE001;
const BTN_PLAY: u32 = 0xE002;
const BTN_NEXT: u32 = 0xE003;

// Unique subclass ID.
const SUBCLASS_ID: usize = 0xC0DE_7A8B;

// Raw pointers kept as atomics so `update_taskbar_icon` can reach the
// COM object and icons without managed state.
static TASKBAR_PTR: AtomicIsize = AtomicIsize::new(0);
static HWND_VAL:    AtomicIsize = AtomicIsize::new(0);
// HICONs for play and pause, stored so update_taskbar_icon can swap them.
static HICON_PLAY:  AtomicIsize = AtomicIsize::new(0);
static HICON_PAUSE: AtomicIsize = AtomicIsize::new(0);

// ── GDI icon generation ──────────────────────────────────────────────────────

// Icon size used for all thumbnail toolbar buttons.
const ICON_SIZE: i32 = 16;

/// Draw `f` onto a monochrome bitmap, then wrap it in an HICON with a
/// transparent background.  The closure receives an HDC sized ICON_SIZE×ICON_SIZE.
unsafe fn make_icon<F: FnOnce(windows::Win32::Graphics::Gdi::HDC)>(draw: F) -> HICON {
    // XOR mask: white pixels become the icon colour against dark taskbar.
    // AND mask: all zeros → every pixel is drawn (no transparency punch-out needed
    // for the shape itself; the taskbar composites onto its own bg).
    let xor_bits = vec![0xFFFFFFFFu32; (ICON_SIZE * ICON_SIZE) as usize]; // white canvas
    let and_bits = vec![0u32; (ICON_SIZE * ICON_SIZE) as usize];          // fully opaque mask

    // Create a 32-bpp colour bitmap we can GDI-draw into, then copy to xor_bits.
    // Simpler: build a 1bpp monochrome bitmap directly from bit arrays.
    // We use a colour DC approach: draw white shapes on black, extract as the XOR mask.
    let hdc_screen = CreateCompatibleDC(None);
    // 1-bpp monochrome DIB: width=ICON_SIZE, height=ICON_SIZE, planes=1, bpp=1
    // For simplicity use CreateBitmap with 1bpp.
    let hbm_xor = CreateBitmap(ICON_SIZE, ICON_SIZE, 1, 32, Some(xor_bits.as_ptr() as *const _));
    let hbm_and = CreateBitmap(ICON_SIZE, ICON_SIZE, 1, 1, Some(and_bits.as_ptr() as *const _));

    // Select xor bitmap into DC and draw.
    let old = SelectObject(hdc_screen, hbm_xor);
    // Fill black background.
    let black_brush = CreateSolidBrush(windows::Win32::Foundation::COLORREF(0x00000000));
    GdiRectangle(hdc_screen, 0, 0, ICON_SIZE, ICON_SIZE);
    DeleteObject(black_brush);

    // Let caller draw white shapes.
    draw(hdc_screen);

    SelectObject(hdc_screen, old);
    DeleteDC(hdc_screen);

    let info = ICONINFO {
        fIcon: true.into(),
        xHotspot: 0,
        yHotspot: 0,
        hbmMask: hbm_and,
        hbmColor: hbm_xor,
    };
    let hicon = CreateIconIndirect(&info).unwrap_or_default();
    // Bitmaps are now owned by the HICON; do NOT DeleteObject them.
    hicon
}

/// ▶ single filled triangle pointing right.
unsafe fn icon_play() -> HICON {
    make_icon(|hdc| {
        let brush = CreateSolidBrush(windows::Win32::Foundation::COLORREF(0x00FFFFFF));
        let old   = SelectObject(hdc, brush);
        SetPolyFillMode(hdc, WINDING);
        let pts = [
            windows::Win32::Foundation::POINT { x: 3,              y: 1 },
            windows::Win32::Foundation::POINT { x: 3,              y: ICON_SIZE - 2 },
            windows::Win32::Foundation::POINT { x: ICON_SIZE - 2,  y: ICON_SIZE / 2 },
        ];
        Polygon(hdc, &pts);
        SelectObject(hdc, old);
        DeleteObject(brush);
    })
}

/// ⏸ two filled rectangles.
unsafe fn icon_pause() -> HICON {
    make_icon(|hdc| {
        let brush = CreateSolidBrush(windows::Win32::Foundation::COLORREF(0x00FFFFFF));
        let old   = SelectObject(hdc, brush);
        GdiRectangle(hdc, 2, 1, 6, ICON_SIZE - 1);
        GdiRectangle(hdc, 8, 1, 12, ICON_SIZE - 1);
        SelectObject(hdc, old);
        DeleteObject(brush);
    })
}

/// ⏮ vertical bar + filled triangle pointing left.
unsafe fn icon_prev() -> HICON {
    make_icon(|hdc| {
        let brush = CreateSolidBrush(windows::Win32::Foundation::COLORREF(0x00FFFFFF));
        let old   = SelectObject(hdc, brush);
        SetPolyFillMode(hdc, WINDING);
        // Bar
        GdiRectangle(hdc, 1, 1, 4, ICON_SIZE - 1);
        // Triangle pointing left
        let pts = [
            windows::Win32::Foundation::POINT { x: ICON_SIZE - 2, y: 1 },
            windows::Win32::Foundation::POINT { x: ICON_SIZE - 2, y: ICON_SIZE - 2 },
            windows::Win32::Foundation::POINT { x: 5,             y: ICON_SIZE / 2 },
        ];
        Polygon(hdc, &pts);
        SelectObject(hdc, old);
        DeleteObject(brush);
    })
}

/// ⏭ filled triangle pointing right + vertical bar.
unsafe fn icon_next() -> HICON {
    make_icon(|hdc| {
        let brush = CreateSolidBrush(windows::Win32::Foundation::COLORREF(0x00FFFFFF));
        let old   = SelectObject(hdc, brush);
        SetPolyFillMode(hdc, WINDING);
        // Triangle pointing right
        let pts = [
            windows::Win32::Foundation::POINT { x: 1,            y: 1 },
            windows::Win32::Foundation::POINT { x: 1,            y: ICON_SIZE - 2 },
            windows::Win32::Foundation::POINT { x: ICON_SIZE - 5, y: ICON_SIZE / 2 },
        ];
        Polygon(hdc, &pts);
        // Bar
        GdiRectangle(hdc, ICON_SIZE - 4, 1, ICON_SIZE - 1, ICON_SIZE - 1);
        SelectObject(hdc, old);
        DeleteObject(brush);
    })
}

// ── Button descriptors ───────────────────────────────────────────────────────

fn copy_tip(dest: &mut [u16], src: &str) {
    let wide: Vec<u16> = src.encode_utf16().chain(std::iter::once(0)).collect();
    let len = wide.len().min(dest.len());
    dest[..len].copy_from_slice(&wide[..len]);
}

unsafe fn make_buttons(
    h_prev: HICON,
    h_play: HICON,
    h_next: HICON,
) -> [THUMBBUTTON; 3] {
    let mask  = THUMBBUTTONMASK(THB_ICON.0 | THB_TOOLTIP.0 | THB_FLAGS.0);
    let flags = THUMBBUTTONFLAGS(0); // THBF_ENABLED

    let mut prev = THUMBBUTTON::default();
    prev.dwMask  = mask; prev.iId = BTN_PREV;
    prev.hIcon   = h_prev; prev.dwFlags = flags;
    copy_tip(&mut prev.szTip, "Previous");

    let mut play = THUMBBUTTON::default();
    play.dwMask  = mask; play.iId = BTN_PLAY;
    play.hIcon   = h_play; play.dwFlags = flags;
    copy_tip(&mut play.szTip, "Play");

    let mut next = THUMBBUTTON::default();
    next.dwMask  = mask; next.iId = BTN_NEXT;
    next.hIcon   = h_next; next.dwFlags = flags;
    copy_tip(&mut next.szTip, "Next");

    [prev, play, next]
}

// ── WndProc subclass ─────────────────────────────────────────────────────────

struct SubclassData {
    app: AppHandle,
}

unsafe extern "system" fn subclass_proc(
    hwnd:   HWND,
    msg:    u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _uid:   usize,
    data:   usize,
) -> LRESULT {
    if msg == WM_COMMAND {
        let hi = (wparam.0 >> 16) as u32;
        let lo = (wparam.0 & 0xFFFF) as u32;
        if hi == THBN_CLICKED as u32 {
            if data != 0 {
                let state = &*(data as *const SubclassData);
                let _ = match lo {
                    x if x == BTN_PREV => state.app.emit("media:prev", ()),
                    x if x == BTN_PLAY => state.app.emit("media:play-pause", ()),
                    x if x == BTN_NEXT => state.app.emit("media:next", ()),
                    _ => Ok(()),
                };
            }
            return LRESULT(0);
        }
    }

    if msg == WM_NCDESTROY {
        let _ = RemoveWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID);
        if data != 0 {
            drop(Box::from_raw(data as *mut SubclassData));
        }
        let raw = TASKBAR_PTR.swap(0, Ordering::SeqCst);
        if raw != 0 {
            drop(Box::from_raw(raw as *mut ITaskbarList3));
        }
        HWND_VAL.store(0, Ordering::SeqCst);
        // Destroy stored HICONs.
        let hp = HICON_PLAY.swap(0, Ordering::SeqCst);
        if hp != 0 { let _ = DestroyIcon(HICON(hp as *mut _)); }
        let hpa = HICON_PAUSE.swap(0, Ordering::SeqCst);
        if hpa != 0 { let _ = DestroyIcon(HICON(hpa as *mut _)); }
    }

    DefSubclassProc(hwnd, msg, wparam, lparam)
}

// ── Public init ──────────────────────────────────────────────────────────────

pub fn init(app: &AppHandle, hwnd_raw: isize) {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

        let hwnd = HWND(hwnd_raw as *mut _);

        let taskbar: ITaskbarList3 = match CoCreateInstance(
            &CLSID_TaskbarList, None, CLSCTX_INPROC_SERVER,
        ) {
            Ok(t)  => t,
            Err(e) => { eprintln!("[psysonic] taskbar: CoCreateInstance failed: {e}"); return; }
        };

        if let Err(e) = taskbar.HrInit() {
            eprintln!("[psysonic] taskbar: HrInit failed: {e}");
            return;
        }

        let h_prev  = icon_prev();
        let h_play  = icon_play();
        let h_pause = icon_pause();
        let h_next  = icon_next();

        // Store play/pause HICONs for later swapping.
        HICON_PLAY .store(h_play .0 as isize, Ordering::SeqCst);
        HICON_PAUSE.store(h_pause.0 as isize, Ordering::SeqCst);

        let mut buttons = make_buttons(h_prev, h_play, h_next);
        if let Err(e) = taskbar.ThumbBarAddButtons(hwnd, &mut buttons) {
            eprintln!("[psysonic] taskbar: ThumbBarAddButtons failed: {e}");
            return;
        }

        let raw = Box::into_raw(Box::new(taskbar));
        TASKBAR_PTR.store(raw as isize, Ordering::SeqCst);
        HWND_VAL   .store(hwnd_raw,     Ordering::SeqCst);

        let data = Box::into_raw(Box::new(SubclassData { app: app.clone() }));
        if SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, data as usize).is_err() {
            eprintln!("[psysonic] taskbar: SetWindowSubclass failed");
            drop(Box::from_raw(data));
        }
    }
}

// ── Tauri command ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn update_taskbar_icon(is_playing: bool) {
    let taskbar_raw = TASKBAR_PTR.load(Ordering::SeqCst);
    let hwnd_raw    = HWND_VAL   .load(Ordering::SeqCst);
    if taskbar_raw == 0 || hwnd_raw == 0 { return; }

    let icon_raw = if is_playing {
        HICON_PAUSE.load(Ordering::SeqCst)
    } else {
        HICON_PLAY.load(Ordering::SeqCst)
    };
    if icon_raw == 0 { return; }

    unsafe {
        let taskbar = &*(taskbar_raw as *const ITaskbarList3);
        let hwnd    = HWND(hwnd_raw as *mut _);

        let mut btn = THUMBBUTTON::default();
        btn.dwMask  = THUMBBUTTONMASK(THB_ICON.0 | THB_TOOLTIP.0 | THB_FLAGS.0);
        btn.iId     = BTN_PLAY;
        btn.hIcon   = HICON(icon_raw as *mut _);
        btn.dwFlags = THUMBBUTTONFLAGS(0);
        copy_tip(&mut btn.szTip, if is_playing { "Pause" } else { "Play" });

        let mut btns = [btn];
        if let Err(e) = taskbar.ThumbBarUpdateButtons(hwnd, &mut btns) {
            #[cfg(debug_assertions)]
            eprintln!("[psysonic] taskbar: ThumbBarUpdateButtons failed: {e}");
            let _ = e;
        }
    }
}
