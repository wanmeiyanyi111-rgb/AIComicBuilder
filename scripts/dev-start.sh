#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DEFAULT_PORT="${PORT:-3000}"

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return 0
  fi

  echo "[dev:start] pnpm 未找到，尝试通过 corepack 激活..."
  if ! command -v corepack >/dev/null 2>&1; then
    echo "[dev:start] 未检测到 corepack，请先安装 pnpm。"
    exit 1
  fi

  corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@10.18.3 --activate >/dev/null

  if ! command -v pnpm >/dev/null 2>&1; then
    echo "[dev:start] pnpm 激活失败，请手动安装后重试。"
    exit 1
  fi
}

prepare_local_env() {
  if [[ ! -f ".env" && -f ".env.example" ]]; then
    cp ".env.example" ".env"
    echo "[dev:start] 已自动创建 .env"
  fi

  mkdir -p data uploads
}

ensure_free_port() {
  local target_port="$1"

  if ! lsof -nP -iTCP:"$target_port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "$target_port"
    return 0
  fi

  local pid
  local cmd
  pid="$(lsof -tiTCP:"$target_port" -sTCP:LISTEN | head -n1)"
  cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"

  if [[ "$cmd" == *"next dev"* || "$cmd" == *"next-server"* || "$cmd" == *"AIComicBuilder"* ]]; then
    echo "[dev:start] 端口 ${target_port} 被旧的 Next 进程占用，正在清理 (PID: ${pid})..." >&2
    kill "$pid" 2>/dev/null || true
    sleep 1

    if lsof -nP -iTCP:"$target_port" -sTCP:LISTEN >/dev/null 2>&1; then
      kill -9 "$pid" 2>/dev/null || true
      sleep 1
    fi

    if ! lsof -nP -iTCP:"$target_port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "$target_port"
      return 0
    fi
  fi

  for candidate in 3001 3002 3003 3010 3020; do
    if ! lsof -nP -iTCP:"$candidate" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "[dev:start] 端口 ${target_port} 被其他程序占用，改用 ${candidate}" >&2
      echo "$candidate"
      return 0
    fi
  done

  echo "[dev:start] 未找到可用端口，请手动释放端口后重试。" >&2
  exit 1
}

ensure_pnpm
prepare_local_env
RUN_PORT="$(ensure_free_port "$DEFAULT_PORT")"

echo "[dev:start] 启动开发服务: http://localhost:${RUN_PORT}"
exec pnpm exec next dev -p "$RUN_PORT" --webpack
