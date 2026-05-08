use std::path::Path;

/// Recursively sums the size of all files under `root`.
/// Missing roots, unreadable directories, and unreadable files are silently skipped.
pub(crate) fn dir_size_recursive(root: &Path) -> u64 {
    if !root.exists() {
        return 0;
    }
    let mut total: u64 = 0;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let rd = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for entry in rd.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if let Ok(meta) = std::fs::metadata(&path) {
                total += meta.len();
            }
        }
    }
    total
}

/// Walks upward from `start_dir`, removing each empty directory using `remove_dir`
/// (never `remove_dir_all`). Stops as soon as a non-empty directory is hit, the
/// boundary is reached, or removal fails.
///
/// `boundary` is never removed and is treated as a hard stop. If `start_dir` is
/// not under `boundary`, the function is a no-op.
pub(crate) fn prune_empty_dirs_up_to(start_dir: &Path, boundary: &Path) {
    let mut current = Some(start_dir.to_path_buf());
    while let Some(dir) = current {
        if dir == boundary || !dir.starts_with(boundary) {
            break;
        }
        match std::fs::read_dir(&dir) {
            Ok(mut entries) => {
                if entries.next().is_some() {
                    break;
                }
                if std::fs::remove_dir(&dir).is_err() {
                    break;
                }
                current = dir.parent().map(|p| p.to_path_buf());
            }
            Err(_) => break,
        }
    }
}
