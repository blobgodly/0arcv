@echo off
setlocal
echo ========================================================
echo   Starting 0arc High-Performance Rust Server
echo ========================================================

where cargo >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Cargo / Rust is not found in your PATH.
    echo Please install Rust from https://rustup.rs or run:
    echo   winget install --id Rustlang.Rustup
    pause
    exit /b 1
)

echo Building and starting release server...
cargo run --manifest-path rust-server/Cargo.toml --release

pause
