#!/bin/sh
# 検証用のデータベースを初回起動時に作成する。
# 開発用と分けることで、テストが開発データを壊さないようにする。
#
# 名前は開発用のデータベース名から作る。POSTGRES_DB を変えたときに、
# 検証用だけ既定の名前で残らないようにする。
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	CREATE DATABASE "${POSTGRES_DB}_test" OWNER $POSTGRES_USER;
	CREATE DATABASE "${POSTGRES_DB}_e2e" OWNER $POSTGRES_USER;
EOSQL
