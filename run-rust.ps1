Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  Starting 0arc High-Performance Rust Server" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Cargo / Rust is not found in your PATH." -ForegroundColor Red
    Write-Host "Please install Rust from https://rustup.rs or run:" -ForegroundColor Yellow
    Write-Host "  winget install --id Rustlang.Rustup" -ForegroundColor White
    exit 1
}

Write-Host "Building and launching Rust server..." -ForegroundColor Green
cargo run --manifest-path rust-server/Cargo.toml --release
