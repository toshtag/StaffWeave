#!/bin/sh
# 統合テスト用のデータベースを初回起動時に作成する。
# 開発用データベースとテスト用データベースを分けることで、テストが開発データを壊さないようにする。
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	CREATE DATABASE staffweave_test OWNER $POSTGRES_USER;
EOSQL
