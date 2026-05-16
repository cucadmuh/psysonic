//! MP4/M4A layout helpers for HTTP streaming path selection.

/// True when the Subsonic / sniffed container hint is ISO-BMFF (m4a, mp4, …).
pub(crate) fn container_hint_is_mp4(hint: Option<&str>) -> bool {
    let Some(h) = hint else { return false };
    matches!(
        h.to_ascii_lowercase().as_str(),
        "m4a" | "m4af" | "mp4" | "m4b" | "mov" | "mp4a" | "isom"
    )
}

/// Walk top-level atoms in `prefix` and return true when `mdat` appears before `moov`
/// (classic non–fast-start layout — Symphonia must read the `moov` near EOF).
pub(crate) fn mp4_moov_follows_mdat(prefix: &[u8]) -> bool {
    let mut pos = 0usize;
    let mut saw_mdat = false;
    while pos + 8 <= prefix.len() {
        let atom_size = match read_mp4_atom_size(prefix, pos) {
            Some(s) => s,
            None => break,
        };
        if atom_size < 8 {
            break;
        }
        let atom_type = &prefix[pos + 4..pos + 8];
        if atom_type == b"mdat" {
            saw_mdat = true;
        }
        if atom_type == b"moov" {
            return saw_mdat;
        }
        let advance = atom_size.min((prefix.len() - pos) as u64) as usize;
        if advance < 8 {
            break;
        }
        pos += advance;
    }
    false
}

/// True when we should prefetch the file tail before linear fill (moov-at-end).
pub(crate) fn mp4_needs_tail_prefetch(prefix: &[u8], hint: Option<&str>) -> bool {
    if !container_hint_is_mp4(hint) {
        return false;
    }
    if prefix.is_empty() {
        return true;
    }
    if mp4_moov_follows_mdat(prefix) {
        return true;
    }
    // mdat seen but no moov in the scanned prefix — moov is likely at EOF.
    let mut pos = 0usize;
    let mut saw_mdat = false;
    let mut saw_moov = false;
    while pos + 8 <= prefix.len() {
        let atom_size = match read_mp4_atom_size(prefix, pos) {
            Some(s) => s,
            None => break,
        };
        if atom_size < 8 {
            break;
        }
        let atom_type = &prefix[pos + 4..pos + 8];
        if atom_type == b"mdat" {
            saw_mdat = true;
        }
        if atom_type == b"moov" {
            saw_moov = true;
            break;
        }
        let advance = atom_size.min((prefix.len() - pos) as u64) as usize;
        if advance < 8 {
            break;
        }
        pos += advance;
    }
    saw_mdat && !saw_moov
}

fn read_mp4_atom_size(data: &[u8], pos: usize) -> Option<u64> {
    if pos + 8 > data.len() {
        return None;
    }
    let size32 = u32::from_be_bytes(data[pos..pos + 4].try_into().ok()?) as u64;
    if size32 == 1 {
        if pos + 16 > data.len() {
            return None;
        }
        Some(u64::from_be_bytes(data[pos + 8..pos + 16].try_into().ok()?))
    } else {
        Some(size32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn atom(typ: &[u8; 4], payload_len: usize) -> Vec<u8> {
        let size = (8 + payload_len) as u32;
        let mut v = Vec::with_capacity(8 + payload_len);
        v.extend_from_slice(&size.to_be_bytes());
        v.extend_from_slice(typ);
        v.resize(8 + payload_len, 0);
        v
    }

    #[test]
    fn moov_after_mdat_detected() {
        let mut buf = Vec::new();
        buf.extend(atom(b"ftyp", 4));
        buf.extend(atom(b"mdat", 100));
        buf.extend(atom(b"moov", 40));
        assert!(mp4_moov_follows_mdat(&buf));
        assert!(mp4_needs_tail_prefetch(&buf, Some("m4a")));
    }

    #[test]
    fn moov_before_mdat_no_tail_prefetch() {
        let mut buf = Vec::new();
        buf.extend(atom(b"ftyp", 4));
        buf.extend(atom(b"moov", 40));
        buf.extend(atom(b"mdat", 100));
        assert!(!mp4_moov_follows_mdat(&buf));
        assert!(!mp4_needs_tail_prefetch(&buf, Some("m4a")));
    }
}
