#!/usr/bin/env bash
# CloudBlog D1 数据库初始化脚本
# 用法: ./scripts/init-d1.sh [local|remote] [env]
# 示例:
#   ./scripts/init-d1.sh local          # 本地开发
#   ./scripts/init-d1.sh remote         # 生产环境
#   ./scripts/init-d1.sh remote staging # staging 环境

set -euo pipefail

MODE="${1:-local}"
ENV="${2:-production}"
SCHEMA_FILE="./src/db/schema.sql"
DB_NAME="cloudblog-db"

echo "🚀 CloudBlog D1 初始化脚本"
echo "   模式: $MODE"
echo "   环境: $ENV"
echo "   数据库: $DB_NAME"

if [[ ! -f "$SCHEMA_FILE" ]]; then
  echo "❌ 错误: 找不到 schema 文件: $SCHEMA_FILE"
  exit 1
fi

case "$MODE" in
  local)
    echo "📦 初始化本地 D1 数据库..."
    wrangler d1 execute "$DB_NAME" --local --env "$ENV" --file="$SCHEMA_FILE"
    echo "✅ 本地数据库初始化完成"
    ;;
  remote)
    echo "☁️  初始化远程 D1 数据库..."
    wrangler d1 execute "$DB_NAME" --remote --env "$ENV" --file="$SCHEMA_FILE"
    echo "✅ 远程数据库初始化完成"
    ;;
  *)
    echo "❌ 未知模式: $MODE (支持: local, remote)"
    exit 1
    ;;
esac

echo ""
echo "📋 数据库表创建完成，可选操作:"
echo "   创建管理员账号: ./scripts/init-d1.sh admin $MODE $ENV"
